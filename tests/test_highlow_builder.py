import json
import unittest
from scripts.build_highlow import build, PUBLIC, STATS


class HighLowBuilderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = build()
        cls.catalog = json.loads((PUBLIC / "pokemantle.json").read_text(encoding="utf-8"))

    def test_export_matches_checked_in_file_and_is_reproducible(self):
        self.assertEqual(self.data, build())
        self.assertEqual(self.data, json.loads((PUBLIC / "highlow.json").read_text(encoding="utf-8")))
        self.assertEqual(self.data["catalogVersion"], self.catalog["version"])
        self.assertEqual(self.data["stats"], STATS)
        self.assertEqual(len(self.data["dataVersion"]), 16)

    def test_each_catalog_form_has_exact_identity_and_valid_stats(self):
        rows = self.data["pokemon"]
        self.assertEqual(len(rows), len(self.catalog["pokemon"]))
        self.assertEqual(len({p["id"] for p in rows}), len(rows))
        clues = {p["id"]: p for p in json.loads((PUBLIC / "pokeclue.json").read_text(encoding="utf-8"))["pokemon"]}
        for form, row in zip(self.catalog["pokemon"], rows):
            for key in ["id", "pokemonId", "speciesId"]:
                self.assertEqual(row[key], form[key])
            if row["stats"] is not None:
                self.assertEqual(len(row["stats"]), 6)
                self.assertTrue(all(isinstance(n, int) and 0 < n < 1000 for n in row["stats"]))
                self.assertEqual(sum(row["stats"]), clues[row["id"]]["bst"])

    def test_mega_and_regional_forms_use_their_own_values(self):
        ids = {p["key"]: p["id"] for p in self.catalog["pokemon"]}
        rows = {p["id"]: p["stats"] for p in self.data["pokemon"]}
        for key, expected in [
            ("charizard", [78, 84, 78, 109, 85, 100]),
            ("charizard-mega-x", [78, 130, 111, 130, 85, 100]),
            ("growlithe", [55, 70, 45, 70, 50, 60]),
            ("growlithe-hisui", [60, 75, 45, 65, 50, 55]),
        ]:
            self.assertEqual(rows[ids[key]], expected, key)


if __name__ == "__main__":
    unittest.main()
