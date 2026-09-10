import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  makePuzzle,
  newState,
  getUnits,
  pairKey,
  findConflicts,
  canPlace,
  placePokemon,
  toggleNote,
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

test("Korean, initials, English and dex number search work and every sprite is local", () => {
  for (const query of ["이상해씨", "ㅇㅅㅎㅆ", "Bulbasaur", "1"])
    assert.ok(searchPokemon(catalog.pokemon, query).some((p) => p.id === 1));
  for (const p of catalog.pokemon)
    assert.ok(
      existsSync(new URL(`../web/public/sprites/${p.id}.png`, import.meta.url)),
    );
});
