import { hash, random, shuffle, dayKey } from "./engine.js";
import { isPlayableForm } from "./form-policy.js";
import { validDay, resolveDay, searchForms } from "./similarity-engine.js";

export { dayKey, searchForms };
export const MAX_GUESSES = 8;
export const FIELDS = [
  "types",
  "abilities",
  "eggGroups",
  "evolution",
  "generation",
  "bst",
];

const sorted = (values) => [...new Set(values)].sort();
const abilityIds = (p) => p.abilities.map((a) => a.id);
export function clueKey(p) {
  return JSON.stringify([
    sorted(p.types),
    sorted(abilityIds(p)),
    sorted(p.eggGroups),
    p.stage,
    p.family,
    p.generation,
    p.bst,
  ]);
}
export const answerKey = (p) => `${p.speciesId}:${clueKey(p)}`;

export function createClueGame(catalog, clues) {
  if (
    typeof clues.version !== "string" ||
    !clues.version ||
    clues.catalogVersion !== catalog.version ||
    clues.pokemon.length !== catalog.pokemon.length
  )
    throw new Error("Clue catalog version mismatch");
  const traits = new Map(clues.pokemon.map((p) => [p.id, p]));
  const abilitySet = new Set(clues.abilities.map((a) => a.id));
  const eggSet = new Set(clues.eggGroups.map((g) => g.key));
  if (traits.size !== clues.pokemon.length)
    throw new Error("Duplicate clue IDs");
  const pokemon = catalog.pokemon
    .filter(isPlayableForm)
    .map((p) => {
      const details = traits.get(p.id);
      if (
        !details ||
        details.pokemonId !== p.pokemonId ||
        details.speciesId !== p.speciesId ||
        ![details.stage, details.family, details.generation, details.bst].every(
          (n) => Number.isInteger(n) && n > 0,
        ) ||
        !Array.isArray(details.abilities) ||
        !Array.isArray(details.eggGroups) ||
        details.abilities.some(
          (a) => !abilitySet.has(a.id) || typeof a.hidden !== "boolean",
        ) ||
        details.eggGroups.some((g) => !eggSet.has(g))
      )
        throw new Error("Invalid Pokemon clues");
      return { ...p, ...details };
    })
    .sort((a, b) => a.id - b.id);
  const byId = new Map(pokemon.map((p) => [p.id, p]));
  if (byId.size !== pokemon.length) throw new Error("Duplicate form IDs");
  // Cosmetic duplicates cannot be distinguished by these clues; draw each group once.
  const groups = new Map();
  for (const p of pokemon)
    if (p.abilities.length && p.eggGroups.length && !groups.has(answerKey(p)))
      groups.set(answerKey(p), p);
  const candidates = [...groups.values()];
  const clueCounts = new Map();
  for (const p of candidates)
    clueCounts.set(clueKey(p), (clueCounts.get(clueKey(p)) || 0) + 1);
  // Different species with identical visible clues (e.g. Silcoon/Cascoon) remain guesses, not answers.
  const answers = candidates.filter((p) => clueCounts.get(clueKey(p)) === 1);
  if (!answers.length) throw new Error("No complete answers");
  const version = clues.version;
  const schedule = shuffle(answers, random(hash(version)));
  const targetFor = (settings) => {
    if (settings.mode === "practice") {
      if (!validSeed(settings.seed)) throw new Error("Invalid practice seed");
      return answers[
        Math.floor(
          random(hash(`${version}:${settings.seed}`))() * answers.length,
        )
      ].id;
    }
    if (settings.mode !== "daily" || !validDay(settings.day))
      throw new Error("Invalid challenge date");
    const n = Math.floor(Date.parse(`${settings.day}T00:00:00Z`) / 86400000);
    return schedule[((n % schedule.length) + schedule.length) % schedule.length]
      .id;
  };
  return { version, pokemon, byId, answers, targetFor };
}

