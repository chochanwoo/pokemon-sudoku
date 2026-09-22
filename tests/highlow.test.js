import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createHighLow,
  TOTAL_STAT,
  HARD_MAX_GAP,
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
const settings = { mode: "daily", day: "2026-09-11" };
const opposite = (side) => (side === "left" ? "right" : "left");
const restore = (value) => restoreRound(JSON.stringify(value), game, settings);

test("streak ranks restore the Champion boundary and preserve the lower boundaries", () => {
  const thresholds = [20, 15, 10, 6, 3, 0];
  assert.deepEqual(
    HIGHLOW_STREAK_RANKS.map((t) => t.min),
    thresholds,
  );
  for (let count = 0; count <= MAX_QUESTIONS; count++) {
    const index = thresholds.findIndex((min) => count >= min);
    assert.equal(streakRankFor(count), GUESS_RANKS[index].rank);
  }
  for (const count of [-1, 0.5, "12", null, undefined, NaN, Infinity])
    assert.equal(streakRankFor(count), null);
});

test("streak ranks reuse trainers without changing guess-based rankings", () => {
  assert.deepEqual(
    HIGHLOW_STREAK_RANKS.map(({ min, ...trainer }) => trainer),
    GUESS_RANKS.map(({ max, ...trainer }) => trainer),
  );
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
  assert.equal(streakRankFor(12), "B");
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
  assert.ok(english[TOTAL_STAT.label]);
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
  assert.deepEqual(settingsFromSearch("", today), settings);
  assert.deepEqual(settingsFromSearch("?date=2026-09-10", today), {
    mode: "daily",
    day: "2026-09-10",
  });
  for (const query of [
    "?date=2026-02-30",
    "?date=2999-01-01",
    "?mode=practice",
    "?mode=practice&seed=%3Cscript%3E",
    "?mode=practice&seed=" + "a".repeat(65),
  ])
    assert.deepEqual(settingsFromSearch(query, today), settings);
  assert.deepEqual(settingsFromSearch("?mode=practice&seed=a_-123", today), {
    mode: "practice",
    seed: "a_-123",
  });
  assert.deepEqual(settingsFromSearch("?difficulty=hard", today), {
    ...settings, difficulty: "hard",
  });
  assert.deepEqual(
    settingsFromSearch("?difficulty=normal&date=2026-09-11", today),
    settings,
  );
  assert.deepEqual(settingsFromSearch("?difficulty=invalid", today), settings);
  assert.deepEqual(
    settingsFromSearch("?difficulty=normal&mode=practice&seed=example", today),
    { mode: "practice", seed: "example" },
  );
  assert.equal(
    Object.hasOwn(settingsFromSearch("?difficulty=hard"), "difficulty"),
    true,
  );
  assert.equal(dayKey(new Date("2026-09-11T14:59:59Z")), "2026-09-11");
  assert.equal(dayKey(new Date("2026-09-11T15:00:00Z")), "2026-09-12");
  assert.throws(() => challengeKey({ mode: "other" }));
  assert.throws(() => challengeKey({ mode: "daily", day: "2026-02-30" }));
});

test("seeded sequences are stable, mode-isolated, cross-species and never tied", () => {
  const clone = createHighLow(catalog, bundle);
  const practice = { mode: "practice", seed: "2026-09-11" };
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
    assert.notEqual(a.bst, b.bst);
    assert.equal(q.winner, a.bst > b.bst ? "left" : "right");
    if (q.winner === "left") leftWins++;
  }
  assert.ok(leftWins > 350 && leftWins < 650);
  for (const index of [-1, 1.5, MAX_QUESTIONS])
    assert.throws(() => game.question(settings, index));
});

test("Every question compares actual base stat totals and excludes equal totals", () => {
  const another = createHighLow(catalog, bundle);
  for (const p of game.pokemon)
    assert.equal(
      p.bst,
      p.stats.reduce((a, b) => a + b, 0),
    );
  assert.equal(TOTAL_STAT.label, "종족값 합계");
  for (const mode of [settings, { mode: "practice", seed: "totals" }]) {
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      const q = game.question(mode, i),
        a = game.byId.get(q.left),
        b = game.byId.get(q.right);
      assert.equal(q.stat, "bst");
      assert.notEqual(a.bst, b.bst);
      assert.notEqual(a.speciesId, b.speciesId);
      assert.equal(q.winner, a.bst > b.bst ? "left" : "right");
      assert.deepEqual(q, another.question(mode, i));
    }
  }
});

test("existing total-stat sequences, shared links and saved progress survive", () => {
  const expected = [
    { index: 0, stat: "bst", left: 10215, right: 719, winner: "right" },
    { index: 1, stat: "bst", left: 387, right: 533, winner: "right" },
    { index: 2, stat: "bst", left: 534, right: 607, winner: "left" },
    { index: 3, stat: "bst", left: 511, right: 484, winner: "right" },
    { index: 4, stat: "bst", left: 450, right: 313, winner: "left" },
    { index: 5, stat: "bst", left: 324, right: 889, winner: "right" },
  ];
  assert.deepEqual(
    expected.map((_, i) => game.question(settings, i)),
    expected,
  );
  assert.equal(challengeKey(settings), "normal:daily:2026-09-11");
  assert.equal(
    storageKey(game, settings),
    `highlow:${game.version}:normal:daily:2026-09-11`,
  );
  assert.equal(profileKey(game), `highlow:${game.version}:normal`);
  assert.equal(lastPracticeKey(), "highlow:normal:last-practice");
  const old = {
    version: game.version,
    challenge: "normal:daily:2026-09-11",
    choices: ["right", "right"],
    revealed: false,
  };
  assert.deepEqual(restore(old), old);
  assert.equal(currentIndex(restore(old)), 2);
});

