import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createScratch,
  COUNT,
  SIZE,
  RANKS,
  rankFor,
  settingsFromSearch,
  challengeKey,
  storageKey,
  newRound,
  current,
  isEnded,
  area,
  potentialScore,
  eraseMask,
  erase,
  guess,
  giveUp,
  advance,
  totalScore,
  serializeRound,
  restoreRound,
  packMask,
  unpackMask,
  searchCandidates,
} from "../web/src/scratch-engine.js";
const read = (file) =>
  JSON.parse(
    readFileSync(new URL(`../web/public/${file}.json`, import.meta.url)),
  );
const data = read("scratch"),
  catalog = read("pokemantle"),
  game = createScratch(catalog, data);
const settings = { mode: "daily", day: "2026-09-15" };
const snapshot = (r) => JSON.parse(serializeRound(r));

test("scratch pool contains base, regional and Mega forms with bounded, local artwork", () => {
  assert.equal(game.pokemon.length, 1179);
  const keys = new Set(game.pokemon.map((p) => p.key));
  for (const key of [
    "mew",
    "arceus",
    "charizard-mega-x",
    "vulpix-alola",
    "growlithe-hisui",
  ])
    assert.ok(keys.has(key), key);
  for (const key of [
    "pichu-spiky-eared",
    "pikachu-gmax",
    "arceus-unknown",
    "zygarde-complete",
  ])
    assert.ok(!keys.has(key), key);
  assert.equal(
    new Set(game.pokemon.map((p) => p.id)).size,
    game.pokemon.length,
  );
  assert.ok(
    game.pokemon.every(
      (p) =>
        area(p) > 0 &&
        p.frame[0] + p.frame[2] <= SIZE &&
        p.frame[1] + p.frame[3] <= SIZE,
    ),
  );
});
test("five daily targets are reproducible, cross-species and independent of practice and language", () => {
  for (let day = 1; day <= 28; day++) {
    const s = { mode: "daily", day: `2026-09-${String(day).padStart(2, "0")}` };
    const a = game.targets(s),
      b = game.targets({ ...s });
    assert.equal(a.length, COUNT);
    assert.deepEqual(a, b);
    assert.equal(
      new Set(a.map((id) => game.byId.get(id).speciesId)).size,
      COUNT,
    );
    assert.notDeepEqual(a, game.targets({ mode: "practice", seed: s.day }));
  }
  assert.notDeepEqual(
    game.targets(settings),
    game.targets({ ...settings, day: "2026-09-16" }),
  );
  assert.notEqual(
    storageKey(game, settings),
    storageKey(game, { mode: "practice", seed: "2026-09-15" }),
  );
});
test("URL settings reject bad/future dates and unsafe practice seeds", () => {
  for (const query of [
    "?date=2026-02-30",
    "?date=2030-01-01",
    "?mode=practice&seed=%3Cscript%3E",
  ])
    assert.deepEqual(settingsFromSearch(query, "2026-09-15"), settings);
  assert.deepEqual(
    settingsFromSearch("?mode=practice&seed=test-a_1", "2026-09-15"),
    { mode: "practice", seed: "test-a_1" },
  );
  assert.throws(() => challengeKey({ mode: "daily", day: "bad" }));
});
test("fixed-resolution erasing charges only new pixels within the tightly cropped frame", () => {
  const frame = [40, 40, 100, 100],
    mask = new Uint8Array(SIZE * SIZE);
  assert.equal(eraseMask(mask, frame, [0, 0], [0, 0], 8).length, 0);
  const first = eraseMask(mask, frame, [80, 80], [80, 80], 8);
  assert.ok(first.length > 190 && first.length < 220);
  assert.equal(eraseMask(mask, frame, [80, 80], [80, 80], 8).length, 0);
  const second = eraseMask(mask, frame, [80, 80], [100, 80], 8);
  assert.ok(second.length > 0);
  assert.equal(
    mask.reduce((a, b) => a + b, 0),
    first.length + second.length,
  );
  const one = new Uint8Array(SIZE * SIZE),
    split = new Uint8Array(SIZE * SIZE);
  eraseMask(one, frame, [45, 65], [130, 90], 12);
  eraseMask(split, frame, [45, 65], [87.5, 77.5], 12);
  eraseMask(split, frame, [87.5, 77.5], [130, 90], 12);
  assert.deepEqual(one, split);
  for (const radius of [-1, 0, 41, NaN])
    assert.equal(eraseMask(mask, frame, [80, 80], [80, 80], radius).length, 0);
});
test("point examples, rounding, correct-answer minimum and all trainer cutoffs", () => {
  assert.equal(potentialScore(12, 100, 0), 70);
  assert.equal(potentialScore(30, 100, 1), 36);
  assert.equal(potentialScore(100, 100, 0), 10);
  assert.equal(potentialScore(100, 100, 30), 10);
  for (let i = 0; i < RANKS.length; i++) {
    assert.equal(rankFor(RANKS[i].min), RANKS[i].rank);
    if (i < RANKS.length - 1)
      assert.equal(rankFor(RANKS[i].min - 1), RANKS[i + 1].rank);
  }
  for (const invalid of [-1, 501, 2.5, NaN])
    assert.equal(rankFor(invalid), null);
});