export function compareSet(guess, target) {
  if (!guess.length || !target.length) return { state: "unknown", shared: [] };
  const a = new Set(guess),
    b = new Set(target);
  const shared = [...a].filter((v) => b.has(v));
  return {
    state:
      shared.length === a.size && a.size === b.size
        ? "match"
        : shared.length
          ? "partial"
          : "miss",
    shared,
  };
}

export function compareNumber(guess, target) {
  if (!Number.isFinite(guess) || !Number.isFinite(target))
    return { state: "unknown", direction: null };
  return {
    state: guess === target ? "match" : "miss",
    direction: guess === target ? null : guess < target ? "up" : "down",
  };
}

export function comparePokemon(guess, target) {
  const stage = compareNumber(guess.stage, target.stage);
  const family = guess.family === target.family;
  return {
    types: compareSet(guess.types, target.types),
    abilities: compareSet(abilityIds(guess), abilityIds(target)),
    eggGroups: compareSet(guess.eggGroups, target.eggGroups),
    evolution: {
      state:
        family && stage.state === "match"
          ? "match"
          : family || stage.state === "match"
            ? "partial"
            : "miss",
      direction: stage.direction,
      family,
    },
    generation: compareNumber(guess.generation, target.generation),
    bst: compareNumber(guess.bst, target.bst),
  };
}

export const validSeed = (value) => /^[a-zA-Z0-9_-]{1,64}$/.test(value || "");
export function settingsFromSearch(search, today = dayKey()) {
  const params = new URLSearchParams(search);
  if (params.get("mode") === "practice" && validSeed(params.get("seed")))
    return { mode: "practice", seed: params.get("seed") };
  return { mode: "daily", day: resolveDay(params.get("date"), today) };
}
export const challengeKey = (settings) =>
  settings.mode === "practice"
    ? `practice:${settings.seed}`
    : `daily:${settings.day}`;
export const storageKey = (game, settings) =>
  `pokeclue:${game.version}:${challengeKey(settings)}`;
export function newRound(game, settings) {
  return {
    version: game.version,
    challenge: challengeKey(settings),
    target: game.targetFor(settings),
    guesses: [],
    gaveUp: false,
  };
}
export function isWon(round, game) {
  const target = game.byId.get(round.target);
  return round.guesses.some(
    (id) => answerKey(game.byId.get(id)) === answerKey(target),
  );
}
export const isEnded = (round, game) =>
  round.gaveUp || round.guesses.length >= MAX_GUESSES || isWon(round, game);
export function submitGuess(round, game, id) {
  if (isEnded(round, game)) return "finished";
  const p = game.byId.get(id);
  if (!p) return "unknown";
  if (
    round.guesses.some(
      (guess) => answerKey(game.byId.get(guess)) === answerKey(p),
    )
  )
    return "duplicate";
  round.guesses.push(id);
  return "ok";
}
export function restoreRound(raw, game, settings) {
  const clean = newRound(game, settings);
  try {
    const saved = JSON.parse(raw);
    if (
      !saved ||
      saved.version !== clean.version ||
      saved.challenge !== clean.challenge ||
      saved.target !== clean.target ||
      typeof saved.gaveUp !== "boolean" ||
      !Array.isArray(saved.guesses) ||
      saved.guesses.length > MAX_GUESSES
    )
      return clean;
    const restored = newRound(game, settings);
    for (const id of saved.guesses)
      if (submitGuess(restored, game, id) !== "ok") return clean;
    if (saved.gaveUp && isWon(restored, game)) return clean;
    restored.gaveUp = saved.gaveUp;
    return restored;
  } catch {
    return clean;
  }
}

export function shareGrid(round, game) {
  const marks = { match: "O", partial: "~", miss: "X", unknown: "?" };
  return round.guesses
    .map((id) => {
      const feedback = comparePokemon(
        game.byId.get(id),
        game.byId.get(round.target),
      );
      return FIELDS.map((field) => marks[feedback[field].state]).join(" ");
    })
    .join("\n");
}
