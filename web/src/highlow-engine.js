import { hash, random, shuffle, dayKey } from "./engine.js";
import { validDay, resolveDay } from "./similarity-engine.js";
import { isPlayableForm } from "./form-policy.js";

export { dayKey };
export const STATS = [
  { key: "hp", label: "HP", icon: "heart" },
  { key: "attack", label: "공격", icon: "swords" },
  { key: "defense", label: "방어", icon: "shield" },
  { key: "special_attack", label: "특수공격", icon: "sparkles" },
  { key: "special_defense", label: "특수방어", icon: "shield-plus" },
  { key: "speed", label: "스피드", icon: "zap" },
];
export const MAX_QUESTIONS = 1000;
const TOTAL_STAT = {
  key: "bst",
  label: "종족값 합계",
  icon: "chart-no-axes-column",
};
export const statInfo = (stat) => (stat === "bst" ? TOTAL_STAT : STATS[stat]);
export const statValue = (pokemon, stat) =>
  stat === "bst" ? pokemon.bst : pokemon.stats[stat];
export const difficultyOf = (settings) => settings.difficulty ?? "normal";
export const profileKey = (game, settings) =>
  `highlow:${game.version}${difficultyOf(settings) === "normal" ? ":normal" : ""}`;
export const lastPracticeKey = (settings) =>
  `highlow:${difficultyOf(settings) === "normal" ? "normal:" : ""}last-practice`;
export const validSeed = (seed) =>
  typeof seed === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(seed);
export function settingsFromSearch(search, today = dayKey()) {
  const params = new URLSearchParams(search);
  const practice =
    params.get("mode") === "practice" && validSeed(params.get("seed"));
  const date = params.get("date");
  // Old shared links described individual-stat games, now named Hard.
  const legacy =
    !params.has("difficulty") &&
    (practice || (validDay(date) && date <= today));
  const difficulty =
    params.get("difficulty") === "hard" || legacy ? "hard" : "normal";
  return practice
    ? { mode: "practice", seed: params.get("seed"), difficulty }
    : { mode: "daily", day: resolveDay(date, today), difficulty };
}
export function challengeKey(settings) {
  const difficulty = difficultyOf(settings);
  if (!["normal", "hard"].includes(difficulty))
    throw new Error("Invalid High Low difficulty");
  // Hard retains the original seed and storage identity so existing rounds survive.
  const prefix = difficulty === "normal" ? "normal:" : "";
  if (settings.mode === "daily" && validDay(settings.day))
    return `${prefix}daily:${settings.day}`;
  if (settings.mode === "practice" && validSeed(settings.seed))
    return `${prefix}practice:${settings.seed}`;
  throw new Error("Invalid High Low challenge");
}

export function createHighLow(catalog, bundle) {
  if (
    bundle.version !== "highlow-v1" ||
    bundle.catalogVersion !== catalog.version ||
    !/^[a-f0-9]{16}$/.test(bundle.dataVersion) ||
    JSON.stringify(bundle.stats) !== JSON.stringify(STATS.map((s) => s.key)) ||
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
            row.stats.length !== STATS.length ||
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
  // Every stat needs at least one cross-species comparison with unequal values.
  const fallback = new Map(
    [...STATS.keys(), "bst"].map((stat) => [
      stat,
      pokemon.find((a) =>
        pokemon.some(
          (b) =>
            a.speciesId !== b.speciesId &&
            statValue(a, stat) !== statValue(b, stat),
        ),
      ),
    ]),
  );
  if ([...fallback.values()].some((p) => !p))
    throw new Error("Not enough comparable Pokemon");
  const version = `${bundle.version}:${bundle.dataVersion}`;
  function question(settings, index) {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_QUESTIONS)
      throw new Error("Invalid question index");
    const key = `${version}:${challengeKey(settings)}`;
    const rng = random(hash(`${key}:pair:${index}`));
    const pick = (list) => list[Math.floor(rng() * list.length)];
    const stat =
      difficultyOf(settings) === "normal"
        ? "bst"
        : shuffle(
            STATS.map((_, i) => i),
            random(hash(`${key}:stats`)),
          )[index % STATS.length];
    let left = pick(bySpecies.get(pick(species)));
    let candidates = pokemon.filter(
      (p) =>
        p.speciesId !== left.speciesId &&
        statValue(p, stat) !== statValue(left, stat),
    );
    if (!candidates.length) {
      left = fallback.get(stat);
      candidates = pokemon.filter(
        (p) =>
          p.speciesId !== left.speciesId &&
          statValue(p, stat) !== statValue(left, stat),
      );
    }
    const rightSpecies = pick([...new Set(candidates.map((p) => p.speciesId))]);
    const right = pick(candidates.filter((p) => p.speciesId === rightSpecies));
    return {
      index,
      stat,
      left: left.id,
      right: right.id,
      winner: statValue(left, stat) > statValue(right, stat) ? "left" : "right",
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
