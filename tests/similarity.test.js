import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isPlayableForm } from "../web/src/form-policy.js";
import { pokemantleForms } from "../web/src/pokemantle-forms.js";
import { englishName } from "../web/src/pokemon-names.js";
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

test("cosmetic variations share one named, searchable Pokemantle entry without changing raw data", () => {
  const before = JSON.stringify(data.pokemon);
  const { pokemon, canonicalIdById } = pokemantleForms(data.pokemon);
  for (const [speciesId, name, english, count] of [
    [201, "안농", "Unown", 1],
    [412, "도롱충이", "Burmy", 1],
    [414, "나메일", "Mothim", 1],
    [422, "깝질무", "Shellos", 1],
    [423, "트리토돈", "Gastrodon", 1],
    [585, "사철록", "Deerling", 1],
    [586, "바라철록", "Sawsbuck", 1],
    [592, "탱그릴", "Frillish", 1],
    [593, "탱탱겔", "Jellicent", 1],
    [664, "분이벌레", "Scatterbug", 1],
    [665, "분떠도리", "Spewpa", 1],
    [666, "비비용", "Vivillon", 1],
    [668, "화염레오", "Pyroar", 2],
    [669, "플라베베", "Flabébé", 1],
    [670, "플라엣테", "Floette", 3],
    [671, "플라제스", "Florges", 1],
    [676, "트리미앙", "Furfrou", 1],
    [716, "제르네아스", "Xerneas", 1],
    [801, "마기아나", "Magearna", 2],
    [854, "데인차", "Sinistea", 1],
    [855, "포트데스", "Polteageist", 1],
    [869, "마휘핑", "Alcremie", 2],
    [925, "파밀리쥐", "Maushold", 1],
    [982, "노고고치", "Dudunsparce", 1],
    [1007, "코라이돈", "Koraidon", 1],
    [1008, "미라이돈", "Miraidon", 1],
    [1012, "차데스", "Poltchageist", 1],
    [1013, "그우린차", "Sinistcha", 1],
  ]) {
    const base = game.byId.get(speciesId);
    assert.equal(base.name, name);
    assert.equal(englishName(base), english);
    assert.equal(pokemon.filter((p) => p.speciesId === speciesId).length, count);
    for (const p of data.pokemon.filter((p) => p.pokemonId === speciesId && isPlayableForm(p))) {
      for (const query of [p.name, p.key, englishName(p), String(p.id)]) {
        assert.ok(searchForms(pokemon, query).some((r) => r.id === canonicalIdById.get(p.id)), query);
        assert.ok(!searchForms(pokemon, query).some((r) => r.speciesId === speciesId && r.id !== base.id && r.pokemonId === speciesId));
      }
    }
  }
  assert.equal(searchForms(pokemon, "분떠도리").length, 1);
  assert.equal(searchForms(pokemon, "ㅂㄸㄷㄹ")[0].id, 665);
  assert.equal(searchForms(data.pokemon, "분떠도리").length, 19);
  assert.equal(JSON.stringify(data.pokemon), before);
});

test("cosmetic colors merge within battle forms and equivalent guesses use the same score and rank", () => {
  const p = (key) => data.pokemon.find((p) => p.key === key);
  const { canonicalIdById } = pokemantleForms(data.pokemon);
  const minior = game.pokemon.filter((p) => p.speciesId === 774);
  assert.deepEqual(minior.map((p) => p.name), ["메테노 (유성의 모습)", "메테노 (코어의 모습)"]);
  assert.deepEqual(minior.map(englishName), ["Minior (Meteor Form)", "Minior (Core Form)"]);
  for (const keys of [
    ["minior-red-meteor", "minior-blue-meteor"],
    ["minior-red", "minior-blue"],
    ["spewpa-icy-snow", "spewpa-meadow"],
    ["maushold-family-of-four", "maushold-family-of-three"],
    ["magearna-mega", "magearna-original-mega"],
  ]) {
    const [a, b] = keys.map(p);
    assert.equal(canonicalIdById.get(a.id), canonicalIdById.get(b.id));
    assert.equal(game.score(a.id, b.id), 100);
    assert.equal(game.score(25, a.id), game.score(25, b.id));
    assert.deepEqual(game.ranking(a.id), game.ranking(b.id));
  }
  for (const [a, b] of [
    ["minior-red-meteor", "minior-red"],
    ["alcremie-vanilla-cream-strawberry-sweet", "alcremie-gmax"],
    ["floette-red", "floette-eternal"],
    ["wormadam-plant", "wormadam-sandy"],
    ["meowstic-male", "meowstic-female"],
    ["arceus-normal", "arceus-water"],
    ["silvally-normal", "silvally-water"],
    ["genesect", "genesect-burn"],
    ["cherrim-overcast", "cherrim-sunshine"],
    ["tatsugiri-curly", "tatsugiri-droopy"],
    ["squawkabilly-green-plumage", "squawkabilly-yellow-plumage"],
  ]) {
    assert.notEqual(canonicalIdById.get(p(a).id), canonicalIdById.get(p(b).id));
    assert.ok(game.score(p(a).id, p(b).id) < 100);
  }
  const round = newRound(data, "2026-09-10");
  for (const [query, result] of [["spewpa meadow", "ok"], ["spewpa polar", "duplicate"]]) {
    const [choice] = searchForms(game.pokemon, query);
    assert.equal(submitGuess(round, choice.id, round.target, game.byId), result);
  }
  const ranked = game.ranking(665);
  assert.equal(ranked.filter((r) => game.byId.get(r.id).speciesId === 665).length, 1);
  for (let i = 0; i < MAX_HINTS; i++) {
    const hint = nextHint(round, game.ranking(round.target));
    if (hint === null) break;
    assert.notEqual(game.byId.get(hint).speciesId, 665);
    assert.equal(submitGuess(round, hint, round.target, game.byId, true), "ok");
  }
});

