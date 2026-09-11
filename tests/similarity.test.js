import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isPlayableForm } from "../web/src/form-policy.js";
import {
  createSimilarity,
  dailyTarget,
  resolveDay,
  validDay,
  dayKey,
  newRound,
  restoreRound,
  submitGuess,
  isWon,
  nextHint,
  searchForms,
  MAX_HINTS,
  proximityFor,
} from "../web/src/similarity-engine.js";

const data = JSON.parse(
  readFileSync(new URL("../web/public/pokemantle.json", import.meta.url)),
);
const binary = readFileSync(
  new URL("../web/public/pokemantle-scores.bin", import.meta.url),
);
const buffer = binary.buffer.slice(
  binary.byteOffset,
  binary.byteOffset + binary.byteLength,
);
const game = createSimilarity(data, buffer);

test("only explicit commemorative forms are excluded, never whole mythical species", () => {
  const removed = data.pokemon.filter((p) => !isPlayableForm(p));
  assert.equal(removed.length, 20);
  assert.equal(game.pokemon.length, 1559);
  assert.equal(game.byId.size, 1559);
  for (const key of [
    "arceus-unknown",
    "pichu-spiky-eared",
    "pikachu-partner-cap",
    "pikachu-original-cap",
    "pikachu-world-cap",
    "pikachu-cosplay",
    "pikachu-libre",
    "zarude-dada",
    "vivillon-poke-ball",
    "scatterbug-poke-ball",
    "spewpa-poke-ball",
  ])
    assert.ok(
      removed.some((p) => p.key === key),
      key,
    );
  for (const p of removed) {
    assert.equal(game.byId.has(p.id), false);
    for (const query of [p.name, p.key, String(p.id), String(p.speciesId)])
      assert.ok(searchForms(data.pokemon, query).every(isPlayableForm), query);
  }
  const retained = new Set(game.pokemon.map((p) => p.key));
  for (const key of [
    "arceus-normal",
    "arceus-water",
    "pichu",
    "pikachu",
    "pikachu-starter",
    "eevee-starter",
    "pikachu-gmax",
    "charizard-mega-x",
    "vulpix-alola",
    "greninja-ash",
    "greninja-battle-bond",
    "floette-eternal",
    "magearna-original",
    "vivillon-fancy",
    "ursaluna-bloodmoon",
    "mew",
    "celebi",
    "jirachi",
    "deoxys-normal",
    "zarude",
  ])
    assert.ok(retained.has(key), key);
  const mythicalSpecies = new Set(
    data.pokemon
      .filter((p) => p.classification === "mythical")
      .map((p) => p.speciesId),
  );
  assert.deepEqual(
    new Set(
      game.pokemon
        .filter((p) => p.classification === "mythical")
        .map((p) => p.speciesId),
    ),
    mythicalSpecies,
  );
  assert.equal(isPlayableForm({ key: "new-ambiguous-form" }), true);
  assert.equal(searchForms(data.pokemon, "Arceus").length, 18);
});

test("excluded forms cannot be guessed, hinted or ranked, and retained scores keep raw offsets", () => {
  const removed = data.pokemon.filter((p) => !isPlayableForm(p));
  const allById = new Map(data.pokemon.map((p) => [p.id, p]));
  const target = 25;
  const round = newRound(data, "2026-09-10");
  const ranked = game.ranking(target);
  assert.equal(ranked.length, game.pokemon.length);
  for (const p of removed) {
    assert.equal(submitGuess(round, p.id, target, game.byId), "unknown");
    assert.equal(submitGuess(round, p.id, target, allById), "unknown");
    assert.ok(!ranked.some((r) => r.id === p.id));
    assert.throws(() => game.ranking(p.id));
  }
  const rowIndex = data.pokemon.findIndex((p) => p.id === target);
  for (const row of ranked) {
    const colIndex = data.pokemon.findIndex((p) => p.id === row.id);
    assert.equal(
      row.score,
      binary.readUInt16LE((rowIndex * data.pokemon.length + colIndex) * 2) /
        100,
    );
  }
  for (let i = 0; i < MAX_HINTS; i++) {
    const id = nextHint(round, ranked);
    assert.ok(game.byId.has(id));
    assert.notEqual(id, target);
    assert.equal(submitGuess(round, id, target, game.byId, true), "ok");
  }
});