test("exponential scoring falls fastest early and depends only on the total revealed fraction", () => {
  const percentages = [0, 5, 10, 20, 30, 50, 100];
  assert.deepEqual(
    percentages.map((p) => potentialScore(p, 100, 0)),
    [100, 86, 74, 55, 41, 22, 10],
  );
  let previous = 100;
  for (let p = 0; p <= 100; p += 0.1) {
    const score = potentialScore(p, 100, 0);
    assert.ok(score <= previous && score >= 10);
    assert.ok(score <= Math.max(10, Math.round(100 - p)));
    previous = score;
  }
  const earlyDrop = potentialScore(0, 100, 0) - potentialScore(10, 100, 0);
  const laterDrop = potentialScore(40, 100, 0) - potentialScore(50, 100, 0);
  assert.ok(earlyDrop > laterDrop);
  assert.equal(potentialScore(1200, 10000, 1), potentialScore(12, 100, 1));
});

const legacySave = (round) => {
  const saved = snapshot(round);
  for (const item of saved.items) {
    delete item.scoreVersion;
    if (item.outcome === "solved")
      item.points = Math.max(
        10,
        Math.round(
          100 -
            (100 * item.erased) / area(game.byId.get(item.id)) -
            5 * (item.guesses.length - 1),
        ),
      );
  }
  return saved;
};

test("legacy progress keeps earned points, guesses and masks while unfinished pictures adopt the new curve", () => {
  const old = newRound(game, settings);
  erase(old, game, [100, 100], [160, 160], 16);
  guess(old, game, current(old).id);
  advance(old);
  erase(old, game, [100, 100], [160, 160], 16);
  const wrong = game.pokemon.find(
    (p) => p.art !== game.byId.get(current(old).id).art,
  );
  guess(old, game, wrong.id);
  const saved = legacySave(old);
  const restored = restoreRound(JSON.stringify(saved), game, settings);
  assert.equal(restored.index, 1);
  assert.equal(restored.items[0].points, saved.items[0].points);
  assert.equal(restored.items[0].scoreVersion, 1);
  assert.deepEqual(current(restored).mask, current(old).mask);
  assert.deepEqual(current(restored).guesses, [wrong.id]);
  assert.equal(current(restored).scoreVersion, 2);
  const expected = potentialScore(
    current(restored).erased,
    area(game.byId.get(current(restored).id)),
    1,
  );
  guess(restored, game, current(restored).id);
  assert.equal(current(restored).points, expected);
  const serialized = serializeRound(restored);
  assert.equal(
    serializeRound(restoreRound(serialized, game, settings)),
    serialized,
  );
  assert.deepEqual(
    restored.items.map((p) => p.id),
    game.targets(settings),
  );
});

test("completed legacy rounds retain their total and rank instead of being reset or rescored", () => {
  const old = newRound(game, settings);
  for (let i = 0; i < COUNT; i++) {
    erase(old, game, [100, 100], [160, 160], 16);
    guess(old, game, current(old).id);
    if (i < COUNT - 1) advance(old);
  }
  const saved = legacySave(old),
    total = saved.items.reduce((sum, item) => sum + item.points, 0);
  const restored = restoreRound(JSON.stringify(saved), game, settings);
  assert.ok(isEnded(restored));
  assert.equal(totalScore(restored), total);
  assert.equal(rankFor(totalScore(restored)), rankFor(total));
  assert.equal(advance(restored), false);
  assert.equal(
    totalScore(restoreRound(serializeRound(restored), game, settings)),
    total,
  );
  saved.items[0].points++;
  assert.equal(
    isEnded(restoreRound(JSON.stringify(saved), game, settings)),
    false,
  );
});
test("wrong guesses cost five, duplicates cost nothing, and image-equivalent names are accepted", () => {
  const round = newRound(game, settings),
    item = current(round),
    target = game.byId.get(item.id);
  const wrong = game.pokemon.find((p) => p.art !== target.art);
  const before = potentialScore(0, area(target), 0);
  assert.equal(guess(round, game, wrong.id), "incorrect");
  assert.equal(
    before - potentialScore(item.erased, area(target), item.guesses.length),
    5,
  );
  assert.equal(guess(round, game, wrong.id), "duplicate");
  assert.equal(item.guesses.length, 1);
  const alias = game.pokemon.find((p) => p.art === target.art);
  assert.equal(guess(round, game, alias.id), "correct");
  assert.equal(item.points, 95);
  assert.equal(guess(round, game, target.id), "locked");
  assert.deepEqual(erase(round, game, [128, 128], [128, 128], 8), []);
  assert.equal(giveUp(round), false);
});
test("different form IDs using identical visible artwork count as the same answer", () => {
  const male = game.pokemon.find((p) => p.key === "meowstic-male-mega");
  const female = game.pokemon.find((p) => p.key === "meowstic-female-mega");
  assert.notEqual(male.id, female.id);
  assert.equal(male.art, female.art);
  const equivalent = {
    ...game,
    targets: () => [male.id, ...game.targets(settings).slice(1)],
  };
  const round = newRound(equivalent, settings);
  assert.equal(guess(round, equivalent, female.id), "correct");
  assert.equal(current(round).points, 100);
  assert.equal(
    current(restoreRound(serializeRound(round), equivalent, settings)).outcome,
    "solved",
  );
});

