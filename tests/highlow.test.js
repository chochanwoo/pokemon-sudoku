import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createHighLow,
  STATS,
  statInfo,
  statValue,
  profileKey,
  lastPracticeKey,
  MAX_QUESTIONS,
  settingsFromSearch,
  challengeKey,
  storageKey,
  newRound,
  currentIndex,
  score,
  isEnded,
  submitChoice,
  nextQuestion,
  restoreRound,
  dayKey,
} from "../web/src/highlow-engine.js";
import { isPlayableForm } from "../web/src/form-policy.js";
import english from "../web/src/locales/en.js";
import {
  HIGHLOW_STREAK_RANKS,
  GUESS_RANKS,
  CLUE_GUESS_RANKS,
  rankFor,
  streakRankFor,
} from "../web/src/trainer-ranks.js";

const read = (name) =>
  JSON.parse(
    readFileSync(new URL(`../web/public/${name}.json`, import.meta.url)),
  );
const catalog = read("pokemantle"),
  bundle = read("highlow");
const game = createHighLow(catalog, bundle);
const settings = { mode: "daily", day: "2026-09-11", difficulty: "hard" };
const normal = { ...settings, difficulty: "normal" };
const opposite = (side) => (side === "left" ? "right" : "left");
const restore = (value) => restoreRound(JSON.stringify(value), game, settings);

test("streak ranks rise with correct answers and apply every difficulty boundary inclusively", () => {
  for (const [difficulty, thresholds] of Object.entries({
    normal: [20, 15, 10, 6, 3, 0],
    hard: [12, 9, 6, 4, 2, 0],
  })) {
    assert.deepEqual(
      HIGHLOW_STREAK_RANKS[difficulty].map((t) => t.min),
      thresholds,
    );
    for (const [index, tier] of HIGHLOW_STREAK_RANKS[difficulty].entries()) {
      assert.equal(streakRankFor(tier.min, difficulty), tier.rank);
      if (index)
        assert.equal(
          streakRankFor(thresholds[index - 1] - 1, difficulty),
          tier.rank,
        );
      if (tier.min)
        assert.equal(
          streakRankFor(tier.min - 1, difficulty),
          GUESS_RANKS[index + 1].rank,
        );
    }
    for (let count = 0; count <= MAX_QUESTIONS; count++) {
      const index = thresholds.findIndex((min) => count >= min);
      assert.equal(streakRankFor(count, difficulty), GUESS_RANKS[index].rank);
      if (count)
        assert.ok(
          GUESS_RANKS.findIndex(
            (t) => t.rank === streakRankFor(count - 1, difficulty),
          ) >= index,
        );
    }
    assert.equal(streakRankFor(0, difficulty), "E");
    for (const count of [-1, 0.5, "12", null, undefined, NaN, Infinity])
      assert.equal(streakRankFor(count, difficulty), null);
  }
  for (const difficulty of ["", null, "invalid", "toString", "__proto__"])
    assert.equal(streakRankFor(12, difficulty), null);
});

test("streak ranks reuse the six trainers without changing the guess-based rankings", () => {
  for (const ranks of Object.values(HIGHLOW_STREAK_RANKS)) {
    assert.deepEqual(
      ranks.map(({ min, ...trainer }) => trainer),
      GUESS_RANKS.map(({ max, ...trainer }) => trainer),
    );
    assert.ok(ranks.every((tier) => !Object.hasOwn(tier, "max")));
  }
  assert.deepEqual(
    GUESS_RANKS.map((t) => t.max),
    [5, 10, 20, 30, 40, Infinity],
  );
  assert.deepEqual(
    CLUE_GUESS_RANKS.map((t) => t.max),
    [3, 5, 8, 11, 15, Infinity],
  );
  assert.equal(rankFor(0), null);
  assert.equal(rankFor(12), "B");
  assert.equal(rankFor(12, CLUE_GUESS_RANKS), "D");
  assert.equal(streakRankFor(12, "normal"), "B");
  assert.equal(streakRankFor(12, "hard"), "S");
});