test("retired individual-stat saves never become total-stat progress", () => {
  for (const base of [settings, { mode: "practice", seed: "same-seed" }]) {
    const fresh = newRound(game, base);
    const retired = {
      ...fresh,
      challenge: fresh.challenge.replace("normal:", ""),
      choices: ["right"],
      revealed: true,
    };
    assert.deepEqual(restoreRound(JSON.stringify(retired), game, base), fresh);
    for (const difficulty of ["hard", "normal", "invalid"]) {
      const search =
        base.mode === "daily"
          ? `?date=${base.day}`
          : `?mode=practice&seed=${base.seed}`;
      const parsed = settingsFromSearch(
        search + "&difficulty=" + difficulty,
        "2026-09-11",
      );
      assert.deepEqual(parsed, difficulty === "hard" ? { ...base, difficulty } : base);
      assert.equal(game.question(parsed, 0).stat, "bst");
    }
  }
});

test("hard pairs stay inside the total-stat gap, deterministic and balanced", () => {
  const clone = createHighLow(catalog, bundle);
  const eligible = new Set();
  let leftWins = 0;
  for (const base of [settings, { mode: "practice", seed: "close-totals" }]) {
    const hard = { ...base, difficulty: "hard" };
    assert.notEqual(storageKey(game, base), storageKey(game, hard));
    assert.notEqual(profileKey(game, base), profileKey(game, hard));
    assert.notEqual(lastPracticeKey(base), lastPracticeKey(hard));
    assert.match(challengeKey(hard), /^close-v1:/);
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      const q = game.question(hard, i);
      const a = game.byId.get(q.left), b = game.byId.get(q.right);
      const gap = Math.abs(a.bst - b.bst);
      assert.ok(gap > 0 && gap <= HARD_MAX_GAP);
      assert.notEqual(a.speciesId, b.speciesId);
      assert.equal(q.stat, "bst");
      assert.equal(q.winner, a.bst > b.bst ? "left" : "right");
      assert.deepEqual(q, clone.question(hard, i));
      eligible.add(a.speciesId);
      if (q.winner === "left") leftWins++;
    }
  }
  assert.ok(leftWins > 800 && leftWins < 1200);
  assert.ok(eligible.size > 600);
  assert.deepEqual(settingsFromSearch("?difficulty=hard&mode=practice&seed=close-totals"), {
    mode: "practice", seed: "close-totals", difficulty: "hard",
  });
});

test("hard saves restore wins and losses without accepting normal or retired progress", () => {
  for (const base of [settings, { mode: "practice", seed: "save-hard" }]) {
    const hard = { ...base, difficulty: "hard" };
    const round = newRound(game, hard);
    submitChoice(round, game, hard, game.question(hard, 0).winner);
    assert.deepEqual(restoreRound(JSON.stringify(round), game, hard), round);
    nextQuestion(round, game, hard);
    assert.deepEqual(restoreRound(JSON.stringify(round), game, hard), round);
    submitChoice(round, game, hard, opposite(game.question(hard, 1).winner));
    assert.equal(score(round, game, hard), 1);
    assert.ok(isEnded(round, game, hard));
    assert.deepEqual(restoreRound(JSON.stringify(round), game, hard), round);
    assert.deepEqual(restoreRound(JSON.stringify(round), game, base), newRound(game, base));
    for (const prefix of ["normal:", "hard:", ""]) {
      const old = { ...round, challenge: round.challenge.replace("close-v1:", prefix) };
      assert.deepEqual(restoreRound(JSON.stringify(old), game, hard), newRound(game, hard));
    }
  }
});

test("hard sampling excludes isolated forms and includes the exact gap boundary", () => {
  const pair = catalog.pokemon.filter((p) => [1, 4, 7].includes(p.id));
  const make = (values) => createHighLow({ ...catalog, pokemon: pair }, {
    ...bundle,
    pokemon: pair.map((p, i) => ({ id: p.id, pokemonId: p.pokemonId,
      speciesId: p.speciesId, stats: [values[i], 50, 50, 50, 50, 50] })),
  });
  const hard = { ...settings, difficulty: "hard" };
  const g = make([50, 50 + HARD_MAX_GAP, 300]);
  for (let i = 0; i < 100; i++) {
    const q = g.question(hard, i);
    assert.deepEqual([q.left, q.right].sort((a, b) => a - b), [1, 4]);
  }
  const isolated = make([50, 101, 300]);
  assert.throws(() => isolated.question(hard, 0), /close-total/);
  assert.doesNotThrow(() => isolated.question(settings, 0));
  const tied = make([50, 50, 300]);
  assert.throws(() => tied.question(hard, 0), /close-total/);
});

test("total-stat comparisons allow ties in individual stats but never total ties", () => {
  const pair = catalog.pokemon.filter((p) =>
    ["bulbasaur", "ivysaur"].includes(p.key),
  );
  const subset = { ...catalog, pokemon: pair };
  const data = {
    ...bundle,
    pokemon: pair.map((p, i) => ({
      id: p.id,
      pokemonId: p.pokemonId,
      speciesId: p.speciesId,
      stats: [50 + i, 50, 50, 50, 50, 50],
    })),
  };
  const g = createHighLow(subset, data);
  assert.equal(g.question(settings, 0).stat, "bst");
  data.pokemon[1].stats = [50, 50, 50, 50, 50, 50];
  assert.throws(() => createHighLow(subset, data), /comparable/);
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
