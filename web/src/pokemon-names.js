const specialNames = {
  "nidoran-f": "Nidoran♀",
  "nidoran-m": "Nidoran♂",
  "mr-mime": "Mr. Mime",
  "mime-jr": "Mime Jr.",
  "mr-rime": "Mr. Rime",
  "type-null": "Type: Null",
  farfetchd: "Farfetch'd",
  sirfetchd: "Sirfetch'd",
  flabebe: "Flabébé",
  "ho-oh": "Ho-Oh",
  "porygon-z": "Porygon-Z",
  "jangmo-o": "Jangmo-o",
  "hakamo-o": "Hakamo-o",
  "kommo-o": "Kommo-o",
  "wo-chien": "Wo-Chien",
  "chien-pao": "Chien-Pao",
  "ting-lu": "Ting-Lu",
  "chi-yu": "Chi-Yu",
  "zygarde-10": "10% Zygarde (Aura Break)",
  "zygarde-50": "50% Zygarde (Aura Break)",
  "zygarde-10-power-construct": "10% Zygarde (Power Construct)",
  "zygarde-50-power-construct": "50% Zygarde (Power Construct)",
  "meowstic-male-mega": "Mega Meowstic (Male)",
  "meowstic-female-mega": "Mega Meowstic (Female)",
};

export function englishName(pokemon) {
  if (specialNames[pokemon.key]) return specialNames[pokemon.key];
  // Form aliases retain the source's spelling, punctuation and form distinctions.
  const alias = pokemon.aliases?.find(
    (name) => /[A-Z]/.test(name) && !/[가-힣ㄱ-ㅎ]/.test(name),
  );
  if (alias) return alias;
  return (pokemon.english || pokemon.key).replace(
    /(^|[ -])([a-z])/g,
    (_, space, letter) => space + letter.toUpperCase(),
  );
}
