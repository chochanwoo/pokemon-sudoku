import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  makePuzzle,
  newState,
  getUnits,
  getPeers,
  getUnitTypeStatus,
  getCandidateTypes,
  pairKey,
  findConflicts,
  canPlace,
  placePokemon,
  toggleNote,
  setNotes,
  undo,
  redo,
  isComplete,
  wrongCells,
  restoreState,
  searchPokemon,
  dayKey,
} from "../web/src/engine.js";

const catalog = JSON.parse(
  readFileSync(new URL("../web/public/catalog.json", import.meta.url)),
);
const pack = JSON.parse(
  readFileSync(new URL("../web/public/puzzles.json", import.meta.url)),
);
const byId = new Map(catalog.pokemon.map((p) => [p.id, p]));
const pairs = new Set(catalog.pokemon.map((p) => pairKey(p.types)));
const fixture = () => {
  const puzzle = makePuzzle(pack, catalog, {
    size: 6,
    difficulty: "hard",
    seed: "test",
  });
  return { puzzle, state: newState(puzzle) };
};

test("all generated puzzles and randomized permutations satisfy dual-type Sudoku constraints", () => {
  for (const base of pack) {
    for (const unit of getUnits(base)) {
      const values = unit.flatMap((i) => base.solution[i]);
      assert.equal(new Set(values).size, base.size * 2);
      assert.deepEqual(
        [...new Set(values)].sort((a, b) => a - b),
        base.types,
      );
    }
    base.solution.forEach((pair) => assert.ok(pairs.has(pairKey(pair))));
    for (const difficulty of ["easy", "normal", "hard"])
      assert.ok(base.givens[difficulty].length < base.size ** 2);
  }
  for (const size of [4, 6, 9])
    for (let seed = 0; seed < 30; seed++) {
      const puzzle = makePuzzle(pack, catalog, { size, seed: String(seed) });
      for (const unit of getUnits(puzzle))
        assert.equal(
          new Set(unit.flatMap((i) => puzzle.solution[i])).size,
          size * 2,
        );
      const state = newState(puzzle);
      assert.equal(findConflicts(puzzle, state.entries, byId).size, 0);
    }
});

test("daily construction is deterministic and date boundary is Korean midnight", () => {
  assert.deepEqual(
    makePuzzle(pack, catalog, { seed: "2026-09-08" }),
    makePuzzle(pack, catalog, { seed: "2026-09-08" }),
  );
  assert.equal(dayKey(new Date("2026-09-08T14:59:59Z")), "2026-09-08");
  assert.equal(dayKey(new Date("2026-09-08T15:00:00Z")), "2026-09-09");
});

test("locked cells, outsiders, and out-of-bounds input cannot alter a puzzle", () => {
  const { puzzle, state } = fixture(),
    locked = puzzle.givens.findIndex(Boolean),
    empty = state.entries.indexOf(null);
  const outsider = catalog.pokemon.find(
    (p) => !p.types.every((t) => puzzle.types.includes(t)),
  );
  const before = JSON.stringify(state);
  assert.equal(placePokemon(puzzle, state, byId, locked, null), false);
  assert.equal(placePokemon(puzzle, state, byId, -1, 1), false);
  assert.equal(placePokemon(puzzle, state, byId, empty, outsider.id), false);
  assert.equal(JSON.stringify(state), before);
});

test("any Pokemon with the correct pair is accepted, not just the generated representative", () => {
  const { puzzle, state } = fixture();
  let usedAlternative = false;
  for (let i = 0; i < state.entries.length; i++)
    if (!puzzle.givens[i]) {
      const options = catalog.pokemon.filter(
        (p) => pairKey(p.types) === pairKey(puzzle.solution[i]),
      );
      const pick =
        options.find((p) => p.id !== puzzle.representatives[i]) || options[0];
      usedAlternative ||= pick.id !== puzzle.representatives[i];
      assert.ok(canPlace(puzzle, state.entries, byId, i, pick.id));
      assert.ok(placePokemon(puzzle, state, byId, i, pick.id));
    }
  assert.ok(usedAlternative);
  assert.ok(isComplete(puzzle, state, byId));
  assert.deepEqual(wrongCells(puzzle, state, byId), []);
});