test("High Low matches every form to six ordered base stats without mutating the catalog", () => {
  assert.equal(bundle.pokemon.length, catalog.pokemon.length);
  assert.equal(
    game.pokemon.length,
    catalog.pokemon.filter((p) => isPlayableForm(p) && catalog.images[p.image])
      .length,
  );
  assert.equal(catalog.pokemon[0].stats, undefined);
  const byKey = new Map(game.pokemon.map((p) => [p.key, p.stats]));
  for (const [key, expected] of [
    ["charizard", [78, 84, 78, 109, 85, 100]],
    ["charizard-mega-x", [78, 130, 111, 130, 85, 100]],
    ["growlithe", [55, 70, 45, 70, 50, 60]],
    ["growlithe-hisui", [60, 75, 45, 65, 50, 55]],
  ])
    assert.deepEqual(byKey.get(key), expected, key);
  assert.ok(byKey.has("mew"));
  assert.ok(game.pokemon.some((p) => p.speciesId === 493));
  assert.ok(!byKey.has("arceus-unknown"));
  assert.ok(!byKey.has("pichu-spiky-eared"));
  for (const stat of STATS)
    if (stat.label !== "HP") assert.ok(english[stat.label]);
});

test("unknown stats and missing artwork never enter the question pool", () => {
  const partial = structuredClone(bundle);
  partial.pokemon[0].stats = null;
  const g = createHighLow(catalog, partial);
  assert.ok(!g.byId.has(partial.pokemon[0].id));
  const noImages = { ...catalog, images: {} };
  assert.throws(() => createHighLow(noImages, bundle), /comparable/);
});

test("mismatched or corrupt stat exports fail explicitly", () => {
  for (const modify of [
    (b) => (b.version = "old"),
    (b) => (b.catalogVersion = "old"),
    (b) => (b.dataVersion = "bad"),
    (b) => b.stats.reverse(),
    (b) => b.pokemon.pop(),
    (b) => (b.pokemon[1].id = b.pokemon[0].id),
    (b) => (b.pokemon[0].pokemonId = -1),
    (b) => (b.pokemon[0].speciesId = -1),
    (b) => (b.pokemon[0].stats[0] = 0),
    (b) => (b.pokemon[0].stats[0] = 1.5),
    (b) => (b.pokemon[0].stats[0] = 1000),
    (b) => b.pokemon[0].stats.pop(),
  ]) {
    const copy = structuredClone(bundle);
    modify(copy);
    assert.throws(() => createHighLow(catalog, copy));
  }
});

test("URL settings validate seeds, real dates, future dates and the Korean midnight boundary", () => {
  const today = "2026-09-11";
  assert.deepEqual(settingsFromSearch("", today), normal);
  assert.deepEqual(settingsFromSearch("?date=2026-09-10", today), {
    mode: "daily",
    day: "2026-09-10",
    difficulty: "hard",
  });
  for (const query of [
    "?date=2026-02-30",
    "?date=2999-01-01",
    "?mode=practice",
    "?mode=practice&seed=%3Cscript%3E",
    "?mode=practice&seed=" + "a".repeat(65),
  ])
    assert.deepEqual(settingsFromSearch(query, today), normal);
  assert.deepEqual(settingsFromSearch("?mode=practice&seed=a_-123", today), {
    mode: "practice",
    seed: "a_-123",
    difficulty: "hard",
  });
  assert.deepEqual(settingsFromSearch("?difficulty=hard", today), settings);
  assert.deepEqual(
    settingsFromSearch("?difficulty=normal&date=2026-09-11", today),
    normal,
  );
  assert.deepEqual(settingsFromSearch("?difficulty=invalid", today), normal);
  assert.deepEqual(
    settingsFromSearch("?difficulty=normal&mode=practice&seed=example", today),
    { mode: "practice", seed: "example", difficulty: "normal" },
  );
  assert.throws(() => challengeKey({ ...settings, difficulty: "invalid" }));
  assert.equal(dayKey(new Date("2026-09-11T14:59:59Z")), "2026-09-11");
  assert.equal(dayKey(new Date("2026-09-11T15:00:00Z")), "2026-09-12");
  assert.throws(() => challengeKey({ mode: "other" }));
  assert.throws(() => challengeKey({ mode: "daily", day: "2026-02-30" }));
});

