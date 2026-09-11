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
  applyHint,
  isPokemonUsed,
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
    assert.equal(base.uniquePokemon, true);
    assert.match(base.id, /^v3-/);
    for (const key of new Set(base.solution.map(pairKey))) {
      assert.ok(
        base.solution.filter((pair) => pairKey(pair) === key).length <=
          catalog.pokemon.filter((p) => pairKey(p.types) === key).length,
      );
    }
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
      assert.equal(new Set(puzzle.representatives).size, size ** 2);
      assert.equal(findConflicts(puzzle, state.entries, byId).size, 0);
      state.entries = [...puzzle.representatives];
      assert.ok(isComplete(puzzle, state, byId));
    }
});

test("duplicate Pokemon are rejected across non-peer cells without changing state", () => {
  const { puzzle } = fixture();
  puzzle.givens.fill(false);
  const state = newState(puzzle),
    index = 0;
  const other = state.entries.findIndex(
    (_, i) => i !== index && !getPeers(puzzle, index).has(i),
  );
  const id = puzzle.representatives[index];
  assert.ok(placePokemon(puzzle, state, byId, other, id));
  assert.ok(setNotes(puzzle, state, index, puzzle.types));
  const before = JSON.stringify(state);
  assert.equal(canPlace(puzzle, state.entries, byId, index, id), false);
  assert.equal(placePokemon(puzzle, state, byId, index, id), false);
  assert.equal(JSON.stringify(state), before);
  const onlyOne = new Map([[id, byId.get(id)]]);
  assert.deepEqual(
    getCandidateTypes(puzzle, state.entries, onlyOne, index),
    [],
  );
  assert.ok(placePokemon(puzzle, state, byId, other, null));
  assert.ok(canPlace(puzzle, state.entries, byId, index, id));
  assert.deepEqual(
    getCandidateTypes(puzzle, state.entries, onlyOne, index),
    byId.get(id).types,
  );
  assert.ok(placePokemon(puzzle, state, byId, index, id));
  undo(state);
  undo(state);
  assert.equal(state.entries[other], id);
  assert.equal(state.entries[index], null);
  redo(state);
  redo(state);
  assert.equal(state.entries[index], id);
  assert.equal(state.entries[other], null);
});

test("same type pairs allow different Pokemon, but duplicate saved IDs and histories are rejected", () => {
  const { puzzle } = fixture();
  puzzle.givens.fill(false);
  const state = newState(puzzle);
  const index = puzzle.solution.findIndex((pair, i) =>
    puzzle.solution.some(
      (other, j) => j !== i && pairKey(other) === pairKey(pair),
    ),
  );
  assert.ok(index >= 0);
  const other = puzzle.solution.findIndex(
    (pair, i) =>
      i !== index && pairKey(pair) === pairKey(puzzle.solution[index]),
  );
  assert.equal(getPeers(puzzle, index).has(other), false);
  assert.ok(
    placePokemon(puzzle, state, byId, index, puzzle.representatives[index]),
  );
  assert.ok(
    canPlace(puzzle, state.entries, byId, other, puzzle.representatives[other]),
  );
  assert.ok(
    placePokemon(puzzle, state, byId, other, puzzle.representatives[other]),
  );
  assert.equal(findConflicts(puzzle, state.entries, byId).size, 0);
  state.entries = [...puzzle.representatives];
  const invalid = structuredClone(state);
  invalid.entries[other] = invalid.entries[index];
  assert.deepEqual(
    [...findConflicts(puzzle, invalid.entries, byId)].sort((a, b) => a - b),
    [index, other].sort((a, b) => a - b),
  );
  assert.deepEqual(
    wrongCells(puzzle, invalid, byId),
    [index, other].sort((a, b) => a - b),
  );
  assert.equal(isComplete(puzzle, invalid, byId), false);
  assert.equal(restoreState(JSON.stringify(invalid), puzzle, byId), null);
  state.undo = [{ entries: invalid.entries, notes: invalid.notes }];
  state.redo = [...state.undo];
  const restored = restoreState(JSON.stringify(state), puzzle, byId);
  assert.deepEqual(restored.undo, []);
  assert.deepEqual(restored.redo, []);
  assert.equal(
    restoreState(JSON.stringify({ ...state, version: 1 }), puzzle, byId),
    null,
  );
});

