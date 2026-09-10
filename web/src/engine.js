export const GAME_VERSION = 1;
export const DIFFICULTIES = ["easy", "normal", "hard"];

export function hash(text) {
  let h = 2166136261;
  for (const char of String(text))
    h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function random(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, rng) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const pairKey = (types) => [...types].sort((a, b) => a - b).join("-");

export function getUnits({ size: n, boxRows, boxCols }) {
  const units = [];
  for (let r = 0; r < n; r++)
    units.push(Array.from({ length: n }, (_, c) => r * n + c));
  for (let c = 0; c < n; c++)
    units.push(Array.from({ length: n }, (_, r) => r * n + c));
  for (let r = 0; r < n; r += boxRows) {
    for (let c = 0; c < n; c += boxCols) {
      units.push(
        Array.from(
          { length: n },
          (_, k) => (r + Math.floor(k / boxCols)) * n + c + (k % boxCols),
        ),
      );
    }
  }
  return units;
}

export function getPeers(puzzle, index) {
  return new Set(
    getUnits(puzzle)
      .filter((unit) => unit.includes(index))
      .flat()
      .filter((i) => i !== index),
  );
}

export function makePuzzle(
  pack,
  catalog,
  { size = 6, difficulty = "normal", seed = "daily" } = {},
) {
  const rng = random(hash(seed));
  const options = pack.filter((p) => p.size === size);
  if (!options.length || !DIFFICULTIES.includes(difficulty))
    throw new Error("Unknown puzzle settings");
  const base = options[Math.floor(rng() * options.length)];
  const order = (step) =>
    shuffle(
      Array.from({ length: size / step }, (_, i) => i),
      rng,
    ).flatMap((group) =>
      shuffle(
        Array.from({ length: step }, (_, i) => group * step + i),
        rng,
      ),
    );
  const rows = order(base.boxRows);
  const cols = order(base.boxCols);
  const mapping = rows.flatMap((r) => cols.map((c) => r * size + c));
  const originalGivens = new Set(base.givens[difficulty]);
  const solution = mapping.map((i) => base.solution[i]);
  const pool = new Map();
  for (const p of catalog.pokemon) {
    const key = pairKey(p.types);
    pool.set(key, [...(pool.get(key) || []), p.id]);
  }
  const representatives = solution.map((pair) => {
    const choices = pool.get(pairKey(pair));
    if (!choices?.length) throw new Error("Missing Pokemon type pair");
    return choices[Math.floor(rng() * choices.length)];
  });
  return {
    id: `${base.id}-${hash(seed)}-${difficulty}`,
    size,
    difficulty,
    seed: String(seed),
    boxRows: base.boxRows,
    boxCols: base.boxCols,
    types: base.types,
    solution,
    representatives,
    givens: mapping.map((i) => originalGivens.has(i)),
  };
}

export function newState(puzzle) {
  return {
    version: GAME_VERSION,
    puzzleId: puzzle.id,
    entries: puzzle.givens.map((given, i) =>
      given ? puzzle.representatives[i] : null,
    ),
    notes: puzzle.givens.map(() => []),
    undo: [],
    redo: [],
    elapsedMs: 0,
    hints: 0,
    moves: 0,
  };
}

export function findConflicts(puzzle, entries, byId) {
  const conflicts = new Set();
  for (const unit of getUnits(puzzle)) {
    const seen = new Map();
    for (const index of unit) {
      const pokemon = byId.get(entries[index]);
      if (!pokemon) continue;
      for (const type of pokemon.types) {
        if (seen.has(type)) {
          conflicts.add(index);
          conflicts.add(seen.get(type));
        } else seen.set(type, index);
      }
    }
  }
  return conflicts;
}

export function canPlace(puzzle, entries, byId, index, id) {
  if (index < 0 || puzzle.givens[index]) return false;
  const p = byId.get(id);
  if (!p || !p.types.every((t) => puzzle.types.includes(t))) return false;
  return [...getPeers(puzzle, index)].every(
    (i) => !byId.get(entries[i])?.types.some((t) => p.types.includes(t)),
  );
}

const snapshot = (state) => ({
  entries: [...state.entries],
  notes: state.notes.map((n) => [...n]),
});
function remember(state) {
  state.undo = [...state.undo.slice(-99), snapshot(state)];
  state.redo = [];
}

export function placePokemon(puzzle, state, byId, index, id) {
  if (index < 0 || index >= state.entries.length || puzzle.givens[index])
    return false;
  if (
    id !== null &&
    (!byId.has(id) ||
      !byId.get(id).types.every((t) => puzzle.types.includes(t)))
  )
    return false;
  if (
    state.entries[index] === id &&
    (id !== null || state.notes[index].length === 0)
  )
    return false;
  remember(state);
  state.entries[index] = id;
  state.notes[index] = [];
  if (id !== null) {
    const types = byId.get(id).types;
    for (const peer of getPeers(puzzle, index)) {
      if (state.entries[peer] === null)
        state.notes[peer] = state.notes[peer].filter((t) => !types.includes(t));
    }
    state.moves++;
  }
  return true;
}

export function toggleNote(puzzle, state, index, type) {
  if (
    index < 0 ||
    puzzle.givens[index] ||
    state.entries[index] !== null ||
    !puzzle.types.includes(type)
  )
    return false;
  remember(state);
  const notes = new Set(state.notes[index]);
  if (notes.has(type)) notes.delete(type);
  else notes.add(type);
  state.notes[index] = [...notes].sort((a, b) => a - b);
  return true;
}

export function undo(state) {
  if (!state.undo.length) return false;
  state.redo.push(snapshot(state));
  Object.assign(state, state.undo.pop());
  return true;
}

export function redo(state) {
  if (!state.redo.length) return false;
  state.undo.push(snapshot(state));
  Object.assign(state, state.redo.pop());
  return true;
}

export function isComplete(puzzle, state, byId) {
  return (
    state.entries.every(
      (id) =>
        byId.has(id) &&
        byId.get(id).types.every((t) => puzzle.types.includes(t)),
    ) && findConflicts(puzzle, state.entries, byId).size === 0
  );
}

export function wrongCells(puzzle, state, byId) {
  return state.entries.flatMap((id, i) =>
    id !== null &&
    pairKey(byId.get(id)?.types || []) !== pairKey(puzzle.solution[i])
      ? [i]
      : [],
  );
}

export function restoreState(raw, puzzle, byId) {
  try {
    const state = JSON.parse(raw);
    if (
      !state ||
      state.version !== GAME_VERSION ||
      state.puzzleId !== puzzle.id
    )
      return null;
    const n = puzzle.size ** 2;
    const validSnapshot = (s) =>
      s &&
      Array.isArray(s.entries) &&
      s.entries.length === n &&
      Array.isArray(s.notes) &&
      s.notes.length === n &&
      s.entries.every(
        (id, i) =>
          (id === null ||
            (byId.has(id) &&
              byId.get(id).types.every((t) => puzzle.types.includes(t)))) &&
          (!puzzle.givens[i] || id === puzzle.representatives[i]),
      ) &&
      s.notes.every(
        (note, i) =>
          Array.isArray(note) &&
          note.length <= puzzle.types.length &&
          note.every((t) => puzzle.types.includes(t)) &&
          new Set(note).size === note.length &&
          (!puzzle.givens[i] || note.length === 0),
      );
    if (!validSnapshot(state)) return null;
    for (const field of ["elapsedMs", "moves", "hints"])
      if (!Number.isFinite(state[field]) || state[field] < 0) return null;
    state.undo = Array.isArray(state.undo)
      ? state.undo.filter(validSnapshot).slice(-100)
      : [];
    state.redo = Array.isArray(state.redo)
      ? state.redo.filter(validSnapshot).slice(-100)
      : [];
    return state;
  } catch {
    return null;
  }
}

const INITIALS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
export function initials(name) {
  return [...name]
    .map((c) => {
      const code = c.charCodeAt(0) - 0xac00;
      return code >= 0 && code <= 11171 ? INITIALS[Math.floor(code / 588)] : c;
    })
    .join("");
}

export function searchPokemon(pokemon, query) {
  const q = query.trim().toLowerCase().replace(/\s/g, "");
  return pokemon.filter(
    (p) =>
      !q ||
      [p.name, p.english, p.key, String(p.id), initials(p.name)].some((value) =>
        value.toLowerCase().replace(/\s/g, "").includes(q),
      ),
  );
}

export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
