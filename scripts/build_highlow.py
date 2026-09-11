"""Export form-specific base stats from the existing read-only master database."""

import hashlib
import json
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "web" / "public"
STATS = ["hp", "attack", "defense", "special_attack", "special_defense", "speed"]


def build():
    catalog = json.loads((PUBLIC / "pokemantle.json").read_text(encoding="utf-8"))
    path = ROOT / "data" / "build" / "pokemon.db"
    with sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        pokemon = {row["id"]: dict(row) for row in db.execute("SELECT * FROM pokemon")}
    rows = []
    for form in catalog["pokemon"]:
        source = pokemon[form["pokemonId"]]
        if source["species_id"] != form["speciesId"]:
            raise ValueError(f"Mismatched species: {form['key']}")
        values = [source[key] for key in STATS]
        if not all(isinstance(value, int) and value > 0 for value in values):
            values = None
        elif sum(values) != source["base_stat_total"]:
            raise ValueError(f"Mismatched stat total: {form['key']}")
        rows.append({"id": form["id"], "pokemonId": form["pokemonId"],
                     "speciesId": form["speciesId"], "stats": values})
    signature = hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()[:16]
    return {"version": "highlow-v1", "catalogVersion": catalog["version"],
            "dataVersion": signature, "stats": STATS, "pokemon": rows}


if __name__ == "__main__":
    data = build()
    (PUBLIC / "highlow.json").write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"High Low: {len(data['pokemon'])} form records exported")