test("only excluded-answer dates change, to a retained counterpart of the same species", () => {
  const legacyData = {
    ...data,
    pokemon: data.pokemon.map((p) => ({ ...p, key: "" })),
  };
  const byId = new Map(data.pokemon.map((p) => [p.id, p]));
  const origin = Date.parse("2026-01-01T00:00:00Z");
  let changed = 0;
  for (let i = 0; i < data.pokemon.length; i++) {
    const day = new Date(origin + i * 86400000).toISOString().slice(0, 10);
    const before = dailyTarget(legacyData, day);
    const after = dailyTarget(data, day);
    if (isPlayableForm(byId.get(before))) assert.equal(after, before);
    else {
      changed++;
      assert.ok(game.byId.has(after));
      assert.equal(byId.get(after).speciesId, byId.get(before).speciesId);
    }
  }
  assert.equal(changed, 20);
  assert.equal(dailyTarget(data, "2026-05-29"), 493);
});

test("saved rounds remove excluded guesses without losing ordinary progress; replaced answers reset once", () => {
  const day = "2026-09-10";
  const legacy = {
    version: data.version,
    day,
    gaveUp: false,
    guesses: [
      { id: 25, hint: false },
      { id: 10057, hint: true },
      { id: 381, hint: true },
    ],
  };
  const expected = {
    ...newRound(data, day),
    guesses: [legacy.guesses[0], legacy.guesses[2]],
  };
  assert.deepEqual(restoreRound(JSON.stringify(legacy), data, day), expected);
  assert.deepEqual(restoreRound(JSON.stringify(expected), data, day), expected);
  const oldWin = {
    ...legacy,
    guesses: [...legacy.guesses, { id: 10316, hint: false }],
  };
  assert.ok(isWon(restoreRound(JSON.stringify(oldWin), data, day), 10316));
  const changedDay = "2026-05-29";
  for (const guesses of [
    [],
    [{ id: 10057, hint: false }],
    [{ id: 25, hint: false }],
  ]) {
    const previous = { ...legacy, day: changedDay, guesses };
    assert.deepEqual(
      restoreRound(JSON.stringify(previous), data, changedDay),
      newRound(data, changedDay),
    );
  }
  const next = newRound(data, changedDay);
  assert.equal(submitGuess(next, 493, 493, game.byId), "ok");
  assert.deepEqual(restoreRound(JSON.stringify(next), data, changedDay), next);
});

test("raw form data stays intact and playable forms retain form-specific types and search", () => {
  assert.equal(data.pokemon.length, 1579);
  assert.equal(new Set(data.pokemon.map((p) => p.name)).size, 1579);
  const byKey = new Map(data.pokemon.map((p) => [p.key, p]));
  assert.notEqual(byKey.get("vulpix").id, byKey.get("vulpix-alola").id);
  assert.deepEqual(byKey.get("vulpix").types, [10]);
  assert.deepEqual(byKey.get("vulpix-alola").types, [15]);
  assert.deepEqual(byKey.get("arceus-water").types, [11]);
  for (const query of ["알로라 식스테일", "알로라식스테일", "Alolan Vulpix"])
    assert.ok(
      searchForms(data.pokemon, query).some((p) => p.key === "vulpix-alola"),
    );
  assert.ok(
    searchForms(data.pokemon, "메가리자몽X").some(
      (p) => p.key === "charizard-mega-x",
    ),
  );
  assert.ok(
    searchForms(data.pokemon, "ㅍㅋㅊ").some((p) => p.key === "pikachu"),
  );
  assert.ok(searchForms(data.pokemon, "켄타로스 팔데아").length >= 3);
  assert.ok(
    searchForms(data.pokemon, "37").some((p) => p.key === "vulpix-alola"),
  );
  assert.deepEqual(searchForms(data.pokemon, "없는포켓몬이름"), []);
});

