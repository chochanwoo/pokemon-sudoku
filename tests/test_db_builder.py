"""Language fallback regression checks for the master database."""

import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "db_builder", Path(__file__).resolve().parents[1] / "scripts/build_pokemon_db.py"
)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def name(language, value):
    return {"language": {"name": language}, "name": value}


class DatabaseNameTests(unittest.TestCase):
    def test_requested_language_wins_regardless_of_entry_order(self):
        names = [name("de", "Amigento"), name("en", "Silvally"), name("ko", "\uc2e4\ubc84\ub514")]
        self.assertEqual(builder.localized_name(names, "en"), "Silvally")
        self.assertEqual(builder.localized_name(names, "ko"), "\uc2e4\ubc84\ub514")
        self.assertEqual(builder.localized_name(list(reversed(names)), "en"), "Silvally")

    def test_only_explicit_fallback_language_is_allowed(self):
        names = [name("de", "Amigento"), name("en", "Silvally")]
        self.assertEqual(builder.localized_name(names, "ko"), "Silvally")
        self.assertEqual(builder.localized_name(names, "ko", fallback_lang="de"), "Amigento")
        for names in ([name("de", "Amigento")], [name("fr", "Motisma")], [], None):
            for language in ("en", "ko"):
                self.assertEqual(builder.localized_name(names, language, fallback="source-key"), "source-key")
                self.assertEqual(builder.localized_name(names, language), "")

    def test_empty_translation_uses_fallback_without_picking_another_language(self):
        names = [name("de", "Amigento"), name("ko", ""), name("en", "Silvally")]
        self.assertEqual(builder.localized_name(names, "ko"), "Silvally")
        self.assertEqual(builder.localized_name([name("en", None)], "en", fallback="silvally"), "silvally")

    def test_form_rows_do_not_store_german_names_as_english_or_korean(self):
        data = {endpoint: [] for endpoint in builder.LIST_ENDPOINTS}
        data["pokemon-form"] = [{
            "id": 10232,
            "name": "silvally-fighting",
            "form_name": "fighting",
            "names": [name("de", "Amigento (Kampf)")],
            "form_names": [name("de", "Typ:Kampf"), name("en", "Type: Fighting")],
        }]
        row = builder.build_rows(data, fetched_at="test")["pokemon_forms"][0]
        self.assertEqual(row["name_en"], "silvally-fighting")
        self.assertEqual(row["name_ko"], "silvally-fighting")
        self.assertEqual(row["form_name_en"], "Type: Fighting")
        self.assertEqual(row["form_name_ko"], "Type: Fighting")


if __name__ == "__main__":
    unittest.main()
