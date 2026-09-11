import { isPlayableForm } from "./form-policy.js";
import { englishName } from "./pokemon-names.js";

// Cosmetic forms of these battle records share one Pokemantle entry. Use
// pokemonId (not speciesId) so Floette's Eternal Flower, Mega Pyroar and
// Gigantamax Alcremie remain distinct. Other games keep the original catalog.
const cosmeticPokemon = new Map([
  [201, "unown"],
  [412, "burmy"],
  [414, "mothim"],
  [422, "shellos"],
  [423, "gastrodon"],
  [585, "deerling"],
  [586, "sawsbuck"],
  [592, "frillish"],
  [593, "jellicent"],
  [664, "scatterbug"],
  [665, "spewpa"],
  [666, "vivillon"],
  [668, "pyroar"],
  [669, "flabebe"],
  [670, "floette"],
  [671, "florges"],
  [676, "furfrou"],
  [716, "xerneas"],
  [854, "sinistea"],
  [855, "polteageist"],
  [869, "alcremie"],
  [1012, "poltchageist"],
  [1013, "sinistcha"],
]);

// Some cosmetic differences have separate battle record IDs in the source.
// Explicit groups avoid merging same-type forms with different battle traits.
const cosmeticVarieties = [
  [
    /^minior-(red|orange|yellow|green|blue|indigo|violet)-meteor$/,
    "minior", "유성의 모습", "Meteor Form",
  ],
  [
    /^minior-(red|orange|yellow|green|blue|indigo|violet)$/,
    "minior", "코어의 모습", "Core Form",
  ],
  [/^magearna(?:-original)?$/, "magearna"],
  [/^magearna(?:-original)?-mega$/, "magearna", "메가", "Mega"],
  [/^maushold-family-of-(three|four)$/, "maushold"],
  [/^dudunsparce-(two|three)-segment$/, "dudunsparce"],
  [/^koraidon-(apex|limited|sprinting|swimming|gliding)-build$/, "koraidon"],
  [/^miraidon-(ultimate|low-power|drive|aquatic|glide)-mode$/, "miraidon"],
];

function cosmeticGroup(pokemon) {
  const base = cosmeticPokemon.get(pokemon.pokemonId);
  if (base) return [base];
  return cosmeticVarieties
    .find(([pattern]) => pattern.test(pokemon.key))
    ?.slice(1);
}

const catalogs = new WeakMap();

export function pokemantleForms(rawPokemon) {
  if (catalogs.has(rawPokemon)) return catalogs.get(rawPokemon);
  const groups = new Map();
  for (const p of rawPokemon.filter(isPlayableForm)) {
    const group = cosmeticGroup(p);
    const key = group ? `${p.speciesId}:${group.join(":")}` : `form:${p.id}`;
    if (!groups.has(key)) groups.set(key, { group, members: [] });
    groups.get(key).members.push(p);
  }

  const pokemon = [],
    canonicalIdById = new Map();
  for (const { group, members } of groups.values()) {
    const representative = members.reduce((a, b) => (a.id < b.id ? a : b));
    for (const p of members) canonicalIdById.set(p.id, representative.id);
    if (!group) {
      pokemon.push(representative);
      continue;
    }
    const [baseKey, form = "", englishForm = ""] = group;
    const baseEnglish = englishName({ key: baseKey });
    const displayEnglish = englishForm
      ? `${baseEnglish} (${englishForm})`
      : baseEnglish;
    pokemon.push({
      ...representative,
      name: form ? `${representative.baseName} (${form})` : representative.baseName,
      form,
      english: displayEnglish,
      // Keep every old name and ID searchable, but always return one entry.
      // The first alias also supplies the merged English display name.
      aliases: [
        ...new Set([
          displayEnglish,
          ...members.flatMap((p) => [
            p.name, p.english, englishName(p), p.key, String(p.id),
            ...(p.aliases || []),
          ]),
        ]),
      ],
    });
  }
  const catalog = { pokemon, canonicalIdById };
  catalogs.set(rawPokemon, catalog);
  return catalog;
}
