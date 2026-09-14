import json
import unittest
from scripts.build_pokinator import build, candidate_kind, PUBLIC


class PokinatorBuilderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = build()

    def test_export_is_reproducible_and_matches_bundle(self):
        self.assertEqual(self.data, build())
        self.assertEqual(self.data, json.loads((PUBLIC / "pokinator.json").read_text(encoding="utf-8")))

    def test_only_the_dedicated_policy_is_exported(self):
        rows = self.data["pokemon"]
        self.assertEqual(len(rows), len({p["id"] for p in rows}))
        self.assertEqual(len([p for p in rows if p["kind"] == "base"]), 1025)
        form = dict(key="darmanitan-galar-zen", is_default=True, is_battle_only=True, is_mega=False)
        self.assertIsNone(candidate_kind(form, {"is_default": False}))
        form.update(key="charizard-mega-x", is_mega=True)
        self.assertEqual(candidate_kind(form, {"is_default": False}), "mega")
        for key in ["raticate-totem-alola", "pikachu-alola-cap"]:
            form.update(key=key, is_mega=False, is_battle_only=False)
            self.assertIsNone(candidate_kind(form, {"is_default": False}))

    def test_questions_have_bilingual_text_and_consistent_matrix_dimensions(self):
        questions = self.data["questions"]
        self.assertEqual(len(questions), len({q["id"] for q in questions}))
        for q in questions:
            self.assertTrue(q["ko"] and q["en"])
            self.assertEqual(len(q["values"]), len(self.data["pokemon"]))
            self.assertTrue(set(q["values"]) <= {"0", "1", "?"})
            self.assertIn("0", q["values"])
            self.assertIn("1", q["values"])

    def test_appearance_is_unknown_for_mega_and_regional_forms(self):
        for q in self.data["questions"]:
            if q["group"] == "appearance":
                for p, value in zip(self.data["pokemon"], q["values"]):
                    if p["kind"] != "base":
                        self.assertEqual(value, "?", p["key"])


if __name__ == "__main__":
    unittest.main()
