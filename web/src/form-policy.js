// Exact exceptions only: distribution-only species and ambiguous forms stay playable.
const excludedForms = new Set([
  "arceus-unknown",
  "pichu-spiky-eared",
  "pikachu-original-cap",
  "pikachu-hoenn-cap",
  "pikachu-sinnoh-cap",
  "pikachu-unova-cap",
  "pikachu-kalos-cap",
  "pikachu-alola-cap",
  "pikachu-partner-cap",
  "pikachu-world-cap",
  "pikachu-rock-star",
  "pikachu-belle",
  "pikachu-pop-star",
  "pikachu-phd",
  "pikachu-libre",
  "pikachu-cosplay",
  "zarude-dada",
  "vivillon-poke-ball",
  // Unobtainable pre-evolution records of the event-only pattern.
  "scatterbug-poke-ball",
  "spewpa-poke-ball",
]);

export function isPlayableForm(pokemon) {
  return !excludedForms.has(pokemon.key);
}
