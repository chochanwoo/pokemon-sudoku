import unittest
from scripts.build_pokeclue import build, evolution_info


class ClueBuilderTests(unittest.TestCase):
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
        data = build()
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


if __name__ == "__main__":
    unittest.main()
