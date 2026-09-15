import { hash, random, shuffle, dayKey } from "./engine.js";
import { validDay, resolveDay, searchForms } from "./similarity-engine.js";
import { englishName } from "./pokemon-names.js";

export { dayKey };
export const SIZE = 256;
export const COUNT = 5;
export const RANKS = [
  { rank: "S", min: 450 },
  { rank: "A", min: 375 },
  { rank: "B", min: 300 },
  { rank: "C", min: 225 },
  { rank: "D", min: 125 },
  { rank: "E", min: 0 },
];
export const rankFor = (points) =>
  Number.isInteger(points) && points >= 0 && points <= 500
    ? RANKS.find((r) => points >= r.min).rank
    : null;
export const validSeed = (s) =>
  typeof s === "string" && /^[\w-]{1,64}$/.test(s);
export function settingsFromSearch(search, today = dayKey()) {
  const p = new URLSearchParams(search);
  return p.get("mode") === "practice" && validSeed(p.get("seed"))
    ? { mode: "practice", seed: p.get("seed") }
    : { mode: "daily", day: resolveDay(p.get("date"), today) };
}
export function challengeKey(settings) {
  if (settings.mode === "daily" && validDay(settings.day))
    return `daily:${settings.day}`;
  if (settings.mode === "practice" && validSeed(settings.seed))
    return `practice:${settings.seed}`;
  throw new Error("Invalid scratch challenge");
}
const rectValid = (r, bounded = false) =>
  Array.isArray(r) &&
  r.length === 4 &&
  r.every(Number.isInteger) &&
  r[0] >= 0 &&
  r[1] >= 0 &&
  r[2] > 0 &&
  r[3] > 0 &&
  (!bounded || (r[0] + r[2] <= SIZE && r[1] + r[3] <= SIZE));
export function createScratch(catalog, data) {
  if (
    data.version !== "scratch-v1" ||
    data.catalogVersion !== catalog.version ||
    !/^[a-f0-9]{16}$/.test(data.dataVersion) ||
    !Array.isArray(data.pokemon)
  )
    throw new Error("Scratch catalog mismatch");
  const raw = new Map(catalog.pokemon.map((p) => [p.id, p]));
  const pokemon = data.pokemon
    .map((p) => {
      const original = raw.get(p.id);
      if (
        !original ||
        original.speciesId !== p.speciesId ||
        original.image !== p.image ||
        !catalog.images[p.image]?.startsWith("data:image/png;base64,") ||
        !["base", "regional", "mega"].includes(p.kind) ||
        !p.name ||
        !rectValid(p.crop) ||
        !rectValid(p.frame, true) ||
        !/^[a-f0-9]{16}$/.test(p.art)
      )
        throw new Error("Invalid scratch sprite");
      return {
        ...original,
        ...p,
        english: p.english || englishName(original),
        aliases: [
          ...(original.aliases || []),
          p.english || englishName(original),
          p.name,
        ],
      };
    })
    .sort((a, b) => a.id - b.id);
  const byId = new Map(pokemon.map((p) => [p.id, p])),
    bySpecies = new Map();
  for (const p of pokemon) {
    if (!bySpecies.has(p.speciesId)) bySpecies.set(p.speciesId, []);
    bySpecies.get(p.speciesId).push(p);
  }
  if (byId.size !== pokemon.length || bySpecies.size < COUNT)
    throw new Error("Invalid scratch pool");
  const version = `${data.version}:${data.dataVersion}`;
  const targets = (settings) => {
    const rng = random(hash(`${version}:${challengeKey(settings)}`));
    return shuffle([...bySpecies.keys()], rng)
      .slice(0, COUNT)
      .map((id) => {
        const forms = bySpecies.get(id);
        return forms[Math.floor(rng() * forms.length)].id;
      });
  };
  return { version, pokemon, byId, targets };
}
export const storageKey = (game, settings) =>
  `scratch:${game.version}:${challengeKey(settings)}`;
export const searchCandidates = (game, query) =>
  searchForms(game.pokemon, query);
export const area = (p) => p.frame[2] * p.frame[3];
export const potentialScore = (erased, total, mistakes) =>
  Math.max(10, Math.round(100 - (100 * erased) / total - 5 * mistakes));
export const current = (round) => round.items[round.index];
export const isEnded = (round) =>
  round.index === COUNT - 1 && !!current(round).outcome;
export const totalScore = (round) =>
  round.items.reduce((n, item) => n + (item.points || 0), 0);
export function newRound(game, settings) {
  return {
    version: game.version,
    challenge: challengeKey(settings),
    index: 0,
    items: game.targets(settings).map((id) => ({
      id,
      erased: 0,
      guesses: [],
      outcome: null,
      points: 0,
      mask: new Uint8Array(SIZE * SIZE),
    })),
  };
}

