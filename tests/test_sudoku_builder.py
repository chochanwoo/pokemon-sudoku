"""Focused tests for species-capacity constraints in the Sudoku generator."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_type_sudoku import cp_model, model_for, solve, include_special_forms


class FormCatalogTests(unittest.TestCase):
    def form(self, identifier, key, types):
        return dict(id=identifier, speciesId=6, key=key, types=types, name=key,
                    english=key, baseName="Charizard", form="Mega", aliases=[key], image="sprite")

    def test_only_dual_type_mega_and_regional_forms_are_added(self):
        base = [dict(id=6, key="charizard", types=[3, 10])]
        source = {"images": {"sprite": "data:image/png;base64,example"}, "pokemon": [
            self.form(10001, "charizard-mega-x", [10, 16]),
            self.form(10002, "raichu-alola", [13, 14]),
            self.form(10003, "vulpix-alola", [15]),
            self.form(10004, "charizard-gmax", [3, 10]),
            self.form(10005, "arceus-unknown", [10001]),
        ]}
        result = include_special_forms(base, source)
        self.assertEqual([p["id"] for p in result], [6, 10001, 10002])
        self.assertEqual(len(base), 1)
        self.assertTrue(result[1]["isAlternate"])
        self.assertTrue(result[1]["image"].startswith("data:image/png"))
        self.assertEqual(result[1]["speciesId"], 6)

    def test_missing_sprites_and_duplicate_ids_are_not_silently_accepted(self):
        form = self.form(6, "charizard-mega-x", [10, 16])
        source = {"images": {"sprite": "data:image/png;base64,example"}, "pokemon": [form]}
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            include_special_forms([dict(id=6)], source)
        source["images"] = {}
        with self.assertRaisesRegex(ValueError, "Missing"):
            include_special_forms([], source)


class CapacityTests(unittest.TestCase):
    pairs = [(1, 2), (3, 4)]
    solution = [[1, 2], [3, 4], [3, 4], [1, 2]]

    def run_model(self, capacities, **kwargs):
        model, cells = model_for(2, 1, 2, [1, 2, 3, 4], self.pairs,
                                 capacities=capacities, **kwargs)
        return solve(model, cells, 1, 5)

    def test_insufficient_species_rejects_otherwise_valid_type_grid(self):
        status, _ = self.run_model({(1, 2): 1, (3, 4): 2})
        self.assertEqual(status, cp_model.INFEASIBLE)

    def test_exact_capacity_allows_distinct_assignment(self):
        status, result = self.run_model({(1, 2): 2, (3, 4): 2},
                                        clues={0: [1, 2]})
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertEqual(result, self.solution)

    def test_missing_pair_capacity_is_zero(self):
        status, _ = self.run_model({(1, 2): 2})
        self.assertEqual(status, cp_model.INFEASIBLE)

    def test_uniqueness_is_for_type_layout_not_representative_choice(self):
        status, _ = self.run_model({(1, 2): 20, (3, 4): 20},
                                   clues={0: [1, 2]}, excluded=self.solution)
        self.assertEqual(status, cp_model.INFEASIBLE)


if __name__ == "__main__":
    unittest.main()