test("old cosmetic guesses migrate, deduplicate and credit the first correct form, including give-ups", () => {
  const id = (key) => data.pokemon.find((p) => p.key === key).id;
  const day = "2026-09-12";
  const meadow = id("spewpa-meadow");
  const polar = id("spewpa-polar");
  const legacy = {
    version: data.version, day, target: meadow, gaveUp: false,
    guesses: [{ id: 25, hint: false }, { id: polar, hint: false }, { id: 381, hint: true }],
  };
  const expected = {
    ...newRound(data, day),
    guesses: [{ id: 25, hint: false }, { id: 665, hint: false }],
  };
  for (const previous of [
    legacy,
    { ...legacy, target: undefined },
    { ...legacy, gaveUp: true },
    { ...legacy, guesses: [...legacy.guesses, { id: meadow, hint: false }] },
    { ...legacy, guesses: [{ id: 25, hint: false }, { id: 665, hint: false }] },
  ]) {
    const restored = restoreRound(JSON.stringify(previous), data, day);
    assert.deepEqual(restored, expected);
    assert.equal(isWon(restored, 665), true);
    assert.deepEqual(restoreRound(JSON.stringify(restored), data, day), expected);
  }
  const unfinished = { ...legacy, guesses: [{ id: 25, hint: false }] };
  assert.deepEqual(restoreRound(JSON.stringify(unfinished), data, day), { ...unfinished, target: 665 });

  const otherDay = "2026-09-10";
  const duplicates = {
    ...newRound(data, otherDay),
    guesses: [
      { id: polar, hint: true }, { id: meadow, hint: false },
      { id: 25, hint: false }, { id: 381, hint: true },
    ],
  };
  assert.deepEqual(restoreRound(JSON.stringify(duplicates), data, otherDay).guesses, [
    { id: 665, hint: true }, ...duplicates.guesses.slice(2),
  ]);
  for (const corrupt of [
    { ...expected, guesses: [...expected.guesses, { id: 381, hint: false }] },
    { ...expected, gaveUp: true },
    { ...expected, target: 25 },
  ]) assert.deepEqual(restoreRound(JSON.stringify(corrupt), data, day), newRound(data, day));
});

test("only explicit commemorative forms are excluded, never whole mythical species", () => {
  const removed = data.pokemon.filter((p) => !isPlayableForm(p));
  assert.equal(removed.length, 20);
  assert.equal(game.pokemon.length, 1351);
  assert.equal(game.byId.size, 1351);
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
    "magearna",
    "vivillon-meadow",
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

test("legacy dates only replace excluded or cosmetic forms within the same species", () => {
  const legacyData = {
    ...data,
    pokemon: data.pokemon.map((p) => ({ ...p, key: "", pokemonId: undefined })),
  };
  const byId = new Map(data.pokemon.map((p) => [p.id, p]));
  const origin = Date.parse("2026-09-12T00:00:00Z") - (data.pokemon.length - 1) * 86400000;
  let changed = 0;
  for (let i = 0; i < data.pokemon.length; i++) {
    const day = new Date(origin + i * 86400000).toISOString().slice(0, 10);
    const before = dailyTarget(legacyData, day);
    const after = dailyTarget(data, day);
    if (game.byId.has(before)) assert.equal(after, before);
    else {
      changed++;
      assert.ok(game.byId.has(after));
      assert.equal(byId.get(after).speciesId, byId.get(before).speciesId);
    }
  }
  assert.equal(changed, data.pokemon.length - game.pokemon.length);
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

test("future daily targets cover each merged entry once per cycle and use Korean midnight", () => {
  const found = new Set();
  const origin = Date.parse("2026-09-13T00:00:00Z");
  for (let i = 0; i < game.pokemon.length; i++) {
    const date = new Date(origin + i * 86400000).toISOString().slice(0, 10);
    const id = dailyTarget(data, date);
    assert.ok(!found.has(id));
    found.add(id);
    assert.ok(game.byId.has(id));
    assert.equal(id, dailyTarget(data, date));
  }
  assert.equal(found.size, game.pokemon.length);
  assert.equal(dailyTarget(data, "2026-09-12"), 665);
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