// Rasterize the swept circle at fixed logical resolution, independent of screen/DPR.
export function eraseMask(mask, frame, from, to, radius) {
  if (
    !Number.isFinite(radius) ||
    radius < 2 ||
    radius > 40 ||
    ![...from, ...to].every(
      (n) => Number.isFinite(n) && Math.abs(n) <= SIZE * 4,
    )
  )
    return [];
  const [fx, fy, w, h] = frame,
    [ax, ay] = from,
    [bx, by] = to;
  const dx = bx - ax,
    dy = by - ay,
    length = dx * dx + dy * dy,
    changed = [];
  const left = Math.max(fx, Math.floor(Math.min(ax, bx) - radius)),
    right = Math.min(fx + w, Math.ceil(Math.max(ax, bx) + radius)),
    top = Math.max(fy, Math.floor(Math.min(ay, by) - radius)),
    bottom = Math.min(fy + h, Math.ceil(Math.max(ay, by) + radius));
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const i = y * SIZE + x;
      if (mask[i]) continue;
      const t = length
        ? Math.max(
            0,
            Math.min(1, ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / length),
          )
        : 0;
      if (
        (x + 0.5 - ax - t * dx) ** 2 + (y + 0.5 - ay - t * dy) ** 2 <=
        radius * radius
      ) {
        mask[i] = 1;
        changed.push(i);
      }
    }
  return changed;
}
export function erase(round, game, from, to, radius) {
  const item = current(round);
  if (item.outcome) return [];
  const changed = eraseMask(
    item.mask,
    game.byId.get(item.id).frame,
    from,
    to,
    radius,
  );
  item.erased += changed.length;
  return changed;
}
export function guess(round, game, id) {
  const item = current(round),
    candidate = game.byId.get(id),
    target = game.byId.get(item.id);
  if (item.outcome) return "locked";
  if (!candidate) return "invalid";
  if (item.guesses.some((old) => game.byId.get(old).art === candidate.art))
    return "duplicate";
  item.guesses.push(id);
  if (candidate.art !== target.art) return "incorrect";
  item.outcome = "solved";
  item.points = potentialScore(
    item.erased,
    area(target),
    item.guesses.length - 1,
  );
  return "correct";
}
export function giveUp(round) {
  const item = current(round);
  if (item.outcome) return false;
  item.outcome = "given-up";
  item.points = 0;
  return true;
}
export function advance(round) {
  if (!current(round).outcome || isEnded(round)) return false;
  round.index++;
  return true;
}
export function packMask(mask) {
  const bytes = new Uint8Array((SIZE * SIZE) / 8);
  mask.forEach((v, i) => {
    if (v) bytes[i >> 3] |= 1 << (i & 7);
  });
  return btoa(String.fromCharCode(...bytes));
}
export function unpackMask(encoded) {
  if (
    typeof encoded !== "string" ||
    encoded.length !== 10924 ||
    !/^[A-Za-z0-9+/]+=$/.test(encoded)
  )
    throw new Error("Invalid mask");
  const bytes = atob(encoded);
  if (bytes.length !== (SIZE * SIZE) / 8 || btoa(bytes) !== encoded)
    throw new Error("Invalid mask length");
  return Uint8Array.from(
    { length: SIZE * SIZE },
    (_, i) => (bytes.charCodeAt(i >> 3) >> (i & 7)) & 1,
  );
}
export function serializeRound(round) {
  return JSON.stringify({
    ...round,
    items: round.items.map((item, i) => ({
      ...item,
      mask: i === round.index && !item.outcome ? packMask(item.mask) : null,
    })),
  });
}
export function restoreRound(raw, game, settings) {
  const clean = newRound(game, settings);
  try {
    const r = JSON.parse(raw);
    if (
      !r ||
      r.version !== clean.version ||
      r.challenge !== clean.challenge ||
      !Number.isInteger(r.index) ||
      r.index < 0 ||
      r.index >= COUNT ||
      !Array.isArray(r.items) ||
      r.items.length !== COUNT
    )
      throw new Error("Invalid round");
    r.items.forEach((item, i) => {
      const target = game.byId.get(clean.items[i].id),
        n = area(target);
      if (
        item.id !== target.id ||
        ![null, "solved", "given-up"].includes(item.outcome) ||
        !Number.isInteger(item.erased) ||
        item.erased < 0 ||
        item.erased > n ||
        !Array.isArray(item.guesses) ||
        item.guesses.length > game.pokemon.length ||
        item.guesses.some((id) => !game.byId.has(id))
      )
        throw new Error("Invalid question");
      const arts = item.guesses.map((id) => game.byId.get(id).art);
      const correct = arts.indexOf(target.art);
      if (
        new Set(arts).size !== arts.length ||
        (i < r.index && !item.outcome) ||
        (i > r.index && (item.outcome || item.erased || arts.length)) ||
        (item.outcome === "solved"
          ? correct < 0 || correct !== arts.length - 1
          : correct !== -1)
      )
        throw new Error("Invalid guesses");
      const points =
        item.outcome === "solved"
          ? potentialScore(item.erased, n, arts.length - 1)
          : 0;
      if (item.points !== points) throw new Error("Invalid score");
      let mask = new Uint8Array(SIZE * SIZE);
      if (i === r.index && !item.outcome) {
        mask = unpackMask(item.mask);
        const [x, y, w, h] = target.frame;
        let count = 0;
        mask.forEach((v, k) => {
          if (!v) return;
          if (
            k % SIZE < x ||
            k % SIZE >= x + w ||
            k >> 8 < y ||
            k >> 8 >= y + h
          )
            throw new Error("Mask outside frame");
          count++;
        });
        if (count !== item.erased) throw new Error("Incorrect area");
      } else if (item.mask !== null) throw new Error("Unexpected mask");
      clean.items[i] = {
        id: item.id,
        erased: item.erased,
        guesses: [...item.guesses],
        outcome: item.outcome,
        points,
        mask,
      };
    });
    clean.index = r.index;
    return clean;
  } catch {
    return newRound(game, settings);
  }
}
