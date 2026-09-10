"""Focused tests for species-capacity constraints in the Sudoku generator."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_type_sudoku import cp_model, model_for, solve


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
