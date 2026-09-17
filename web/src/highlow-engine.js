import { hash, random, dayKey } from "./engine.js";
import { validDay, resolveDay } from "./similarity-engine.js";
import { isPlayableForm } from "./form-policy.js";

export { dayKey };
const STAT_KEYS = [
  "hp",
  "attack",
  "defense",
  "special_attack",
  "special_defense",
  "speed",
];
export const MAX_QUESTIONS = 1000;
export const TOTAL_STAT = {
  key: "bst",
  label: "종족값 합계",
  icon: "chart-no-axes-column",
};
// Keep the total-stat game's existing save keys and daily sequence.
export const profileKey = (game) => `highlow:${game.version}:normal`;
export const lastPracticeKey = () => "highlow:normal:last-practice";
export const validSeed = (seed) =>
  typeof seed === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(seed);
export function settingsFromSearch(search, today = dayKey()) {
  const params = new URLSearchParams(search);
  const practice =
    params.get("mode") === "practice" && validSeed(params.get("seed"));
  const date = params.get("date");
  return practice
    ? { mode: "practice", seed: params.get("seed") }
    : { mode: "daily", day: resolveDay(date, today) };
}
export function challengeKey(settings) {
  if (settings.mode === "daily" && validDay(settings.day))
    return `normal:daily:${settings.day}`;
  if (settings.mode === "practice" && validSeed(settings.seed))
    return `normal:practice:${settings.seed}`;
  throw new Error("Invalid High Low challenge");
}

export function createHighLow(catalog, bundle) {
  if (
    bundle.version !== "highlow-v1" ||
    bundle.catalogVersion !== catalog.version ||
    !/^[a-f0-9]{16}$/.test(bundle.dataVersion) ||
    JSON.stringify(bundle.stats) !== JSON.stringify(STAT_KEYS) ||
    !Array.isArray(bundle.pokemon) ||
    bundle.pokemon.length !== catalog.pokemon.length
  )
    throw new Error("High Low catalog mismatch");
  const stats = new Map(bundle.pokemon.map((p) => [p.id, p]));
  if (stats.size !== bundle.pokemon.length)
    throw new Error("Duplicate High Low data");
  const pokemon = catalog.pokemon
    .map((p) => {
      const row = stats.get(p.id);
      if (
        !row ||
        row.pokemonId !== p.pokemonId ||
        row.speciesId !== p.speciesId ||
        (row.stats !== null &&
          (!Array.isArray(row.stats) ||
            row.stats.length !== STAT_KEYS.length ||
            !row.stats.every((n) => Number.isInteger(n) && n > 0 && n <= 999)))
      )
        throw new Error("Invalid High Low stats");
      return {
        ...p,
        stats: row.stats,
        bst: row.stats?.reduce((sum, n) => sum + n, 0) ?? null,
      };
    })
    .filter(
      (p) => isPlayableForm(p) && p.stats && p.image && catalog.images[p.image],
    )
    .sort((a, b) => a.id - b.id);
  const byId = new Map(pokemon.map((p) => [p.id, p]));
  if (byId.size !== pokemon.length) throw new Error("Duplicate High Low form");
  const species = [...new Set(pokemon.map((p) => p.speciesId))];
  const bySpecies = new Map(
    species.map((id) => [id, pokemon.filter((p) => p.speciesId === id)]),
  );
  const fallback = pokemon.find((a) =>
    pokemon.some((b) => a.speciesId !== b.speciesId && a.bst !== b.bst),
  );
  if (!fallback) throw new Error("Not enough comparable Pokemon");
  const version = `${bundle.version}:${bundle.dataVersion}`;
  function question(settings, index) {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_QUESTIONS)
      throw new Error("Invalid question index");
    const key = `${version}:${challengeKey(settings)}`;
    const rng = random(hash(`${key}:pair:${index}`));
    const pick = (list) => list[Math.floor(rng() * list.length)];
    let left = pick(bySpecies.get(pick(species)));
    let candidates = pokemon.filter(
      (p) => p.speciesId !== left.speciesId && p.bst !== left.bst,
    );
    if (!candidates.length) {
      left = fallback;
      candidates = pokemon.filter(
        (p) => p.speciesId !== left.speciesId && p.bst !== left.bst,
      );
    }
    const rightSpecies = pick([...new Set(candidates.map((p) => p.speciesId))]);
    const right = pick(candidates.filter((p) => p.speciesId === rightSpecies));
    return {
      index,
      stat: "bst",
      left: left.id,
      right: right.id,
      winner: left.bst > right.bst ? "left" : "right",
    };
  }
  return { version, pokemon, byId, question };
}

export const storageKey = (game, settings) =>
  `highlow:${game.version}:${challengeKey(settings)}`;
export function newRound(game, settings) {
  return {
    version: game.version,
    challenge: challengeKey(settings),
    choices: [],
    revealed: false,
  };
}
export const currentIndex = (round) =>
  Math.max(0, round.choices.length - (round.revealed ? 1 : 0));
export function score(round, game, settings) {
  const last = round.choices.length - 1;
  return last >= 0 &&
    round.choices[last] !== game.question(settings, last).winner
    ? last
    : round.choices.length;
}
export const isEnded = (round, game, settings) =>
  round.choices.length === MAX_QUESTIONS ||
  score(round, game, settings) < round.choices.length;
export function submitChoice(round, game, settings, side) {
  if (round.revealed || isEnded(round, game, settings)) return "locked";
  if (!["left", "right"].includes(side)) return "invalid";
  const question = game.question(settings, round.choices.length);
  round.choices.push(side);
  round.revealed = true;
  return side === question.winner ? "correct" : "incorrect";
}
export function nextQuestion(round, game, settings) {
  if (!round.revealed || isEnded(round, game, settings)) return false;
  round.revealed = false;
  return true;
}
export function restoreRound(raw, game, settings) {
  const clean = newRound(game, settings);
  try {
    const saved = JSON.parse(raw);
    if (
      !saved ||
      saved.version !== clean.version ||
      saved.challenge !== clean.challenge ||
      typeof saved.revealed !== "boolean" ||
      !Array.isArray(saved.choices) ||
      saved.choices.length > MAX_QUESTIONS ||
      (!saved.choices.length && saved.revealed)
    )
      return clean;
    for (let i = 0; i < saved.choices.length; i++) {
      const last = i === saved.choices.length - 1;
      const status = submitChoice(clean, game, settings, saved.choices[i]);
      if (
        !["correct", "incorrect"].includes(status) ||
        (!last && status !== "correct")
      )
        return newRound(game, settings);
      if (!last) nextQuestion(clean, game, settings);
    }
    if (isEnded(clean, game, settings) && !saved.revealed)
      return newRound(game, settings);
    clean.revealed = saved.revealed;
    return clean;
  } catch {
    return newRound(game, settings);
  }
}