test("bundled scores are intact, symmetric, bounded, and only exact form IDs score 100", () => {
  assert.equal(
    createHash("sha256").update(binary).digest("hex"),
    data.matrixSha256,
  );
  const n = data.pokemon.length;
  assert.equal(binary.length, n * n * 2);
  for (let a = 0; a < n; a++)
    for (let b = a; b < n; b++) {
      const score = binary.readUInt16LE((a * n + b) * 2);
      assert.equal(score, binary.readUInt16LE((b * n + a) * 2));
      if (a === b) assert.equal(score, 10000);
      else assert.ok(score >= 0 && score <= 9990);
    }
  assert.equal(
    Object.values(data.weights).reduce((a, b) => a + b, 0),
    100,
  );
  assert.deepEqual(data.weights, {
    types: 25,
    evolution: 20,
    classification: 15,
    motifs: 10,
    stats: 10,
    moves: 7,
    description: 5,
    abilities: 5,
    eggGroups: 2,
    body: 1,
  });
  assert.ok(game.score(37, 10205) < 100);
  assert.throws(() => createSimilarity(data, new ArrayBuffer(4)));
  assert.throws(() => game.score(-1, 37));
});

test("score updates preserve the v1 daily schedule and saved form guesses", () => {
  assert.equal(data.version, "pokemantle-v1");
  assert.equal(data.similarityVersion, "similarity-v2");
  assert.equal(dailyTarget(data, "2026-09-10"), 10316);
  assert.equal(dailyTarget(data, "2026-09-11"), 921);
  assert.equal(dailyTarget(data, "2024-03-13"), 10205);
  const legacy = {
    version: "pokemantle-v1",
    day: "2026-09-10",
    guesses: [
      { id: 381, hint: false },
      { id: 150, hint: true },
    ],
    gaveUp: false,
  };
  assert.deepEqual(restoreRound(JSON.stringify(legacy), data, legacy.day), {
    ...legacy,
    target: 10316,
  });
  assert.deepEqual(
    restoreRound(JSON.stringify({ ...legacy, gaveUp: true }), data, legacy.day),
    { ...legacy, target: 10316, gaveUp: true },
  );
  const win = {
    ...legacy,
    guesses: [...legacy.guesses, { id: 10316, hint: false }],
  };
  assert.deepEqual(restoreRound(JSON.stringify(win), data, legacy.day), {
    ...win,
    target: 10316,
  });
});

test("legendary clues lead toward Ultra Necrozma without sacrificing ordinary evolution and regional forms", () => {
  const byKey = new Map(data.pokemon.map((p) => [p.key, p]));
  const score = (a, b) => game.score(byKey.get(a).id, byKey.get(b).id);
  const ultra = "necrozma-ultra";
  assert.equal(byKey.get(ultra).classification, "major-legendary");
  assert.equal(byKey.get("latios").classification, "legendary");
  assert.equal(byKey.get("mew").classification, "mythical");
  assert.equal(byKey.get("pikachu").classification, "ordinary");
  assert.ok(byKey.get(ultra).motifs.includes("radiance"));
  assert.ok(byKey.get("vulpix-alola").motifs.includes("frost"));
  assert.ok(!byKey.get("vulpix-alola").motifs.includes("flame"));
  assert.ok(!byKey.get("cosmog").motifs.includes("radiance"));
  assert.ok(score(ultra, "latios") > 40);
  assert.ok(score(ultra, "solgaleo") > 40);
  assert.ok(score(ultra, "mewtwo") > score(ultra, "alakazam"));
  assert.ok(score(ultra, "alakazam") > score(ultra, "pikachu"));
  assert.ok(score(ultra, "necrozma") > score(ultra, "latios"));
  const topForms = game
    .ranking(byKey.get(ultra).id)
    .slice(1, 4)
    .map((r) => game.byId.get(r.id).key);
  assert.deepEqual(
    new Set(topForms),
    new Set(["necrozma", "necrozma-dusk", "necrozma-dawn"]),
  );
  assert.ok(score("bulbasaur", "ivysaur") > score("bulbasaur", "oddish"));
  assert.ok(
    score("vulpix-alola", "ninetales-alola") > score("vulpix-alola", "cubchoo"),
  );
});

