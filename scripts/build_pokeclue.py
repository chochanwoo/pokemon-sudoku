"""Export attribute clues without changing the shared catalog or similarity data."""

from functools import lru_cache
import json
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "web" / "public"
CACHE = ROOT / "data" / "cache" / "pokeapi"
# Localized names from PokeAPI's data/v2/csv/egg_group_prose.csv.
EGG_GROUPS = [
    ("monster", "괴수", "Monster"),
    ("water1", "수중 1", "Water 1"),
    ("bug", "벌레", "Bug"),
    ("flying", "비행", "Flying"),
    ("ground", "육상", "Field"),
    ("fairy", "요정", "Fairy"),
    ("plant", "식물", "Grass"),
    ("humanshape", "인간형", "Human-Like"),
    ("water3", "수중 3", "Water 3"),
    ("mineral", "광물", "Mineral"),
    ("indeterminate", "부정형", "Amorphous"),
    ("water2", "수중 2", "Water 2"),
    ("ditto", "메타몽", "Ditto"),
    ("dragon", "드래곤", "Dragon"),
    ("no-eggs", "알미발견", "Undiscovered"),
]


def evolution_info(species):
    @lru_cache(None)
    def lineage(sid):
        path, seen = [], set()
        while sid is not None:
            if sid in seen:
                raise ValueError("Cyclic evolution lineage")
            seen.add(sid)
            path.append(sid)
            sid = species[sid]["evolves_from_species_id"]
        return {"stage": len(path), "family": path[-1]}

    return {sid: lineage(sid) for sid in species}


def form_debut_generation(form, raw, species, version_groups):
    if raw.get("id") != form["id"] or raw.get("name") != form["key"]:
        raise ValueError(f"Mismatched form metadata: {form['key']}")
    version = (raw.get("version_group") or {}).get("name")
    generation = version_groups.get(version)
    if not isinstance(generation, int) or generation < species["generation_id"]:
        raise ValueError(f"Invalid debut version for {form['key']}: {version}")
    # These invisible evolution-pattern tags existed with their species, not USUM.
    if species["id"] in {414, 664, 665}:
        return species["generation_id"]
    return generation


def form_generation(form, raw, species, version_groups):
    debut = form_debut_generation(form, raw, species, version_groups)
    if raw.get("is_mega") or "gmax" in form["key"].split("-"):
        return species["generation_id"]
    return debut


def build():
    catalog = json.loads((PUBLIC / "pokemantle.json").read_text(encoding="utf-8"))
    path = ROOT / "data" / "build" / "pokemon.db"
    with sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        species = {r["id"]: dict(r) for r in db.execute("SELECT * FROM pokemon_species")}
        pokemon = {r["id"]: dict(r) for r in db.execute("SELECT * FROM pokemon")}
        version_groups = dict(db.execute("SELECT key,generation_id FROM version_groups"))
        abilities = [dict(r) for r in db.execute(
            "SELECT id,key,name_ko AS name,name_en AS english FROM abilities ORDER BY id")]
        assigned = {}
        for row in db.execute("SELECT pokemon_id,ability_id,is_hidden FROM pokemon_abilities ORDER BY slot,ability_id"):
            assigned.setdefault(row["pokemon_id"], []).append({
                "id": row["ability_id"], "hidden": bool(row["is_hidden"]),
            })
    evolution = evolution_info(species)
    for ability in abilities:
        variant = {"as-one-glastrier": 896, "as-one-spectrier": 897}.get(ability["key"])
        if variant:
            ability["name"] += f" ({species[variant]['name_ko']})"
            ability["english"] += f" ({species[variant]['name_en']})"
    groups = {key for key, _, _ in EGG_GROUPS}
    rows = []
    for form in catalog["pokemon"]:
        p, s = pokemon[form["pokemonId"]], species[form["speciesId"]]
        raw = json.loads((CACHE / "pokemon-form" / f"{form['id']}.json").read_text(encoding="utf-8"))
        eggs = sorted(filter(None, (s["egg_groups"] or "").split("|")))
        if set(eggs) - groups:
            raise ValueError(f"Unknown egg group: {eggs}")
        if p["species_id"] != s["id"] or not p["base_stat_total"]:
            raise ValueError(f"Invalid form data: {form['key']}")
        rows.append({
            "id": form["id"], "pokemonId": p["id"], "speciesId": s["id"],
            "generation": form_generation(form, raw, s, version_groups),
            "debutGeneration": form_debut_generation(form, raw, s, version_groups),
            "speciesGeneration": s["generation_id"], **evolution[s["id"]],
            "abilities": assigned.get(p["id"], []), "eggGroups": eggs,
            "bst": p["base_stat_total"],
        })
    return {
        "version": "pokeclue-v1", "catalogVersion": catalog["version"],
        "generationBasis": "form-debut-v2",
        "pokemon": rows, "abilities": abilities,
        "eggGroups": [{"key": key, "name": ko, "english": en} for key, ko, en in EGG_GROUPS],
    }


if __name__ == "__main__":
    data = build()
    (PUBLIC / "pokeclue.json").write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"PokeClue: {len(data['pokemon'])} form records exported")
