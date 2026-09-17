import { readFileSync, writeFileSync } from "node:fs";

// Reuse the catalog's original PNG bytes; do not redraw or modify the sprites.
const catalog = JSON.parse(
  readFileSync(new URL("../web/public/pokemantle.json", import.meta.url)),
);
for (const [key, file] of [
  ["raichu-alola", "alola-raichu.png"],
  ["rowlet", "alola-rowlet.png"],
]) {
  const pokemon = catalog.pokemon.find((p) => p.key === key);
  const source = pokemon && catalog.images[pokemon.image];
  if (!source?.startsWith("data:image/png;base64,"))
    throw new Error(`Missing sprite: ${key}`);
  writeFileSync(
    new URL(`../web/src/assets/${file}`, import.meta.url),
    Buffer.from(source.split(",")[1], "base64"),
  );
  console.log(`${key}: ${file}`);
}
