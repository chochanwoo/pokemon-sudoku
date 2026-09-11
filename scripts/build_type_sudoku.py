"""Export a small, self-contained static game dataset from the master database."""

import argparse
from collections import Counter
import concurrent.futures
import io
import json
from pathlib import Path
import random
import sqlite3
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".tools" / "python"))
from ortools.sat.python import cp_model
from PIL import Image

PUBLIC = ROOT / "web" / "public"


def export_catalog():
    with sqlite3.connect(ROOT / "data" / "build" / "pokemon.db") as db:
        db.row_factory = sqlite3.Row
        types = [dict(r) for r in db.execute("SELECT id,key,name_ko AS name FROM types WHERE id <= 18 ORDER BY id")]
        pokemon = []
        for r in db.execute("SELECT id,key,name_ko AS name,name_en AS english,sprite_front_default AS url FROM pokemon WHERE is_default=1 ORDER BY id"):
            entry = dict(r)
            entry["types"] = [t[0] for t in db.execute("SELECT type_id FROM pokemon_types WHERE pokemon_id=? ORDER BY type_id", (r["id"],))]
            if len(entry["types"]) == 2 and entry["url"]:
                pokemon.append(entry)
    return types, include_special_forms(pokemon, json.loads((PUBLIC / "pokemantle.json").read_text(encoding="utf-8")))


def include_special_forms(pokemon, source):
    result = list(pokemon)
    seen = {p["id"] for p in result}
    valid_types = set(range(1, 19))
    for form in source["pokemon"]:
        if not set(form["key"].split("-")) & {"mega", "alola", "galar", "hisui", "paldea"}:
            continue
        if len(set(form["types"])) != 2 or not set(form["types"]) <= valid_types:
            continue
        if form["id"] in seen:
            raise ValueError(f"Duplicate Pokemon ID: {form['id']}")
        image = source["images"].get(form.get("image"))
        if not image:
            raise ValueError(f"Missing special-form sprite: {form['key']}")
        entry = {key: form[key] for key in ["id", "speciesId", "key", "name", "english", "baseName", "form", "aliases", "types"]}
        entry.update(isAlternate=True, image=image)
        result.append(entry)
        seen.add(form["id"])
    return result


def units(n, bh, bw):
    result = [[r * n + c for c in range(n)] for r in range(n)]
    result += [[r * n + c for r in range(n)] for c in range(n)]
    result += [[(r + dr) * n + c + dc for dr in range(bh) for dc in range(bw)]
               for r in range(0, n, bh) for c in range(0, n, bw)]
    return result


def model_for(n, bh, bw, type_ids, pairs, clues=None, excluded=None, capacities=None):
    model = cp_model.CpModel()
    cells = [(model.new_int_var_from_domain(cp_model.Domain.from_values(type_ids), f"a{i}"),
              model.new_int_var_from_domain(cp_model.Domain.from_values(type_ids), f"b{i}")) for i in range(n*n)]
    pair_ids = []
    for i, (a, b) in enumerate(cells):
        pair_id = model.new_int_var(0, len(pairs)-1, f"pair{i}")
        pair_ids.append(pair_id)
        model.add_allowed_assignments([a, b, pair_id], [[*pair, j] for j, pair in enumerate(pairs)])
    # Each species belongs to one pair; limiting pair counts permits unique Pokemon.
    for j, pair in enumerate(pairs):
        capacity = capacities.get(tuple(pair), 0) if capacities is not None else n
        if capacity >= n:
            continue
        matches = []
        for i, pair_id in enumerate(pair_ids):
            matches.append(model.new_bool_var(f"pair{j}_at{i}"))
            model.add(pair_id == j).only_enforce_if(matches[-1])
            model.add(pair_id != j).only_enforce_if(matches[-1].Not())
        model.add(sum(matches) <= capacity)
    for unit in units(n, bh, bw):
        model.add_all_different([v for i in unit for v in cells[i]])
    for i, pair in (clues or {}).items():
        model.add(cells[i][0] == pair[0])
        model.add(cells[i][1] == pair[1])
    if excluded:
        # Forbid the entire type-pair solution, not a particular Pokemon choice.
        model.add_forbidden_assignments([v for cell in cells for v in cell], [[v for pair in excluded for v in pair]])
    return model, cells


def solve(model, cells, seed, seconds, workers=1):
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = seconds
    solver.parameters.num_search_workers = workers
    solver.parameters.random_seed = seed
    solver.parameters.randomize_search = True
    result = solver.solve(model)
    if result in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return result, [[solver.value(a), solver.value(b)] for a, b in cells]
    return result, None


