import { hash, random, shuffle, dayKey } from "./engine.js";
import { isPlayableForm } from "./form-policy.js";
import { validDay, resolveDay, searchForms } from "./similarity-engine.js";
import {
  CLUE_GUESS_RANKS,
  rankFor as trainerRankFor,
} from "./trainer-ranks.js";

export { dayKey, searchForms };
export { CLUE_GUESS_RANKS as GUESS_RANKS } from "./trainer-ranks.js";
export const rankFor = (attempts) => trainerRankFor(attempts, CLUE_GUESS_RANKS);
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
const originalClues = (p) => ({ ...p, generation: p.speciesGeneration });
const originalAnswerKey = (p) => answerKey(originalClues(p));

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
        ![
          details.stage,
          details.family,
          details.generation,
          details.debutGeneration ?? details.generation,
          details.speciesGeneration ?? details.generation,
          details.bst,
        ].every((n) => Number.isInteger(n) && n > 0) ||
        !Array.isArray(details.abilities) ||
        !Array.isArray(details.eggGroups) ||
        details.abilities.some(
          (a) => !abilitySet.has(a.id) || typeof a.hidden !== "boolean",
        ) ||
        details.eggGroups.some((g) => !eggSet.has(g))
      )
        throw new Error("Invalid Pokemon clues");
      return {
        ...p,
        ...details,
        speciesGeneration: details.speciesGeneration ?? details.generation,
        debutGeneration: details.debutGeneration ?? details.generation,
      };
    })
    .sort((a, b) => a.id - b.id);
  const byId = new Map(pokemon.map((p) => [p.id, p]));
  if (byId.size !== pokemon.length) throw new Error("Duplicate form IDs");
  // Keep v1's original draw pool and seeded targets when generation rules change.
  const groups = new Map();
  for (const entry of pokemon) {
    const p = originalClues(entry);
    if (p.abilities.length && p.eggGroups.length && !groups.has(answerKey(p)))
      groups.set(answerKey(p), p);
  }
  const candidates = [...groups.values()];
  const clueCounts = new Map();
  for (const p of candidates)
    clueCounts.set(clueKey(p), (clueCounts.get(clueKey(p)) || 0) + 1);
  // Different species with identical visible clues (e.g. Silcoon/Cascoon) remain guesses, not answers.
  const answers = candidates
    .filter((p) => clueCounts.get(clueKey(p)) === 1)
    .map((p) => byId.get(p.id));
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
  return {
    version,
    rulesVersion: clues.generationBasis || "species-debut",
    pokemon,
    byId,
    answers,
    targetFor,
  };
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
    rulesVersion: game.rulesVersion,
    challenge: challengeKey(settings),
    target: game.targetFor(settings),
    guesses: [],
    gaveUp: false,
  };
}
export function isWon(round, game) {
  const target = game.byId.get(round.target);
  const currentWin = round.guesses.some(
    (id) => answerKey(game.byId.get(id)) === answerKey(target),
  );
  return (
    currentWin ||
    (round.legacyWin === true &&
      round.guesses.length > 0 &&
      originalAnswerKey(game.byId.get(round.guesses.at(-1))) ===
        originalAnswerKey(target))
  );
}
export const isEnded = (round, game) => round.gaveUp || isWon(round, game);
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
      ![undefined, "species-debut", "form-debut", game.rulesVersion].includes(
        saved.rulesVersion,
      ) ||
      saved.challenge !== clean.challenge ||
      saved.target !== clean.target ||
      typeof saved.gaveUp !== "boolean" ||
      !Array.isArray(saved.guesses) ||
      saved.guesses.length > game.pokemon.length
    )
      return clean;
    const restored = newRound(game, settings);
    // Validate old history under its rules, including now-equivalent Gmax guesses.
    const replayGame =
      saved.rulesVersion === "form-debut"
        ? {
            ...game,
            byId: new Map(
              game.pokemon.map((p) => [
                p.id,
                { ...p, generation: p.debutGeneration },
              ]),
            ),
          }
        : game;
    for (const id of saved.guesses)
      if (submitGuess(restored, replayGame, id) !== "ok") return clean;
    // Honor wins earned when same-species forms shared the species' debut clue.
    const legacy =
      saved.rulesVersion === undefined ||
      saved.rulesVersion === "species-debut" ||
      saved.legacyWin === true;
    if (legacy && !isWon(restored, game)) {
      const winner = restored.guesses.findIndex(
        (id) =>
          originalAnswerKey(game.byId.get(id)) ===
          originalAnswerKey(game.byId.get(restored.target)),
      );
      if (winner >= 0) {
        if (winner !== restored.guesses.length - 1 || saved.gaveUp)
          return clean;
        restored.legacyWin = true;
      } else if (saved.legacyWin === true) return clean;
    }
    if (saved.gaveUp && isWon(restored, replayGame)) return clean;
    restored.gaveUp = saved.gaveUp && !isWon(restored, game);
    if (saved.rulesVersion === "form-debut")
      restored.rulesVersion = "form-debut";
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
