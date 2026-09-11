import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TRAINERS, trainerFor, trainerResultKey } from "../web/src/trainers.js";
import { GUESS_RANKS } from "../web/src/trainer-ranks.js";

test("curated trainers have unique bilingual names and local Gen IV sprites", () => {
  assert.deepEqual(Object.keys(TRAINERS), ["S", "A", "B", "C", "D", "E"]);
  const trainers = Object.values(TRAINERS).flat();
  for (const field of ["id", "ko", "en"])
    assert.equal(new Set(trainers.map((p) => p[field])).size, trainers.length);
  for (const p of trainers) {
    assert.ok(["DPPt", "HGSS"].includes(p.game));
    assert.match(p.id, /^[a-z-]+$/);
    const bytes = readFileSync(
      new URL(`../web/src/assets/trainers/${p.sprite}.png`, import.meta.url),
    );
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), 80);
    assert.equal(bytes.readUInt32BE(20), 80);
  }
});

test("Red and Joey stay fixed in every game, challenge and score", () => {
  for (const game of ["pokemantle", "pokeclue", "highlow"])
    for (let i = 0; i < 100; i++) {
      const key = trainerResultKey(game, `daily:${i}`, i);
      assert.equal(trainerFor("S", key).id, "red");
      assert.equal(trainerFor("E", key).id, "joey");
    }
});

test("each middle tier varies by challenge, stays within its pool and is reproducible", () => {
  for (const rank of ["A", "B", "C", "D"]) {
    assert.ok(TRAINERS[rank].length >= 3);
    for (const game of ["pokemantle", "pokeclue", "highlow"]) {
      const counts = new Map(TRAINERS[rank].map((p) => [p.id, 0]));
      for (let i = 0; i < 300; i++) {
        const key = trainerResultKey(game, `practice:${i}`, 10);
        const selected = trainerFor(rank, key);
        assert.ok(TRAINERS[rank].includes(selected));
        assert.equal(trainerFor(rank, key), selected);
        counts.set(selected.id, counts.get(selected.id) + 1);
      }
      assert.ok([...counts.values()].every((count) => count > 30));
    }
  }
});

test("help representatives match the existing rank metadata", () => {
  for (const tier of GUESS_RANKS) {
    const trainer = trainerFor(tier.rank);
    assert.equal(`${trainer.ko}급`, tier.label);
    assert.equal(trainer.sprite, tier.sprite);
  }
});

test("result identity distinguishes game, difficulty, daily/practice and score", () => {
  const identities = [
    ["pokemantle", "2026-09-11", 10],
    ["pokeclue", "daily:2026-09-11", 10],
    ["pokeclue", "practice:2026-09-11", 10],
    ["highlow", "daily:2026-09-11", 10],
    ["highlow", "normal:daily:2026-09-11", 10],
    ["highlow", "normal:daily:2026-09-11", 11],
  ].map((args) => trainerResultKey(...args));
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(
    trainerResultKey("pokeclue", "daily:2026-09-11", 10),
    identities[1],
  );
});

test("unearned and invalid ranks do not select a trainer", () => {
  for (const rank of [null, undefined, "", "Z", "toString", "__proto__"])
    assert.equal(trainerFor(rank, "result"), null);
});
