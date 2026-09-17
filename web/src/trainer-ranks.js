export const GUESS_RANKS = [
  { rank: "S", max: 5, label: "레드급", sprite: "red" },
  { rank: "A", max: 10, label: "난천급", sprite: "cynthia-gen4" },
  { rank: "B", max: 20, label: "전진급", sprite: "volkner" },
  { rank: "C", max: 30, label: "버틀러급", sprite: "acetrainer-gen4dp" },
  { rank: "D", max: 40, label: "모미급", sprite: "cheryl" },
  { rank: "E", max: Infinity, label: "오성급", sprite: "youngster-gen4" },
];

export const CLUE_GUESS_RANKS = GUESS_RANKS.map((tier, index) => ({
  ...tier,
  max: [3, 5, 8, 11, 15, Infinity][index],
}));

export function rankFor(attempts, ranks = GUESS_RANKS) {
  if (!Number.isInteger(attempts) || attempts < 1) return null;
  return ranks.find((tier) => attempts <= tier.max).rank;
}

export const HIGHLOW_STREAK_RANKS = GUESS_RANKS.map(
  ({ max, ...trainer }, index) => ({
    ...trainer,
    min: [20, 15, 10, 6, 3, 0][index],
  }),
);

export function streakRankFor(streak) {
  if (!Number.isInteger(streak) || streak < 0) return null;
  return HIGHLOW_STREAK_RANKS.find((tier) => streak >= tier.min).rank;
}