test("proximity labels require both global rank and minimum score, including exact boundaries", () => {
  assert.deepEqual(proximityFor(1, 1579, 100), { tone: "hot", label: "정답" });
  assert.deepEqual(proximityFor(8, 1579, 45.15), {
    tone: "hot",
    label: "매우 가까움",
  });
  assert.deepEqual(proximityFor(8, 1579, 35), {
    tone: "warm",
    label: "가까움",
  });
  assert.deepEqual(proximityFor(8, 1579, 24), {
    tone: "cool",
    label: "거리가 있음",
  });
  for (const [rank, score, tone] of [
    [15, 40, "hot"],
    [15, 39.99, "warm"],
    [16, 99.9, "warm"],
    [157, 25, "warm"],
    [157, 24.99, "cool"],
    [158, 99.9, "cool"],
    [8, 25, "warm"],
    [8, 24.99, "cool"],
    [2, 0, "cool"],
    [1579, 99.9, "cool"],
  ])
    assert.equal(
      proximityFor(rank, 1579, score).tone,
      tone,
      `${rank} / ${score}`,
    );
  assert.equal(proximityFor(2, 200, 40).tone, "hot");
  assert.equal(proximityFor(3, 200, 40).tone, "warm");
  assert.equal(proximityFor(20, 200, 25).tone, "warm");
  assert.equal(proximityFor(21, 200, 25).tone, "cool");
});

test("daily targets cover every playable form, remain deterministic and use Korean midnight", () => {
  const found = new Set();
  const origin = Date.parse("2026-01-01T00:00:00Z");
  for (let i = 0; i < data.pokemon.length; i++) {
    const date = new Date(origin + i * 86400000).toISOString().slice(0, 10);
    const id = dailyTarget(data, date);
    found.add(id);
    assert.ok(game.byId.has(id));
    assert.equal(id, dailyTarget(data, date));
  }
  assert.equal(found.size, game.pokemon.length);
  assert.equal(dayKey(new Date("2026-09-10T14:59:59Z")), "2026-09-10");
  assert.equal(dayKey(new Date("2026-09-10T15:00:00Z")), "2026-09-11");
  assert.equal(resolveDay("2026-09-12", "2026-09-10"), "2026-09-10");
  assert.equal(validDay("2026-02-30"), false);
  assert.equal(validDay("2024-02-29"), true);
});

test("form-aware guessing rejects duplicates and hint guesses progress without revealing the answer", () => {
  const round = newRound(data, "2026-09-10");
  const target = 10205;
  const ranked = game.ranking(target);
  assert.equal(ranked[0].id, target);
  assert.equal(ranked[0].rank, 1);
  assert.equal(submitGuess(round, 37, target, game.byId), "ok");
  assert.equal(isWon(round, target), false);
  assert.equal(submitGuess(round, 37, target, game.byId), "duplicate");
  for (let i = 0; i < MAX_HINTS; i++) {
    const id = nextHint(round, ranked);
    if (id === null) break;
    const previous = Math.max(
      ...round.guesses.map((g) => game.score(target, g.id)),
    );
    assert.notEqual(id, target);
    assert.ok(game.score(target, id) > previous);
    assert.equal(submitGuess(round, id, target, game.byId, true), "ok");
  }
  assert.equal(submitGuess(round, target, target, game.byId), "ok");
  assert.equal(isWon(round, target), true);
  assert.equal(submitGuess(round, 25, target, game.byId), "finished");
  for (let i = 1; i < ranked.length; i++) {
    if (ranked[i].score === ranked[i - 1].score)
      assert.equal(ranked[i].rank, ranked[i - 1].rank);
    else assert.equal(ranked[i].rank, i + 1);
  }
});

test("round storage is isolated by date and version and rejects corrupted guesses", () => {
  const day = "2026-09-10";
  const round = newRound(data, day);
  round.guesses = [
    { id: 37, hint: false },
    { id: 10205, hint: true },
  ];
  assert.deepEqual(restoreRound(JSON.stringify(round), data, day), round);
  for (const raw of [
    "{broken",
    "null",
    JSON.stringify({ ...round, day: "2026-09-09" }),
    JSON.stringify({ ...round, version: "bad" }),
    JSON.stringify({ ...round, guesses: [{ id: -1, hint: false }] }),
    JSON.stringify({ ...round, guesses: [round.guesses[0], round.guesses[0]] }),
  ])
    assert.deepEqual(restoreRound(raw, data, day), newRound(data, day));
});

test("all image references are local and missing artwork is explicitly accounted for", () => {
  for (const p of data.pokemon) {
    if (p.image)
      assert.ok(data.images[p.image].startsWith("data:image/png;base64,iVBOR"));
    else assert.ok(data.missingImages.includes(p.key));
  }
  assert.ok(data.pokemon.filter((p) => p.image).length > 1500);
});