test("seeded sequences are stable, mode-isolated, cross-species and never tied", () => {
  const clone = createHighLow(catalog, bundle);
  const practice = { mode: "practice", seed: "2026-09-11", difficulty: "hard" };
  assert.notEqual(storageKey(game, settings), storageKey(game, practice));
  assert.notDeepEqual(game.question(settings, 0), game.question(practice, 0));
  assert.notDeepEqual(
    game.question(settings, 0),
    game.question({ ...settings, day: "2026-09-12" }, 0),
  );
  let leftWins = 0;
  for (let i = 0; i < MAX_QUESTIONS; i++) {
    const q = game.question(settings, i),
      a = game.byId.get(q.left),
      b = game.byId.get(q.right);
    assert.deepEqual(q, clone.question(settings, i));
    assert.notEqual(a.speciesId, b.speciesId);
    assert.notEqual(a.stats[q.stat], b.stats[q.stat]);
    assert.equal(
      q.winner,
      a.stats[q.stat] > b.stats[q.stat] ? "left" : "right",
    );
    if (q.winner === "left") leftWins++;
  }
  assert.ok(leftWins > 350 && leftWins < 650);
  for (let start = 0; start < 60; start += 6)
    assert.equal(
      new Set(
        Array.from(
          { length: 6 },
          (_, i) => game.question(settings, start + i).stat,
        ),
      ).size,
      6,
    );
  for (const index of [-1, 1.5, MAX_QUESTIONS])
    assert.throws(() => game.question(settings, index));
});

test("Normal always compares actual base stat totals and excludes equal totals", () => {
  const another = createHighLow(catalog, bundle);
  for (const p of game.pokemon)
    assert.equal(
      p.bst,
      p.stats.reduce((a, b) => a + b, 0),
    );
  assert.equal(statInfo("bst").label, "종족값 합계");
  for (const mode of [
    normal,
    { mode: "practice", seed: "totals", difficulty: "normal" },
  ]) {
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      const q = game.question(mode, i),
        a = game.byId.get(q.left),
        b = game.byId.get(q.right);
      assert.equal(q.stat, "bst");
      assert.notEqual(a.bst, b.bst);
      assert.notEqual(a.speciesId, b.speciesId);
      assert.equal(statValue(a, q.stat), a.bst);
      assert.equal(q.winner, a.bst > b.bst ? "left" : "right");
      assert.deepEqual(q, another.question(mode, i));
    }
  }
});

test("Hard preserves the pre-difficulty daily sequence, shared links and saved progress", () => {
  const expected = [
    { index: 0, stat: 0, left: 988, right: 1009, winner: "right" },
    { index: 1, stat: 3, left: 370, right: 43, winner: "right" },
    { index: 2, stat: 2, left: 921, right: 1005, winner: "right" },
    { index: 3, stat: 1, left: 10207, right: 10230, winner: "right" },
    { index: 4, stat: 4, left: 516, right: 10408, winner: "left" },
    { index: 5, stat: 5, left: 10208, right: 337, winner: "left" },
  ];
  assert.deepEqual(
    expected.map((_, i) => game.question(settings, i)),
    expected,
  );
  assert.equal(challengeKey(settings), "daily:2026-09-11");
  assert.equal(
    storageKey(game, settings),
    `highlow:${game.version}:daily:2026-09-11`,
  );
  assert.equal(profileKey(game, settings), `highlow:${game.version}`);
  assert.equal(lastPracticeKey(settings), "highlow:last-practice");
  const old = {
    version: game.version,
    challenge: "daily:2026-09-11",
    choices: ["right", "right"],
    revealed: false,
  };
  assert.deepEqual(restore(old), old);
  assert.equal(currentIndex(restore(old)), 2);
  assert.equal(
    settingsFromSearch("?date=2026-09-11", "2026-09-11").difficulty,
    "hard",
  );
  assert.equal(
    settingsFromSearch("?mode=practice&seed=cover7650").difficulty,
    "hard",
  );
  assert.deepEqual(
    game.question(
      { mode: "practice", seed: "cover7650", difficulty: "hard" },
      0,
    ),
    { index: 0, stat: 2, left: 9, right: 149, winner: "left" },
  );
});