test("repeated row/column/box types are detected and undo/redo restores notes", () => {
  const { puzzle, state } = fixture(),
    index = state.entries.indexOf(null);
  const unit = getUnits(puzzle).find(
    (u) => u.includes(index) && u.some((i) => i !== index && state.entries[i]),
  );
  const other = unit.find((i) => i !== index && state.entries[i]);
  toggleNote(puzzle, state, index, puzzle.types[0]);
  const noted = JSON.stringify(state.notes);
  assert.equal(
    canPlace(puzzle, state.entries, byId, index, state.entries[other]),
    false,
  );
  placePokemon(puzzle, state, byId, index, state.entries[other]);
  assert.ok(findConflicts(puzzle, state.entries, byId).has(index));
  assert.ok(findConflicts(puzzle, state.entries, byId).has(other));
  undo(state);
  assert.equal(state.entries[index], null);
  assert.equal(JSON.stringify(state.notes), noted);
  redo(state);
  assert.equal(state.entries[index], state.entries[other]);
});

test("restoring validates board identity, fixed clues, unknown species and malformed histories", () => {
  const { puzzle, state } = fixture();
  assert.deepEqual(restoreState(JSON.stringify(state), puzzle, byId), state);
  assert.equal(restoreState("{broken", puzzle, byId), null);
  assert.equal(
    restoreState(JSON.stringify({ ...state, puzzleId: "other" }), puzzle, byId),
    null,
  );
  const altered = structuredClone(state);
  altered.entries[puzzle.givens.findIndex(Boolean)] = null;
  assert.equal(restoreState(JSON.stringify(altered), puzzle, byId), null);
  const unknown = structuredClone(state);
  unknown.entries[state.entries.indexOf(null)] = 999999;
  assert.equal(restoreState(JSON.stringify(unknown), puzzle, byId), null);
  assert.equal(
    restoreState(JSON.stringify({ ...state, elapsedMs: -1 }), puzzle, byId),
    null,
  );
});

test("remaining types track every row, column and rectangular box, including duplicates", () => {
  for (const size of [4, 6, 9]) {
    const puzzle = makePuzzle(pack, catalog, { size, seed: "remaining-types" });
    const state = newState(puzzle);
    const units = getUnitTypeStatus(puzzle, state.entries, byId);
    assert.equal(units.length, size * 3);
    for (const [i, unit] of units.entries()) {
      assert.equal(unit.kind, ["row", "column", "box"][Math.floor(i / size)]);
      assert.equal(unit.index, i % size);
      assert.deepEqual(unit.cells, getUnits(puzzle)[i]);
      const used = unit.cells.flatMap(
        (cell) => byId.get(state.entries[cell])?.types || [],
      );
      assert.deepEqual(
        unit.missing,
        puzzle.types.filter((t) => !used.includes(t)),
      );
      assert.deepEqual(unit.duplicates, []);
    }
    state.entries = [...puzzle.representatives];
    assert.ok(
      getUnitTypeStatus(puzzle, state.entries, byId).every(
        (u) => !u.missing.length && !u.duplicates.length,
      ),
    );
    state.entries[0] = state.entries[1];
    const row = getUnitTypeStatus(puzzle, state.entries, byId)[0];
    assert.deepEqual(
      row.missing,
      [...puzzle.solution[0]].sort((a, b) => a - b),
    );
    assert.deepEqual(
      row.duplicates,
      [...puzzle.solution[1]].sort((a, b) => a - b),
    );
  }
});

