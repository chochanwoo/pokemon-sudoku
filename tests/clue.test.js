import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createClueGame,
  compareSet,
  compareNumber,
  comparePokemon,
  answerKey,
  clueKey,
  settingsFromSearch,
  validSeed,
  storageKey,
  newRound,
  restoreRound,
  submitGuess,
  isWon,
  isEnded,
  shareGrid,
  MAX_GUESSES,
  FIELDS,
  searchForms,
} from "../web/src/clue-engine.js";

const read = (name) =>
  JSON.parse(
    readFileSync(new URL(`../web/public/${name}.json`, import.meta.url)),
  );
const catalog = read("pokemantle"),
  clues = read("pokeclue"),
  game = createClueGame(catalog, clues);
const byKey = new Map(game.pokemon.map((p) => [p.key, p]));
const p = (key) => byKey.get(key);
function settingsFor(id) {
  const origin = Date.parse("2026-09-11");
  for (let i = 0; i < game.answers.length; i++) {
    const settings = {
      mode: "daily",
      day: new Date(origin - i * 86400000).toISOString().slice(0, 10),
    };
    if (game.targetFor(settings) === id) return settings;
  }
  throw new Error("No date for answer");
}

test("clues use actual form stats and abilities, with species-wide debut and baby-inclusive evolution", () => {
  assert.equal(game.pokemon.length, 1559);
  assert.deepEqual(p("charizard-mega-x").types, [10, 16]);
  assert.equal(p("charizard").bst, 534);
  assert.equal(p("charizard-mega-x").bst, 634);
  assert.equal(p("charizard-mega-x").stage, 3);
  assert.equal(p("charizard-mega-x").generation, 1);
  assert.equal(p("pichu").stage, 1);
  assert.equal(p("pikachu").stage, 2);
  assert.equal(p("raichu-alola").stage, 3);
  assert.equal(p("raichu-alola").family, p("pichu").family);
  assert.equal(p("sylveon").family, p("eevee").family);
  assert.deepEqual(p("mew").eggGroups, ["no-eggs"]);
  assert.deepEqual(p("ditto").eggGroups, ["ditto"]);
  assert.ok(p("bulbasaur").abilities.some((a) => a.hidden));
  assert.notDeepEqual(p("vulpix").abilities, p("vulpix-alola").abilities);
});

test("set comparisons ignore order and hidden slots, distinguish partial matches and never match missing data", () => {
  assert.equal(compareSet([1, 2], [2, 1]).state, "match");
  assert.equal(compareSet([1], [1, 2]).state, "partial");
  assert.equal(compareSet([1, 2], [2]).state, "partial");
  assert.equal(compareSet([1, 2], [3]).state, "miss");
  assert.equal(compareSet([], []).state, "unknown");
  assert.equal(compareSet([], [1]).state, "unknown");
  const bulb = p("bulbasaur");
  assert.equal(
    comparePokemon(bulb, {
      ...bulb,
      abilities: bulb.abilities.map((a) => ({ ...a, hidden: !a.hidden })),
    }).abilities.state,
    "match",
  );
});

test("numeric arrows point toward the answer and evolution separates family from stage", () => {
  assert.deepEqual(compareNumber(300, 500), { state: "miss", direction: "up" });
  assert.deepEqual(compareNumber(500, 300), {
    state: "miss",
    direction: "down",
  });
  assert.deepEqual(compareNumber(500, 500), {
    state: "match",
    direction: null,
  });
  assert.equal(compareNumber(null, null).state, "unknown");
  const a = comparePokemon(p("bulbasaur"), p("ivysaur"));
  assert.deepEqual(a.evolution, {
    state: "partial",
    direction: "up",
    family: true,
  });
  const b = comparePokemon(p("bulbasaur"), p("charmander"));
  assert.deepEqual(b.evolution, {
    state: "partial",
    direction: null,
    family: false,
  });
  assert.equal(
    comparePokemon(p("venusaur"), p("charmander")).evolution.state,
    "miss",
  );
  assert.equal(
    comparePokemon(p("charizard"), p("charizard-mega-x")).evolution.state,
    "match",
  );
});

test("answer groups collapse only indistinguishable forms of the same species and retain mythical species", () => {
  assert.equal(answerKey(p("unown-a")), answerKey(p("unown-b")));
  assert.notEqual(answerKey(p("charizard")), answerKey(p("charizard-mega-x")));
  assert.notEqual(answerKey(p("vulpix")), answerKey(p("vulpix-alola")));
  assert.notEqual(
    answerKey(p("mew")),
    answerKey({ ...p("mew"), speciesId: 251 }),
  );
  assert.equal(game.answers.filter((p) => p.speciesId === 201).length, 1);
  assert.equal(new Set(game.answers.map(clueKey)).size, game.answers.length);
  assert.equal(clueKey(p("silcoon")), clueKey(p("cascoon")));
  assert.ok(!game.answers.some((p) => ["silcoon", "cascoon"].includes(p.key)));
  assert.equal(new Set(game.answers.map(answerKey)).size, game.answers.length);
  assert.ok(game.answers.some((p) => p.key === "mew"));
  assert.ok(game.answers.some((p) => p.key === "zarude"));
  assert.ok(!game.pokemon.some((p) => p.key === "arceus-unknown"));
  assert.ok(!game.pokemon.some((p) => p.key === "pikachu-partner-cap"));
  assert.ok(game.pokemon.some((p) => p.key === "darkrai-mega"));
  assert.ok(!game.answers.some((p) => p.key === "darkrai-mega"));
  assert.equal(
    comparePokemon(p("darkrai-mega"), p("darkrai")).abilities.state,
    "unknown",
  );
});

