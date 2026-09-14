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

    def test_debut_questions_use_actual_games_not_generation_cutoffs(self):
        questions = [q for q in self.data["questions"] if q["group"] == "generation"]
        by_key = {p["key"]: i for i, p in enumerate(self.data["pokemon"])}
        by_id = {q["id"]: q for q in questions}
        for p in self.data["pokemon"]:
            self.assertEqual(sum(q["values"][by_key[p["key"]]] == "1" for q in questions), 1, p["key"])
        for pokemon, game in [("piplup", "diamond-pearl"), ("mothim", "diamond-pearl"),
                              ("charizard-mega-x", "red-green-japan"), ("growlithe-hisui", "legends-arceus"),
                              ("vulpix-alola", "sun-moon"), ("zeraora", "ultra-sun-ultra-moon"),
                              ("meltan", "lets-go-pikachu-lets-go-eevee"), ("ogerpon", "scarlet-violet")]:
            self.assertEqual(by_id[f"debut-{game}"]["values"][by_key[pokemon]], "1", pokemon)
        for q in questions:
            self.assertIn("최초로 등장했나요?", q["ko"])
            self.assertNotIn("세대", q["ko"])
            self.assertIn("first appear", q["en"])
            self.assertTrue(q["note"]["ko"] and q["note"]["en"])

    def test_evolution_copy_and_expert_question_policy(self):
        by_id = {q["id"]: q for q in self.data["questions"]}
        self.assertEqual(by_id["evolved"]["ko"], "진화체인가요?")
        for q in self.data["questions"]:
            self.assertEqual(q["expert"], q["group"] in {"size", "eggs"})
            if q["expert"]:
                self.assertGreaterEqual(q["after"], 16)

    def test_recognizable_families_include_evolutions_and_forms(self):
        by_key = {p["key"]: i for i, p in enumerate(self.data["pokemon"])}
        by_id = {q["id"]: q for q in self.data["questions"]}
        for question, positive, negative in [
            ("starter-family", ["bulbasaur", "pichu", "eevee", "raichu-alola", "typhlosion-hisui", "charizard-mega-x", "skeledirge"], ["mew", "mr-mime", "pidgey"]),
            ("fossil-family", ["omanyte", "kabutops", "aerodactyl-mega", "cradily", "archeops", "tyrantrum", "dracovish", "arctozolt"], ["relicanth", "mew", "genesect"]),
            ("standalone", ["mew", "aerodactyl-mega", "ditto"], ["pikachu", "mr-mime", "charizard-mega-x"]),
        ]:
            q = by_id[question]
            for keys, expected in [(positive, "1"), (negative, "0")]:
                for key in keys:
                    self.assertEqual(q["values"][by_key[key]], expected, f"{question}: {key}")
            self.assertTrue(q["note"]["ko"] and q["note"]["en"])
        self.assertIn("dd9a765f728dfe67", self.data["compatibleDataVersions"])

    def test_past_typings_come_from_each_pokemon_not_its_original_form(self):
        by_key = {p["key"]: i for i, p in enumerate(self.data["pokemon"])}
        by_id = {q["id"]: q for q in self.data["questions"]}
        for key, question, modern, old in [
            ("mr-mime", "dual-type", "1", "0"), ("mr-mime", "type-14", "1", "1"),
            ("clefairy", "type-1", "0", "1"), ("clefairy", "type-18", "1", "0"),
            ("gardevoir", "dual-type", "1", "0"), ("magnemite", "type-9", "1", "0"),
            ("mr-mime-galar", "type-15", "1", "1"), ("vulpix-alola", "type-10", "0", "0"),
            ("gardevoir-mega", "type-18", "1", "1"),
        ]:
            q, i = by_id[question], by_key[key]
            self.assertEqual(q["values"][i], modern, key)
            self.assertEqual(q["pastValues"][i], old, key)
        for q in self.data["questions"]:
            if q["group"] == "type":
                self.assertEqual(len(q["pastValues"]), len(self.data["pokemon"]))
                self.assertTrue(set(q["pastValues"]) <= {"0", "1"})
            else:
                self.assertNotIn("pastValues", q)


if __name__ == "__main__":
    unittest.main()
