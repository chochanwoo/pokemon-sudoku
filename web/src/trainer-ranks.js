export const GUESS_RANKS = [
  { rank: "S", max: 5, label: "알로라 챔피언", sprite: "selene" },
  { rank: "A", max: 10, label: "하우", sprite: "hau" },
  { rank: "B", max: 20, label: "사천왕 아세로라", sprite: "acerola" },
  { rank: "C", max: 30, label: "엘리트 트레이너", sprite: "acetrainer-gen7" },
  { rank: "D", max: 40, label: "릴리에", sprite: "lillie" },
  { rank: "E", max: Infinity, label: "알로라 관광객", sprite: "tourist" },
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
