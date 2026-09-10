"""Focused checks for the offline feature comparison math."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("builder", Path(__file__).resolve().parents[1] / "scripts/build_pokemantle.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class SimilarityBuilderTests(unittest.TestCase):
    def test_weighted_jaccard_rewards_distinctive_shared_moves(self):
        sets = [{1, 2}, {1}, {2}]
        reference = [{1}] * 20 + [{1, 2}]
        score, valid = builder.jaccard_matrix(sets, rarity=True, reference=reference)
        self.assertGreater(score[0, 2], score[0, 1])
        self.assertAlmostEqual(float(score[0, 0]), 1)
        self.assertTrue(valid.all())

    def test_missing_data_is_not_a_match_or_a_zero_weighted_penalty(self):
        score, valid = builder.jaccard_matrix([set(), {1}, {1, 2}])
        self.assertFalse(valid[0, 0])
        self.assertFalse(valid[0, 1])
        self.assertAlmostEqual(float(score[1, 2]), .5)

    def test_version_priority_does_not_use_database_id_order(self):
        self.assertLess(builder.VERSIONS.index("scarlet-violet"), builder.VERSIONS.index("sword-shield"))
        self.assertLess(builder.VERSIONS.index("sword-shield"), builder.VERSIONS.index("champions"))


if __name__ == "__main__":
    unittest.main()
