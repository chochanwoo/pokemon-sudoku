import json
from copy import deepcopy
import unittest
from scripts.build_pokinator import build, candidate_kind, PUBLIC
from scripts.pokinator_knowledge import compile_knowledge


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
        self.assertEqual(by_id["third-stage"]["ko"], "진화 계열의 세 번째 단계인가요?")
        self.assertEqual(by_id["third-stage"]["en"], "Is it the third stage of its evolution line?")
        by_key = {p["key"]: i for i, p in enumerate(self.data["pokemon"])}
        self.assertEqual(by_id["third-stage"]["values"][by_key["raichu"]], "1")
        self.assertEqual(by_id["third-stage"]["values"][by_key["pikachu"]], "0")
        self.assertIn("89201605a43b72b1", self.data["compatibleDataVersions"])
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

    def test_scoped_knowledge_inherits_species_but_never_the_evolution_family(self):
        rows = self.data["pokemon"]
        by_key = {p["key"]: i for i, p in enumerate(rows)}
        by_id = {q["id"]: q for q in self.data["questions"]}
        for question, positive, negative, unknown in [
            ("lore-movie-lead", ["lucario", "lucario-mega", "zoroark-hisui"], ["riolu"], ["ditto"]),
            ("lore-ash-team", ["pikachu", "mr-mime-galar"], ["pichu", "raichu"], ["haunter"]),
            ("lore-misty-team", ["horsea", "gyarados-mega"], ["kingdra"], []),
            ("lore-cynthia-team", ["garchomp", "garchomp-mega"], ["gible", "gabite"], []),
            ("lore-companion-team", ["psyduck", "sylveon"], ["mewtwo"], ["rhyhorn"]),
            ("lore-trainer-ace", ["miltank", "garchomp", "electabuzz"], ["electrode"], []),
            ("lore-smash-fighter", ["mewtwo", "ivysaur"], ["mew", "venusaur"], []),
            ("lore-dungeon-partner", ["riolu", "munchlax"], ["lucario", "snorlax"], []),
        ]:
            for keys, expected in [(positive, "1"), (negative, "0"), (unknown, "?")]:
                for key in keys:
                    self.assertEqual(by_id[question]["values"][by_key[key]], expected, f"{question}: {key}")
        contextual = [q for q in by_id.values() if q.get("contextual")]
        self.assertEqual(len([q for q in contextual if not q["retired"]]), 51)
        self.assertEqual(len([q for q in contextual if q["retired"]]), 7)
        for q in contextual:
            self.assertTrue(q["sources"])
            self.assertTrue(q["note"]["ko"] and q["note"]["en"])
            self.assertIn("원본 종", q["note"]["ko"])
            self.assertFalse(q["expert"])
        self.assertIn("lore-companion-team", by_id["lore-misty-team"]["parents"])
        self.assertIn("4934f47e1cf1f700", self.data["compatibleDataVersions"])
        self.assertIn("3ab0d55d49a841dc", self.data["compatibleDataVersions"])

    def test_new_generations_and_broader_stories_have_correct_scopes(self):
        rows = self.data["pokemon"]
        by_key = {p["key"]: i for i, p in enumerate(rows)}
        by_id = {q["id"]: q for q in self.data["questions"]}
        for question, positive, negative in [
            ("lore-artificial", ["porygon", "porygon2", "porygon-z", "type-null", "silvally", "golurk"], ["pikachu"]),
            ("lore-disguise", ["ditto", "mew", "mimikyu", "zoroark-hisui"], ["pikachu"]),
            ("lore-human-parent", ["kangaskhan", "zarude", "entei"], ["gible"]),
            ("lore-hoenn-ace", ["nosepass", "milotic", "lunatone", "solrock"], ["skarmory"]),
            ("lore-unova-ace", ["lillipup", "haxorus", "jellicent"], ["patrat"]),
            ("lore-kalos-ace", ["tyrunt", "amaura", "hawlucha"], ["machoke"]),
            ("lore-galar-ace", ["gengar", "machamp", "lapras", "coalossal", "duraludon"], ["arrokuda"]),
            ("lore-paldea-ace", ["mismagius", "altaria", "teddiursa"], ["bellibolt", "cetitan"]),
            ("lore-league-ace-world", ["metagross", "milotic", "volcarona", "gardevoir", "charizard", "glimmora", "crabominable"], ["incineroar"]),
            ("lore-alola-league-ace", ["incineroar", "primarina", "decidueye", "palossand"], ["hariyama"]),
            ("lore-steven-team", ["metagross", "armaldo"], ["beldum"]),
            ("lore-leon-team", ["charizard", "rillaboom", "cinderace", "inteleon", "mr-rime"], ["eternatus"]),
            ("lore-larry-team", ["komala", "staraptor", "flamigo"], ["clodsire"]),
        ]:
            for keys, expected in [(positive, "1"), (negative, "0")]:
                for key in keys:
                    self.assertEqual(by_id[question]["values"][by_key[key]], expected, f"{question}: {key}")
        self.assertEqual(by_id["lore-artificial"]["values"][by_key["baltoy"]], "?")
        for old, new, key in [("lore-movie-artificial", "lore-artificial", "porygon"),
                              ("lore-gym-ace", "lore-gym-ace-world", "duraludon")]:
            self.assertTrue(by_id[old]["retired"])
            self.assertEqual(by_id[old]["values"][by_key[key]], "0")
            self.assertEqual(by_id[new]["values"][by_key[key]], "1")
        for q in by_id.values():
            if q.get("contextual") and not q["retired"]:
                self.assertIn(q["specificity"], {"broad", "focused", "signature"})
                self.assertNotIn("체육관의", q["ko"])
        self.assertEqual(by_id["lore-movie-lead"]["ko"], "극장판에서 주인공으로 나온 적이 있나요?")

    def test_knowledge_compiler_rejects_unreviewable_facts_and_invalid_implications(self):
        raw = json.loads((PUBLIC.parents[1] / "data/pokinator-knowledge.json").read_text(encoding="utf-8"))
        rows = self.data["pokemon"]
        species = {p["speciesId"]: p["key"] for p in rows if p["kind"] == "base"}
        for change in [
            lambda d: d["questions"][0]["yes"].append("not-a-species"),
            lambda d: d["questions"][0]["unknown"].append("mewtwo"),
            lambda d: d["questions"][0]["sources"].append("unreviewed"),
            lambda d: d["questions"][0].update(parents=["lore-movie-artificial"]),
            lambda d: d["questions"][0].update(parents=["missing"]),
            lambda d: d["questions"][0].update(parents=["lore-ash-team"]),
            lambda d: d["questions"][5].update(parents=["lore-ash-team"]),
            lambda d: d["questions"][0].update(scope="missing"),
            lambda d: d["questions"][0].update(specificity="random"),
            lambda d: d["questions"][0].update(retired="yes"),
            lambda d: d["questions"].append(d["questions"][0]),
            lambda d: d["questions"][8].update(includes=["lore-companion-team"]),
        ]:
            invalid = deepcopy(raw)
            change(invalid)
            with self.assertRaises(ValueError):
                compile_knowledge(invalid, rows, species)


if __name__ == "__main__":
    unittest.main()
