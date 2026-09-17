import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TRAINERS, trainerFor, trainerResultKey } from "../web/src/trainers.js";
import {
  GUESS_RANKS,
  CLUE_GUESS_RANKS,
  rankFor,
  streakRankFor,
} from "../web/src/trainer-ranks.js";
import { rankFor as scratchRankFor } from "../web/src/scratch-engine.js";

test("six Alola ranks have unique bilingual names and credited local sprites", () => {
  assert.deepEqual(Object.keys(TRAINERS), ["S", "A", "B", "C", "D", "E"]);
  assert.equal(TRAINERS.S[0].ko, "알로라 챔피언");
  assert.equal(TRAINERS.S[0].en, "Alola Champion");
  assert.equal(TRAINERS.A[0].ko, "하우");
  assert.equal(TRAINERS.A[0].en, "Hau");
  const trainers = Object.values(TRAINERS).flat();
  for (const field of ["id", "ko", "en"])
    assert.equal(new Set(trainers.map((p) => p[field])).size, trainers.length);
  for (const p of trainers) {
    assert.ok(["SM", "USUM"].includes(p.game));
    assert.ok(["Beliot419", "kyledove"].includes(p.artist));
    assert.match(p.id, /^[a-z-]+$/);
    const bytes = readFileSync(
      new URL(`../web/src/assets/trainers/${p.sprite}.png`, import.meta.url),
    );
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), 80);
    assert.equal(bytes.readUInt32BE(20), 80);
  }
});

test("Selene, Hau, Ace Trainer, Lillie and Tourist stay fixed in every game", () => {
  for (const game of ["pokemantle", "pokeclue", "highlow", "scratch"])
    for (let i = 0; i < 100; i++) {
      const key = trainerResultKey(game, `daily:${i}`, i);
      assert.equal(trainerFor("S", key).id, "selene");
      assert.equal(trainerFor("A", key).id, "hau");
      assert.equal(trainerFor("C", key).id, "ace-trainer");
      assert.equal(trainerFor("D", key).id, "lillie");
      assert.equal(trainerFor("E", key).id, "tourist");
    }
});

test("the USUM Elite Four vary by challenge and remain reproducible", () => {
  assert.deepEqual(TRAINERS.B.map((p) => p.id), ["acerola", "olivia", "kahili", "molayne"]);
  for (const rank of ["B"]) {
    assert.equal(TRAINERS[rank].length, 4);
    for (const game of ["pokemantle", "pokeclue", "highlow", "scratch"]) {
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
    assert.equal(`${trainer.ko}`, tier.label);
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

test("Alola Champion restores the top band without changing Hau or lower cutoffs", () => {
  const ranks = ["S", "A", "B", "C", "D", "E"];
  const cases = [
    {
      rank: rankFor,
      start: 1,
      end: 60,
      cutoffs: [5, 10, 20, 30, 40, Infinity],
      lowerIsBetter: true,
    },
    {
      rank: (count) => rankFor(count, CLUE_GUESS_RANKS),
      start: 1,
      end: 60,
      cutoffs: [3, 5, 8, 11, 15, Infinity],
      lowerIsBetter: true,
    },
    {
      rank: streakRankFor,
      start: 0,
      end: 30,
      cutoffs: [20, 15, 10, 6, 3, 0],
    },
    {
      rank: scratchRankFor,
      start: 0,
      end: 500,
      cutoffs: [450, 375, 300, 225, 125, 0],
    },
  ];
  for (const sample of cases) {
    for (let value = sample.start; value <= sample.end; value++) {
      const index = sample.cutoffs.findIndex((cutoff) =>
        sample.lowerIsBetter ? value <= cutoff : value >= cutoff,
      );
      assert.equal(sample.rank(value), ranks[index]);
    }
  }
});