def make_puzzle(n, bh, bw, pairs, capacities, seed):
    rng = random.Random(seed)
    for attempt in range(40):
        selected = sorted(rng.sample(range(1, 19), n * 2))
        allowed = [p for p in pairs if all(t in selected for t in p)]
        if any(sum(t in p for p in allowed) < 2 for t in selected):
            continue
        # Fix a valid first-row matching to eliminate interchangeable-column symmetry.
        matching = cp_model.CpModel()
        chosen = [matching.new_bool_var(f"edge{i}") for i in range(len(allowed))]
        for t in selected:
            matching.add_exactly_one(chosen[i] for i, pair in enumerate(allowed) if t in pair)
        matching.maximize(sum(rng.randrange(1, 100) * edge for edge in chosen))
        matching_solver = cp_model.CpSolver()
        matching_solver.parameters.max_time_in_seconds = 1
        matching_solver.parameters.num_search_workers = 1
        if matching_solver.solve(matching) not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            continue
        first_row = [pair for i, pair in enumerate(allowed) if matching_solver.value(chosen[i])]
        rng.shuffle(first_row)
        fixed = dict(enumerate(first_row))
        model, cells = model_for(n, bh, bw, selected, allowed, fixed, capacities=capacities)
        # At least one new pair makes the puzzle more than a renamed number Sudoku.
        model.add_forbidden_assignments(cells[n+1], first_row)
        _, solution = solve(model, cells, seed + attempt, 8, workers=8)
        if solution:
            break
    else:
        raise RuntimeError(f"Could not generate a {n}x{n} solution")

    clues = {i: pair for i, pair in enumerate(solution)}
    order = list(clues)
    rng.shuffle(order)
    masks = {}
    rejected = set()
    targets = {"easy": round(n*n*.65), "normal": round(n*n*.48), "hard": round(n*n*.32)}
    for difficulty, target in targets.items():
        for i in order:
            if len(clues) <= target:
                break
            if i not in clues or i in rejected:
                continue
            pair = clues.pop(i)
            model, cells = model_for(n, bh, bw, selected, allowed, clues, solution, capacities)
            status, _ = solve(model, cells, seed, .65)
            if status != cp_model.INFEASIBLE:
                clues[i] = pair
                rejected.add(i)
        masks[difficulty] = sorted(clues)
    return {"id": f"v3-{n}-{seed}", "uniquePokemon": True, "size": n, "boxRows": bh, "boxCols": bw,
            "types": selected, "solution": solution, "givens": masks}


def download_sprite(p):
    if p.get("image"):
        return
    destination = PUBLIC / "sprites" / f"{p['id']}.png"
    if destination.exists():
        return
    for attempt in range(4):
        try:
            req = urllib.request.Request(p["url"], headers={"User-Agent": "TypeSudokuDataBuilder/1.0"})
            with urllib.request.urlopen(req, timeout=25) as response:
                data = response.read()
            with Image.open(io.BytesIO(data)) as img:
                img.verify()
            destination.write_bytes(data)
            return
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets-only", action="store_true")
    parser.add_argument("--puzzles-only", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--count", type=int, default=6)
    args = parser.parse_args()
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "sprites").mkdir(exist_ok=True)
    if args.puzzles_only or args.verify:
        catalog = json.loads((PUBLIC / "catalog.json").read_text(encoding="utf-8"))
        types, pokemon = catalog["types"], catalog["pokemon"]
    else:
        types, pokemon = export_catalog()
    capacities = Counter(tuple(p["types"]) for p in pokemon)
    if args.verify:
        puzzles = json.loads((PUBLIC / "puzzles.json").read_text(encoding="utf-8"))
        pairs = sorted({tuple(p["types"]) for p in pokemon})
        for puzzle in puzzles:
            if len(puzzle["solution"]) != puzzle["size"] ** 2 or any(
                sorted(t for i in unit for t in puzzle["solution"][i]) != puzzle["types"]
                for unit in units(puzzle["size"], puzzle["boxRows"], puzzle["boxCols"])
            ):
                raise RuntimeError(f"Invalid stored solution: {puzzle['id']}")
            counts = Counter(tuple(pair) for pair in puzzle["solution"])
            if not puzzle.get("uniquePokemon") or any(count > capacities[pair] for pair, count in counts.items()):
                raise RuntimeError(f"Duplicate-free assignment is impossible: {puzzle['id']}")
            allowed = [p for p in pairs if all(t in puzzle["types"] for t in p)]
            for difficulty, givens in puzzle["givens"].items():
                model, cells = model_for(puzzle["size"], puzzle["boxRows"], puzzle["boxCols"],
                                         puzzle["types"], allowed,
                                         {i: puzzle["solution"][i] for i in givens}, puzzle["solution"], capacities)
                status, _ = solve(model, cells, 1, 10, workers=8)
                if status != cp_model.INFEASIBLE:
                    raise RuntimeError(f"Uniqueness verification failed: {puzzle['id']} {difficulty}")
        print(f"Verified duplicate-free unique solutions for all {len(puzzles)*3} puzzle/difficulty combinations", flush=True)
        return
    catalog = {"version": 2, "types": types, "pokemon": [{k:v for k,v in p.items() if k != "url"} for p in pokemon]}
    if not args.puzzles_only:
        (PUBLIC / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if not args.puzzles_only:
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
            list(executor.map(download_sprite, pokemon))
        print(f"Downloaded {len(pokemon)} sprites", flush=True)
    if not args.assets_only:
        pairs = sorted({tuple(p["types"]) for p in pokemon})
        puzzles = []
        for n, bh, bw in [(4, 2, 2), (6, 2, 3), (9, 3, 3)]:
            for i in range(args.count):
                print(f"Generating {n}x{n} puzzle {i+1}/{args.count}", flush=True)
                puzzle = make_puzzle(n, bh, bw, pairs, capacities, 7183 + i*971 + n*313)
                puzzles.append(puzzle)
                print(f"{puzzle['id']}: " + str({k:len(v) for k,v in puzzle['givens'].items()}), flush=True)
        (PUBLIC / "puzzles.json").write_text(json.dumps(puzzles, separators=(",", ":")), encoding="utf-8")
        print(f"Saved {len(puzzles)} uniquely solvable puzzles", flush=True)


if __name__ == "__main__":
    main()
