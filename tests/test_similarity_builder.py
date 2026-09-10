"""Focused checks for the offline feature comparison math."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("builder", Path(__file__).resolve().parents[1] / "scripts/build_pokemantle.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class SimilarityBuilderTests(unittest.TestCase):
    def test_requested_weights_are_exact(self):
        self.assertEqual(builder.WEIGHTS, {"types": 25, "evolution": 20, "classification": 15,
            "motifs": 10, "stats": 10, "moves": 7, "description": 5, "abilities": 5,
            "eggGroups": 2, "body": 1})
        self.assertEqual(sum(builder.WEIGHTS.values()), 100)

    def test_partial_type_match_is_useful_and_type_order_is_irrelevant(self):
        score, valid = builder.type_matrix([{14, 16}, {16, 14}, {9, 14}, {14}, {10}])
        self.assertAlmostEqual(float(score[0, 1]), 1)
        self.assertAlmostEqual(float(score[0, 2]), .6)
        self.assertAlmostEqual(float(score[0, 3]), .6)
        self.assertEqual(float(score[0, 4]), 0)
        self.assertTrue(valid.all())

    def test_legendary_hierarchy_does_not_reward_ordinary_status(self):
        score, valid = builder.classification_matrix([
            "major-legendary", "major-legendary", "legendary", "mythical", "ordinary", "ordinary"])
        self.assertEqual(float(score[0, 1]), 1)
        self.assertAlmostEqual(float(score[0, 2]), .65)
        self.assertAlmostEqual(float(score[0, 3]), .35)
        self.assertEqual(float(score[0, 4]), 0)
        self.assertTrue(valid[0, 4])
        self.assertFalse(valid[4, 5])
        self.assertEqual(float(score[4, 5]), 0)
        self.assertEqual(builder.classification_for({"key": "necrozma", "is_legendary": 1, "is_mythical": 0}), "major-legendary")
        self.assertEqual(builder.classification_for({"key": "latios", "is_legendary": 1, "is_mythical": 0}), "legendary")
        self.assertEqual(builder.classification_for({"key": "mew", "is_legendary": 0, "is_mythical": 1}), "mythical")

    def test_motifs_use_whole_words_and_do_not_confuse_weight_with_light(self):
        self.assertEqual(builder.motif_tags("A lightweight body, so light it floats."), set())
        self.assertEqual(builder.motif_tags("It absorbs light energy and fires laser beams."), {"radiance"})
        self.assertEqual(builder.motif_tags("Snow and ice freeze its prey."), {"frost"})
        self.assertEqual(builder.motif_tags("It was created by genetic manipulation."), {"artificial", "genetics"})
        self.assertEqual(builder.motif_tags(""), set())

    def test_stats_compare_power_and_role_independently(self):
        score = builder.stat_matrix([[100, 150, 100, 150, 100, 150], [80, 120, 80, 120, 80, 120],
                                     [150, 100, 150, 100, 150, 100], [50, 50, 50, 50, 50, 50]])
        self.assertAlmostEqual(float(score[0, 0]), 1)
        self.assertGreater(float(score[0, 1]), float(score[0, 3]))
        self.assertLess(float(score[0, 2]), 1)
        self.assertTrue(builder.np.allclose(score, score.T))

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