test("daily schedule covers the complete answer pool and practice is deterministic and independent", () => {
  const seen = new Set(),
    origin = Date.parse("2026-01-01");
  for (let i = 0; i < game.answers.length; i++) {
    const settings = {
      mode: "daily",
      day: new Date(origin + i * 86400000).toISOString().slice(0, 10),
    };
    const id = game.targetFor(settings);
    assert.equal(id, game.targetFor(settings));
    seen.add(id);
  }
  assert.equal(seen.size, game.answers.length);
  const settings = { mode: "practice", seed: "test-seed" };
  assert.equal(game.targetFor(settings), game.targetFor(settings));
  assert.notEqual(
    storageKey(game, settings),
    storageKey(game, { mode: "practice", seed: "test-seed-2" }),
  );
  assert.throws(() => game.targetFor({ mode: "daily", day: "2026-02-30" }));
  assert.throws(() => game.targetFor({ mode: "practice", seed: "<bad>" }));
});

test("eight attempts stop a round, while a correct eighth guess still wins", () => {
  const settings = settingsFor(p("charizard-mega-x").id),
    round = newRound(game, settings);
  const wrong = game.answers.filter((p) => p.id !== round.target).slice(0, 8);
  for (const p of wrong) assert.equal(submitGuess(round, game, p.id), "ok");
  assert.equal(isEnded(round, game), true);
  assert.equal(isWon(round, game), false);
  assert.equal(submitGuess(round, game, round.target), "finished");
  const win = newRound(game, settings);
  for (const p of wrong.slice(0, 7)) submitGuess(win, game, p.id);
  submitGuess(win, game, win.target);
  assert.equal(isWon(win, game), true);
  assert.equal(win.guesses.length, MAX_GUESSES);
});

test("cosmetic equivalents win and cannot waste duplicate guesses; Mega and regional forms stay distinct", () => {
  const round = newRound(game, settingsFor(p("unown-a").id));
  submitGuess(round, game, p("unown-b").id);
  assert.equal(isWon(round, game), true);
  const mega = newRound(game, settingsFor(p("charizard-mega-x").id));
  assert.equal(submitGuess(mega, game, p("charizard").id), "ok");
  assert.equal(isWon(mega, game), false);
  assert.equal(submitGuess(mega, game, p("unown-a").id), "ok");
  assert.equal(submitGuess(mega, game, p("unown-b").id), "duplicate");
  assert.equal(submitGuess(mega, game, 10057), "unknown");
});

test("storage validates identity, duplicate groups, early wins, limits and corrupted data", () => {
  const settings = settingsFor(p("charizard-mega-x").id),
    fresh = newRound(game, settings);
  const round = newRound(game, settings);
  submitGuess(round, game, 1);
  assert.deepEqual(restoreRound(JSON.stringify(round), game, settings), round);
  for (const raw of [
    "{",
    "null",
    JSON.stringify({ ...round, version: "wrong" }),
    JSON.stringify({ ...round, target: 1 }),
    JSON.stringify({ ...round, guesses: [10057] }),
    JSON.stringify({ ...round, guesses: [1, 1] }),
    JSON.stringify({ ...round, guesses: [p("unown-a").id, p("unown-b").id] }),
    JSON.stringify({ ...round, guesses: [round.target, 1] }),
    JSON.stringify({ ...round, guesses: [round.target], gaveUp: true }),
    JSON.stringify({ ...round, guesses: Array(9).fill(1) }),
  ])
    assert.deepEqual(restoreRound(raw, game, settings), fresh);
  const won = { ...round, guesses: [...round.guesses, round.target] };
  assert.deepEqual(restoreRound(JSON.stringify(won), game, settings), won);
  const gaveUp = { ...round, gaveUp: true };
  assert.deepEqual(
    restoreRound(JSON.stringify(gaveUp), game, settings),
    gaveUp,
  );
});

test("URLs reject malformed or future dates and seeds while searches stay bilingual", () => {
  assert.deepEqual(settingsFromSearch("?date=2099-01-01", "2026-09-11"), {
    mode: "daily",
    day: "2026-09-11",
  });
  assert.deepEqual(settingsFromSearch("?mode=practice&seed=hello"), {
    mode: "practice",
    seed: "hello",
  });
  assert.deepEqual(
    settingsFromSearch("?mode=practice&seed=%3Cscript%3E", "2026-09-11"),
    { mode: "daily", day: "2026-09-11" },
  );
  assert.equal(validSeed("x".repeat(65)), false);
  for (const query of ["알로라 식스테일", "Alolan Vulpix", "37"])
    assert.ok(
      searchForms(game.pokemon, query).some((p) => p.key === "vulpix-alola"),
    );
});

test("share feedback contains six spoiler-free marks per guess and bad bundles fail explicitly", () => {
  const settings = settingsFor(p("charizard-mega-x").id),
    round = newRound(game, settings);
  submitGuess(round, game, 1);
  submitGuess(round, game, round.target);
  const grid = shareGrid(round, game);
  assert.equal(grid.split("\n").length, 2);
  assert.ok(
    grid.split("\n").every((line) => line.split(" ").length === FIELDS.length),
  );
  assert.equal(grid.split("\n")[1], "O O O O O O");
  assert.ok(/^[OX~? \n]+$/.test(grid));
  assert.throws(() =>
    createClueGame(catalog, { ...clues, catalogVersion: "bad" }),
  );
  assert.throws(() => createClueGame(catalog, { ...clues, pokemon: [] }));
  const broken = structuredClone(clues);
  broken.pokemon[0].abilities[0].id = -1;
  assert.throws(() => createClueGame(catalog, broken));
});