test("hints use another unused Pokemon when the preferred representative is already correctly placed", () => {
  const { puzzle } = fixture();
  puzzle.givens.fill(false);
  const state = newState(puzzle);
  const index = puzzle.solution.findIndex((pair, i) =>
    puzzle.solution.some(
      (other, j) => j !== i && pairKey(other) === pairKey(pair),
    ),
  );
  const other = puzzle.solution.findIndex(
    (pair, i) =>
      i !== index && pairKey(pair) === pairKey(puzzle.solution[index]),
  );
  assert.ok(
    placePokemon(puzzle, state, byId, other, puzzle.representatives[index]),
  );
  const result = applyHint(puzzle, state, byId, index);
  assert.equal(result.source, -1);
  assert.notEqual(result.id, puzzle.representatives[index]);
  assert.equal(state.entries[other], puzzle.representatives[index]);
  assert.equal(
    pairKey(byId.get(result.id).types),
    pairKey(puzzle.solution[index]),
  );
});

test("hints reclaim exhausted Pokemon only from wrong cells with one atomic undo", () => {
  const { puzzle } = fixture();
  puzzle.givens.fill(false);
  const state = newState(puzzle);
  const limited = new Map(
    puzzle.representatives.map((id) => [id, byId.get(id)]),
  );
  const index = 0,
    other = puzzle.solution.findIndex(
      (pair) => pairKey(pair) !== pairKey(puzzle.solution[index]),
    );
  state.entries = [...puzzle.representatives];
  state.entries[index] = null;
  state.entries[other] = puzzle.representatives[index];
  state.notes[index] = [...puzzle.types];
  const before = {
    entries: [...state.entries],
    notes: structuredClone(state.notes),
  };
  const result = applyHint(puzzle, state, limited, index);
  assert.deepEqual(result, {
    id: puzzle.representatives[index],
    source: other,
  });
  assert.equal(state.entries[other], null);
  assert.equal(state.hints, 1);
  assert.equal(state.moves, 1);
  assert.equal(state.undo.length, 1);
  assert.equal(findConflicts(puzzle, state.entries, byId).size, 0);
  undo(state);
  assert.deepEqual(state.entries, before.entries);
  assert.deepEqual(state.notes, before.notes);
  redo(state);
  assert.equal(state.entries[index], result.id);
  assert.equal(state.entries[other], null);
  const after = JSON.stringify(state);
  assert.equal(applyHint(puzzle, state, limited, index), null);
  assert.equal(applyHint(puzzle, state, limited, -1), null);
  assert.equal(JSON.stringify(state), after);
});

