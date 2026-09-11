import { dayKey, initials } from "./engine.js";
import { englishName } from "./pokemon-names.js";
import { isPlayableForm } from "./form-policy.js";

export { dayKey };
export const MAX_HINTS = 3;

export function proximityFor(rank, total, score) {
  if (rank === 1) return { tone: "hot", label: "정답" };
  if (rank / total <= 0.01 && score >= 40)
    return { tone: "hot", label: "매우 가까움" };
  if (rank / total <= 0.1 && score >= 25)
    return { tone: "warm", label: "가까움" };
  return { tone: "cool", label: "거리가 있음" };
}

export function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

export function resolveDay(value, today = dayKey()) {
  return validDay(value) && value <= today ? value : today;
}

function scheduledTarget(data, day) {
  if (!validDay(day)) throw new Error("Invalid puzzle date");
  let seed = 2166136261;
  for (const char of data.version)
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const ids = data.pokemon.map((p) => p.id).sort((a, b) => a - b);
  if (!ids.length) throw new Error("No Pokemon forms");
  for (let i = ids.length - 1; i > 0; i--) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const j = (seed >>> 0) % (i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
  return ids[((dayNumber % ids.length) + ids.length) % ids.length];
}

export function dailyTarget(data, day) {
  const id = scheduledTarget(data, day);
  const scheduled = data.pokemon.find((p) => p.id === id);
  if (isPlayableForm(scheduled)) return scheduled.id;
  // Keep ordinary dates stable and replace removed answers with a base counterpart.
  const counterpart = data.pokemon
    .filter((p) => p.speciesId === scheduled.speciesId && isPlayableForm(p))
    .sort((a, b) => a.id - b.id)[0];
  if (!counterpart)
    throw new Error("Excluded form has no playable counterpart");
  return counterpart.id;
}

export function createSimilarity(data, buffer) {
  const count = data.pokemon.length;
  if (!count || buffer.byteLength !== count * count * 2)
    throw new Error("Invalid similarity matrix");
  const index = new Map(data.pokemon.map((p, i) => [p.id, i]));
  if (index.size !== count) throw new Error("Duplicate form IDs");
  // Matrix offsets retain the raw catalog order; only gameplay uses the filtered pool.
  const pokemon = data.pokemon.filter(isPlayableForm);
  const byId = new Map(pokemon.map((p) => [p.id, p]));
  const matrix = new DataView(buffer);
  const score = (a, b) => {
    if (!index.has(a) || !index.has(b)) throw new Error("Unknown Pokemon form");
    return (
      matrix.getUint16((index.get(a) * count + index.get(b)) * 2, true) / 100
    );
  };
  const ranking = (target) => {
    if (!byId.has(target)) throw new Error("Unknown playable Pokemon form");
    const rows = pokemon
      .map((p) => ({ id: p.id, score: score(target, p.id) }))
      .sort((a, b) => b.score - a.score || a.id - b.id);
    let rank = 1;
    return rows.map((row, i) => {
      if (i && row.score !== rows[i - 1].score) rank = i + 1;
      return { ...row, rank };
    });
  };
  return { pokemon, byId, score, ranking };
}

export function newRound(data, day) {
  return {
    version: data.version,
    day,
    target: dailyTarget(data, day),
    guesses: [],
    gaveUp: false,
  };
}

export function isWon(round, target) {
  return round.guesses.some((guess) => guess.id === target);
}

export function restoreRound(raw, data, day) {
  const fallback = () => newRound(data, day);
  try {
    const value = JSON.parse(raw);
    const ids = new Set(data.pokemon.map((p) => p.id));
    const target = dailyTarget(data, day);
    if (
      !value ||
      value.version !== data.version ||
      value.day !== day ||
      (value.target ?? scheduledTarget(data, day)) !== target ||
      typeof value.gaveUp !== "boolean" ||
      !Array.isArray(value.guesses) ||
      value.guesses.length > ids.size ||
      value.guesses.some(
        (g) => !g || !ids.has(g.id) || typeof g.hint !== "boolean",
      ) ||
      new Set(value.guesses.map((g) => g.id)).size !== value.guesses.length ||
      value.guesses.filter((g) => g.hint).length > MAX_HINTS
    )
      return fallback();
    const playableIds = new Set(
      data.pokemon.filter(isPlayableForm).map((p) => p.id),
    );
    const guesses = value.guesses.filter((g) => playableIds.has(g.id));
    const targetIndex = guesses.findIndex((g) => g.id === target);
    if (
      targetIndex >= 0 &&
      (targetIndex !== guesses.length - 1 || value.gaveUp)
    )
      return fallback();
    return {
      version: value.version,
      day,
      target,
      guesses,
      gaveUp: value.gaveUp,
    };
  } catch {
    return fallback();
  }
}

export function submitGuess(round, id, target, byId, hint = false) {
  if (round.gaveUp || isWon(round, target)) return "finished";
  if (!byId.has(id) || !isPlayableForm(byId.get(id))) return "unknown";
  if (round.guesses.some((g) => g.id === id)) return "duplicate";
  if (hint && round.guesses.filter((g) => g.hint).length >= MAX_HINTS)
    return "hints-used";
  round.guesses.push({ id, hint });
  return "ok";
}

export function nextHint(round, ranked) {
  if (round.guesses.filter((g) => g.hint).length >= MAX_HINTS) return null;
  const guessed = new Set(round.guesses.map((g) => g.id));
  const best = ranked.find((row) => guessed.has(row.id));
  const candidates = ranked.filter(
    (row) =>
      row.rank > 1 && !guessed.has(row.id) && (!best || row.score > best.score),
  );
  if (!candidates.length) return null;
  return candidates[
    Math.min(candidates.length - 1, Math.floor(candidates.length / 2))
  ].id;
}

const normalize = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function searchForms(pokemon, query) {
  const tokens = query.trim().split(/\s+/).map(normalize).filter(Boolean);
  if (!tokens.length) return [];
  return pokemon.filter((p) => {
    if (!isPlayableForm(p)) return false;
    const words = [
      p.name,
      p.baseName,
      p.form,
      p.english,
      englishName(p),
      p.key,
      initials(p.name),
      String(p.speciesId),
      String(p.id),
      ...(p.aliases || []),
    ].map(normalize);
    return tokens.every((token) => words.some((word) => word.includes(token)));
  });
}