test("candidate notes depend only on peers and actual Pokemon, never the hidden solution", () => {
  for (const size of [4, 6, 9]) {
    const puzzle = makePuzzle(pack, catalog, {
      size,
      difficulty: "hard",
      seed: "candidate-types",
    });
    const state = newState(puzzle);
    for (const [index, id] of state.entries.entries()) {
      if (id !== null) continue;
      const expected = new Set(
        catalog.pokemon
          .filter((p) => canPlace(puzzle, state.entries, byId, index, p.id))
          .flatMap((p) => p.types),
      );
      assert.deepEqual(
        getCandidateTypes(puzzle, state.entries, byId, index),
        puzzle.types.filter((t) => expected.has(t)),
      );
      assert.deepEqual(
        getCandidateTypes(
          { ...puzzle, solution: [] },
          state.entries,
          byId,
          index,
        ),
        puzzle.types.filter((t) => expected.has(t)),
      );
    }
    for (const index of [-1, 0.5, size ** 2, puzzle.givens.findIndex(Boolean)])
      assert.deepEqual(
        getCandidateTypes(puzzle, state.entries, byId, index),
        [],
      );
  }
});

test("bulk and manual notes preserve history, persistence and peer pruning", () => {
  const { puzzle, state } = fixture();
  const index = state.entries.indexOf(null);
  const before = JSON.stringify(state);
  for (const invalid of [
    -1,
    0.5,
    state.entries.length,
    puzzle.givens.findIndex(Boolean),
  ]) {
    assert.equal(setNotes(puzzle, state, invalid, puzzle.types), false);
    assert.equal(toggleNote(puzzle, state, invalid, puzzle.types[0]), false);
  }
  assert.equal(setNotes(puzzle, state, index, [999]), false);
  assert.equal(JSON.stringify(state), before);
  const notes = getCandidateTypes(puzzle, state.entries, byId, index);
  assert.ok(setNotes(puzzle, state, index, [...notes, ...notes]));
  assert.deepEqual(state.notes[index], notes);
  assert.equal(setNotes(puzzle, state, index, notes), false);
  assert.equal(state.undo.length, 1);
  assert.ok(setNotes(puzzle, state, index, []));
  undo(state);
  assert.deepEqual(state.notes[index], notes);
  redo(state);
  assert.deepEqual(state.notes[index], []);
  setNotes(puzzle, state, index, puzzle.types);
  const peer = [...getPeers(puzzle, index)].find((i) => !puzzle.givens[i]);
  setNotes(puzzle, state, peer, puzzle.types);
  placePokemon(puzzle, state, byId, index, puzzle.representatives[index]);
  assert.deepEqual(state.notes[index], []);
  assert.deepEqual(
    state.notes[peer],
    puzzle.types.filter((t) => !puzzle.solution[index].includes(t)),
  );
  undo(state);
  assert.deepEqual(state.notes[index], puzzle.types);
  assert.deepEqual(state.notes[peer], puzzle.types);
  assert.deepEqual(restoreState(JSON.stringify(state), puzzle, byId), state);
});

test("Korean, initials, English and dex number search work and every sprite is local", () => {
  for (const query of ["이상해씨", "ㅇㅅㅎㅆ", "Bulbasaur", "1"])
    assert.ok(searchPokemon(catalog.pokemon, query).some((p) => p.id === 1));
  for (const p of catalog.pokemon)
    assert.ok(
      existsSync(new URL(`../web/public/sprites/${p.id}.png`, import.meta.url)),
    );
});

test("all 18 types have distinct, local SVG icons and bundled license credits", () => {
  const sources = catalog.types.map((type) =>
    readFileSync(
      new URL(`../web/src/assets/types/${type.key}.svg`, import.meta.url),
      "utf8",
    ),
  );
  assert.equal(sources.length, 18);
  assert.equal(new Set(sources).size, 18);
  for (const source of sources) {
    assert.match(source, /<svg\b/);
    assert.match(source, /viewBox="0 0 256 256"/);
    assert.doesNotMatch(
      source,
      /<script|<foreignObject|\son\w+=|(?:href|src)=/i,
    );
  }
  const notice = readFileSync(
    new URL("../web/public/NOTICE.txt", import.meta.url),
    "utf8",
  );
  assert.match(notice, /Copyright \(c\) 2022 James Watkins/);
  assert.match(notice, /MIT License/);
});