test("hints can complete every size without duplicates after a cycle of wrong guesses", () => {
  for (const size of [4, 6, 9]) {
    for (const seed of ["hints-a", "hints-b", "hints-c"]) {
      const puzzle = makePuzzle(pack, catalog, {
        size,
        seed,
        difficulty: "hard",
      });
      const state = newState(puzzle);
      const editable = state.entries.flatMap((id, i) =>
        id === null ? [i] : [],
      );
      editable.forEach((i, j) => {
        state.entries[i] =
          puzzle.representatives[editable[(j + 1) % editable.length]];
      });
      const limited = new Map(
        puzzle.representatives.map((id) => [id, byId.get(id)]),
      );
      const before = JSON.stringify(state);
      assert.equal(
        applyHint(puzzle, state, limited, puzzle.givens.findIndex(Boolean)),
        null,
      );
      assert.equal(JSON.stringify(state), before);
      for (
        let step = 0;
        step < editable.length && !isComplete(puzzle, state, limited);
        step++
      ) {
        const index =
          wrongCells(puzzle, state, limited)[0] ?? state.entries.indexOf(null);
        assert.ok(applyHint(puzzle, state, limited, index));
        const ids = state.entries.filter((id) => id !== null);
        assert.equal(new Set(ids).size, ids.length);
        puzzle.givens.forEach((given, i) => {
          if (given) assert.equal(state.entries[i], puzzle.representatives[i]);
        });
      }
      assert.ok(isComplete(puzzle, state, limited));
      assert.ok(restoreState(JSON.stringify(state), puzzle, limited));
    }
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
        (p) =>
          pairKey(p.types) === pairKey(puzzle.solution[i]) &&
          !isPokemonUsed(state.entries, i, p.id),
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
  const pick = catalog.pokemon.find(
    (p) =>
      !state.entries.includes(p.id) &&
      p.types.every((t) => puzzle.types.includes(t)) &&
      p.types.some((t) => byId.get(state.entries[other]).types.includes(t)),
  );
  assert.ok(pick);
  toggleNote(puzzle, state, index, puzzle.types[0]);
  const noted = JSON.stringify(state.notes);
  assert.equal(canPlace(puzzle, state.entries, byId, index, pick.id), false);
  assert.ok(placePokemon(puzzle, state, byId, index, pick.id));
  assert.ok(findConflicts(puzzle, state.entries, byId).has(index));
  assert.ok(findConflicts(puzzle, state.entries, byId).has(other));
  undo(state);
  assert.equal(state.entries[index], null);
  assert.equal(JSON.stringify(state.notes), noted);
  redo(state);
  assert.equal(state.entries[index], pick.id);
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

test("candidate notes depend on peers and unused Pokemon, never the hidden solution", () => {
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
      p.image?.startsWith("data:image/png;base64,") ||
        existsSync(
          new URL(`../web/public/sprites/${p.id}.png`, import.meta.url),
        ),
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

test("Mega and regional forms are distinct, searchable by species number and playable with their actual types", () => {
  assert.equal(catalog.pokemon.filter((p) => p.isAlternate).length, 126);
  assert.equal(catalog.pokemon.length, 652);
  assert.equal(new Set(catalog.pokemon.map((p) => p.id)).size, 652);
  const forms = new Map(catalog.pokemon.map((p) => [p.key, p]));
  const mega = forms.get("charizard-mega-x"),
    regional = forms.get("raichu-alola");
  assert.deepEqual(mega.types, [10, 16]);
  assert.deepEqual(regional.types, [13, 14]);
  for (const query of ["메가리자몽X", "리자몽 메가 X", "Mega Charizard X", "6"])
    assert.ok(
      searchPokemon(catalog.pokemon, query).some((p) => p.id === mega.id),
      query,
    );
  for (const query of ["알로라라이츄", "라이츄 알로라", "Alolan Raichu", "26"])
    assert.ok(
      searchPokemon(catalog.pokemon, query).some((p) => p.id === regional.id),
      query,
    );
  assert.ok(!forms.has("vulpix-alola"));
  const puzzle = makePuzzle(pack, catalog, {
    size: 9,
    difficulty: "hard",
    seed: "forms",
  });
  const state = newState(puzzle);
  const index = puzzle.givens.findIndex((given) => !given);
  const form = catalog.pokemon.find(
    (p) => p.isAlternate && !state.entries.includes(p.id),
  );
  assert.ok(puzzle.representatives.some((id) => byId.get(id).isAlternate));
  assert.ok(placePokemon(puzzle, state, byId, index, form.id));
  assert.deepEqual(restoreState(JSON.stringify(state), puzzle, byId), state);
  const other = puzzle.givens.findIndex((given, i) => !given && i !== index);
  assert.equal(placePokemon(puzzle, state, byId, other, form.id), false);
  assert.ok(undo(state));
  assert.equal(state.entries[index], null);
  assert.ok(redo(state));
  assert.equal(state.entries[index], form.id);
});