test("all five pictures persist exact masks and scores; completed rounds cannot restart", () => {
  let round = newRound(game, settings);
  for (let i = 0; i < COUNT; i++) {
    assert.equal(advance(round), false);
    erase(round, game, [100, 100], [160, 160], 10);
    const saved = serializeRound(round);
    round = restoreRound(saved, game, settings);
    assert.equal(serializeRound(round), saved);
    assert.ok(current(round).erased > 0);
    assert.equal(guess(round, game, current(round).id), "correct");
    const completed = serializeRound(round);
    assert.equal(JSON.parse(completed).items[i].mask, null);
    round = restoreRound(completed, game, settings);
    assert.equal(serializeRound(round), completed);
    if (i < COUNT - 1) assert.ok(advance(round));
  }
  assert.ok(isEnded(round));
  assert.equal(advance(round), false);
  assert.ok(totalScore(round) > 0 && totalScore(round) < 500);
});
test("revealing earns zero, restores without uncovering future answers and ends only after five", () => {
  let r = newRound(game, settings);
  for (let i = 0; i < COUNT; i++) {
    assert.ok(giveUp(r));
    assert.equal(current(r).points, 0);
    r = restoreRound(serializeRound(r), game, settings);
    assert.equal(current(r).outcome, "given-up");
    if (i < COUNT - 1) {
      assert.equal(isEnded(r), false);
      assert.ok(advance(r));
    }
  }
  assert.ok(isEnded(r));
  assert.equal(totalScore(r), 0);
  assert.equal(rankFor(totalScore(r)), "E");
});
test("corrupted saves, forged scores, future progress and masks outside the crop are rejected", () => {
  const start = newRound(game, settings),
    base = snapshot(start);
  const invalid = [];
  for (const change of [
    (r) => (r.version = "old"),
    (r) => (r.challenge = "practice:other"),
    (r) => (r.index = 5),
    (r) => (r.index = 1),
    (r) => (r.items[0].points = 100),
    (r) => (r.items[0].scoreVersion = 3),
    (r) => (r.items[0].scoreVersion = null),
    (r) => (r.items[0].erased = 10),
    (r) => (r.items[0].mask = "bad"),
    (r) => (r.items[0].guesses = [-1]),
    (r) => (r.items[0].guesses = [r.items[0].id]),
    (r) => (r.items[1].outcome = "given-up"),
    (r) => (r.items[1].erased = 1),
  ]) {
    const r = structuredClone(base);
    change(r);
    invalid.push(r);
  }
  const outside = structuredClone(base),
    mask = new Uint8Array(SIZE * SIZE);
  mask[0] = 1;
  outside.items[0].mask = packMask(mask);
  outside.items[0].erased = 1;
  invalid.push(outside);
  for (const value of [null, "bad", ...invalid])
    assert.equal(
      serializeRound(restoreRound(JSON.stringify(value), game, settings)),
      serializeRound(start),
    );
  assert.deepEqual(unpackMask(packMask(mask)), mask);
  assert.throws(() => unpackMask("x"));
});
test("bilingual search returns only candidates and bad exports fail explicitly", () => {
  for (const query of ["피카츄", "Pikachu", "25"])
    assert.ok(searchCandidates(game, query).some((p) => p.speciesId === 25));
  for (const query of ["메가 리자몽", "Mega Charizard"])
    assert.ok(
      searchCandidates(game, query).some((p) => p.key === "charizard-mega-x"),
    );
  assert.equal(searchCandidates(game, "pichu-spiky-eared").length, 0);
  assert.throws(() =>
    createScratch(catalog, { ...data, catalogVersion: "bad" }),
  );
  assert.throws(() =>
    createScratch(catalog, {
      ...data,
      pokemon: [data.pokemon[0], data.pokemon[0]],
    }),
  );
  assert.throws(() =>
    createScratch(catalog, {
      ...data,
      pokemon: data.pokemon.map((p, i) =>
        i ? p : { ...p, frame: [0, 0, 257, 1] },
      ),
    }),
  );
});