test("difficulty-specific rounds and record keys cannot overwrite or restore one another", () => {
  for (const base of [
    { mode: "daily", day: "2026-09-11" },
    { mode: "practice", seed: "same-seed" },
  ]) {
    const hard = { ...base, difficulty: "hard" },
      normal = { ...base, difficulty: "normal" };
    assert.notEqual(storageKey(game, hard), storageKey(game, normal));
    assert.notEqual(profileKey(game, hard), profileKey(game, normal));
    assert.notEqual(lastPracticeKey(hard), lastPracticeKey(normal));
    assert.notDeepEqual(game.question(hard, 0), game.question(normal, 0));
    for (const [a, b] of [
      [hard, normal],
      [normal, hard],
    ]) {
      const round = newRound(game, a);
      submitChoice(round, game, a, game.question(a, 0).winner);
      nextQuestion(round, game, a);
      submitChoice(round, game, a, opposite(game.question(a, 1).winner));
      assert.equal(score(round, game, a), 1);
      assert.ok(isEnded(round, game, a));
      assert.deepEqual(restoreRound(JSON.stringify(round), game, a), round);
      assert.deepEqual(
        restoreRound(JSON.stringify(round), game, b),
        newRound(game, b),
      );
    }
  }
});

test("correct picks reveal once, preserve the current pair and require explicit advancement", () => {
  const round = newRound(game, settings),
    first = game.question(settings, 0);
  assert.equal(nextQuestion(round, game, settings), false);
  assert.equal(submitChoice(round, game, settings, "up"), "invalid");
  assert.equal(submitChoice(round, game, settings, first.winner), "correct");
  assert.equal(currentIndex(round), 0);
  assert.equal(score(round, game, settings), 1);
  assert.equal(submitChoice(round, game, settings, first.winner), "locked");
  assert.deepEqual(restore(round), round);
  assert.equal(nextQuestion(round, game, settings), true);
  assert.equal(currentIndex(round), 1);
  assert.equal(round.revealed, false);
  assert.deepEqual(restore(round), round);
  assert.equal(nextQuestion(round, game, settings), false);
});

test("a wrong pick ends the round without counting the miss and survives a reload", () => {
  for (const wins of [0, 1, 8]) {
    const round = newRound(game, settings);
    for (let i = 0; i < wins; i++) {
      submitChoice(round, game, settings, game.question(settings, i).winner);
      nextQuestion(round, game, settings);
    }
    assert.equal(
      submitChoice(
        round,
        game,
        settings,
        opposite(game.question(settings, wins).winner),
      ),
      "incorrect",
    );
    assert.equal(score(round, game, settings), wins);
    assert.equal(isEnded(round, game, settings), true);
    assert.equal(nextQuestion(round, game, settings), false);
    assert.equal(submitChoice(round, game, settings, "left"), "locked");
    assert.deepEqual(restore(round), round);
  }
});

test("tampered, stale or impossible saved progress is rejected", () => {
  const fresh = newRound(game, settings),
    winner = game.question(settings, 0).winner;
  for (const value of [
    null,
    [],
    {},
    { ...fresh, version: "old" },
    { ...fresh, challenge: "practice:other" },
    { ...fresh, revealed: true },
    { ...fresh, revealed: "true" },
    { ...fresh, choices: "left" },
    { ...fresh, choices: ["up"], revealed: true },
    { ...fresh, choices: [opposite(winner)], revealed: false },
    { ...fresh, choices: [opposite(winner), "left"], revealed: true },
    {
      ...fresh,
      choices: Array(MAX_QUESTIONS + 1).fill("left"),
      revealed: true,
    },
  ])
    assert.deepEqual(restore(value), fresh);
  assert.deepEqual(restoreRound("{broken", game, settings), fresh);
});

test("a full perfect run ends cleanly at the supported cap without a nonexistent question", () => {
  const round = newRound(game, settings);
  for (let i = 0; i < MAX_QUESTIONS; i++) {
    assert.equal(
      submitChoice(round, game, settings, game.question(settings, i).winner),
      "correct",
    );
    if (i < MAX_QUESTIONS - 1)
      assert.equal(nextQuestion(round, game, settings), true);
  }
  assert.equal(score(round, game, settings), MAX_QUESTIONS);
  assert.equal(currentIndex(round), MAX_QUESTIONS - 1);
  assert.ok(isEnded(round, game, settings));
  assert.equal(nextQuestion(round, game, settings), false);
  assert.deepEqual(restore(round), round);
});
