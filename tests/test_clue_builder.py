import unittest
import json
from scripts.build_pokeclue import build, evolution_info, form_generation, PUBLIC


class ClueBuilderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = build()

    def test_babies_and_branches(self):
        info = evolution_info({
            172: {"evolves_from_species_id": None},
            25: {"evolves_from_species_id": 172},
            26: {"evolves_from_species_id": 25},
            133: {"evolves_from_species_id": None},
            134: {"evolves_from_species_id": 133},
            700: {"evolves_from_species_id": 133},
        })
        self.assertEqual(info[26], {"stage": 3, "family": 172})
        self.assertEqual(info[134], info[700])

    def test_cycles_fail(self):
        with self.assertRaises(ValueError):
            evolution_info({1: {"evolves_from_species_id": 2}, 2: {"evolves_from_species_id": 1}})

    def test_export_is_complete_and_reproducible(self):
        data = self.data
        self.assertEqual(data, build())
        self.assertEqual(len(data["pokemon"]), 1579)
        self.assertEqual(len({p["id"] for p in data["pokemon"]}), 1579)
        groups = {g["key"] for g in data["eggGroups"]}
        self.assertIn("no-eggs", groups)
        self.assertIn("ditto", groups)
        used = {a["id"] for p in data["pokemon"] for a in p["abilities"]}
        abilities = [a for a in data["abilities"] if a["id"] in used]
        self.assertEqual(len(abilities), len({a["english"] for a in abilities}))
        self.assertEqual(len(abilities), len({a["name"] for a in abilities}))
        for p in data["pokemon"]:
            self.assertTrue(1 <= p["stage"] <= 3)
            self.assertTrue(set(p["eggGroups"]) <= groups)
            self.assertGreater(p["bst"], 0)
            self.assertGreaterEqual(p["generation"], p["speciesGeneration"])

    def test_form_debuts_and_internal_pattern_exceptions(self):
        names = {p["id"]: p["key"] for p in json.loads((PUBLIC / "pokemantle.json").read_text(encoding="utf-8"))["pokemon"]}
        rows = {names[p["id"]]: p for p in self.data["pokemon"]}
        self.assertEqual(self.data["generationBasis"], "form-debut-v2")
        for key, generation in [
            ("growlithe", 1), ("growlithe-hisui", 8), ("vulpix-alola", 7),
            ("meowth-galar", 8), ("wooper-paldea", 9), ("charizard-mega-x", 1),
            ("charizard-gmax", 1), ("dragonite-mega", 1), ("dialga-origin", 8),
            ("unown-exclamation", 3), ("arceus-fairy", 6),
            ("mothim-sandy", 4), ("scatterbug-polar", 6), ("spewpa-polar", 6),
        ]:
            self.assertEqual(rows[key]["generation"], generation, key)
        self.assertEqual(rows["growlithe-hisui"]["speciesGeneration"], 1)
        self.assertEqual(rows["charizard-mega-x"]["debutGeneration"], 6)
        self.assertEqual(rows["charizard-gmax"]["debutGeneration"], 8)
        self.assertEqual(rows["dragonite-mega"]["debutGeneration"], 9)
        transformations = [p for key, p in rows.items() if {"mega", "gmax"} & set(key.split("-"))]
        self.assertEqual(len(transformations), 131)
        for row in transformations:
            self.assertEqual(row["generation"], row["speciesGeneration"])

    def test_bad_form_metadata_never_silently_inherits_species_generation(self):
        form = {"id": 10398, "key": "growlithe-hisui"}
        species = {"id": 58, "generation_id": 1}
        raw = {"id": 10398, "name": "growlithe-hisui", "version_group": {"name": "legends-arceus"}}
        self.assertEqual(form_generation(form, raw, species, {"legends-arceus": 8}), 8)
        for broken in [{**raw, "id": 58}, {**raw, "name": "growlithe"}, {**raw, "version_group": None}]:
            with self.assertRaises(ValueError):
                form_generation(form, broken, species, {"legends-arceus": 8})
        with self.assertRaises(ValueError):
            form_generation(form, raw, species, {})


if __name__ == "__main__":
    unittest.main()
