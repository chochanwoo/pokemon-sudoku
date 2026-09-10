import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

test("all 1579 forms are distinct, named, searchable and use actual form-specific types", () => {
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
  assert.equal(data.weights.abilities, 10);
  assert.equal(data.weights.moves, 10);
  assert.ok(game.score(37, 10205) < 100);
  assert.throws(() => createSimilarity(data, new ArrayBuffer(4)));
  assert.throws(() => game.score(-1, 37));
});

test("daily targets cover every form, remain deterministic and use Korean midnight", () => {
  const found = new Set();
  const origin = Date.parse("2026-01-01T00:00:00Z");
  for (let i = 0; i < data.pokemon.length; i++) {
    const date = new Date(origin + i * 86400000).toISOString().slice(0, 10);
    const id = dailyTarget(data, date);
    found.add(id);
    assert.equal(id, dailyTarget(data, date));
  }
  assert.equal(found.size, data.pokemon.length);
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
