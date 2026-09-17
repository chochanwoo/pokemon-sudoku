# Alola Activity Covers

Generated with the built-in image generation tool on 2026-09-17.
No CLI/API fallback was used. The first character-inclusive attempt was blocked;
the final generated assets are character-free resort backgrounds.

## Assets

- Final backgrounds: `web/src/assets/home-art/{pokemantle,scratch,pokeclue,highlow,typedoku,pokinator}.webp`.
- Backgrounds are 800 pixels wide, WebP quality 0.78.
- Character images in the same folder are 384 x 384, WebP quality 0.86.
- Characters are separate HTML images over backgrounds, not AI redraws.
- The scratch reveal uses a CSS clip; the puzzle uses existing type icons and a valid 4 x 4 arrangement.
- Composition: `web/src/home-art.js` and `web/src/home.css`.
- All assets are local at runtime. No daily answers or game catalogs are loaded by the homepage.
- Both languages share the same text-free scenes, with translated accessible descriptions.
- The earlier screenshot source files are retained for comparison; they are no longer bundled by the homepage.

## Character Sources

[Pokemon artwork directory](https://github.com/PokeAPI/sprites/tree/master/sprites/pokemon/other/official-artwork)

PNG source URL pattern:
`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{id}.png`

| ID | File |
| --- | --- |
| 25 | pikachu.webp |
| 64 | kadabra.webp |
| 133 | eevee.webp |
| 134 | vaporeon.webp |
| 135 | jolteon.webp |
| 722 | rowlet.webp |
| 727 | incineroar.webp |
| 745 | lycanroc.webp |

Artwork rights remain with Nintendo, Creatures and GAME FREAK.
Type icons retain the MIT attribution in `web/public/NOTICE.txt`.

## Re-encoding

Keep downloaded character PNGs in `.preview/cover-artwork/{id}.png`.
Run `node scripts/prepare_home_art.mjs` with the six generated background PNG
paths in this order: pokemantle, scratch, pokeclue, highlow, typedoku, pokinator.
This performs only resizing and WebP encoding, not generative or pixel editing.
Normal application builds use the checked-in WebP assets without network access.

## Shared Prompt

Use case: stylized-concept.
Asset type: one landscape background illustration for an interactive game thumbnail, aspect ratio 16:9.
Art direction: a cohesive tropical seaside resort activity collection. Refined hand-painted animation concept art, precise delicate linework, matte gouache color fields and crisp soft shadows, polished and quietly playful, not a UI mockup, not photorealistic, not chunky 3D. Clear daylight from upper left and subtle palm-leaf shadows. Airy pale aqua and white surroundings, with one secondary accent. Simple bold shapes readable at 320px wide. Elevated three-quarter viewpoint, close still-life composition. Keep important objects within the middle 85% of width and 80% of height. No characters or animals; these will be placed by the website separately. No text, letters, numerals, logos, watermarks, borders, bokeh, sparkle particles, human hands, or UI. One complete edge-to-edge landscape image, no collage.

## Individual Prompts

### scratch

SCRATCH-REVEAL ACTIVITY: a large plain pale aqua drawing surface sits nearly face-on, filling the middle of a clean white seaside table. The surface is a blank flat field, ready for a separate graphic to be placed on it later by a website; do not draw any image on the board. A small coral-pink eraser and a short yellow pencil rest near the lower right edge, tiny eraser shavings nearby. Only the upper-left corner has a cropped tropical leaf, with the lightest palm shadow across the table, not across the middle of the drawing surface. Color palette white, seafoam, aqua, coral pink. Large simple still-life objects, with center 55% of picture calm and empty.

### pokemantle

SIMILARITY-DETECTIVE ACTIVITY: a close, slightly elevated view of a lavender-blue linen resort desk with three large blank square photographic prints gently overlapping in a shallow fan across the center. Their white borders surround completely EMPTY PALE backgrounds, left photo mint, center photo white, right photo light periwinkle. The centers of these photos will receive character images later from the website. Leave them unmarked and large. A slim coral-orange handheld scanner with a blank dark teal screen sits near the lower right edge. Only two small additional details: a fresh green tropical leaf along upper left, a narrow glimpse of the turquoise shoreline at the far top edge. Pale lilac, white and coral contrasts; daylight shadows. Keep the photos almost front-facing, in the central 65% of the picture; no strings, no question marks, no graphs, no text.

### pokeclue

CLUE-DETECTIVE ACTIVITY: an open field-research notebook lying across a clean pale blue resort desk, filling the frame. The left page is nearly front-facing, completely blank with generous white space for a character to be placed by the website later. The right page is blank white with three tiny empty pale sage tab stickers near its far right margin; leave space on that page for clue symbols placed later by the website. A single simple magnifying glass with a sage-green handle lies beside the notebook at the lower right; clear lens, no image inside. One small coral pencil along the lower left and a cropped tropical leaf in the top-left corner. A narrow turquoise sea glimpse at the top edge, cool sky blue, white, sage and coral. No writing, no lines of fake text, no characters, no graphs. Large readable simple shapes.

### highlow

HIGHER-OR-LOWER ACTIVITY: a small outdoor comparison podium on a sunlit tropical resort terrace. Exactly two broad empty square pedestals stand side by side in the center, LEFT pedestal pale coral pink and visibly higher, RIGHT pedestal pale mint and visibly lower. Their flat tops are LARGE and completely empty, intended for character graphics placed later by the website. The left top surface is around 58% down the frame; the right around 70% down, with plenty of clear empty pale sky above both. A slim turquoise sea horizon and a far green island across the upper third. White tiled floor and two subtle palm leaf shadows. Very minimal, clean, close view, pastel coral is the leading color balanced with aqua and green, NOT beige. No third pedestal, no numbers, no medals, no arrows, no text, no characters, no scale.

### typedoku

TILE PUZZLE ACTIVITY: near top-down close view of a pale sage-green linen mat on a white tropical resort game table. Center 60% of frame is empty uninterrupted sage fabric, intended to receive a separate square puzzle board from a website; DO NOT draw the central board or a grid. At the far lower-left edge are three small plain ceramic square tiles stacked loosely, coral, pale yellow and mint; at the far right edge one white tile and a plain green pencil. A tropical leaf cropped into top-left edge. A very narrow sliver of azure sea at top edge. Quiet minimal still life, sage green leading color with coral and buttery yellow details, bright clean sunlight, crisp delicate painted shadows. No symbols, no writing, no numbers, no characters. Avoid a brown wooden table or beige palette.

### pokinator

MIND-READING ACTIVITY: an airy outdoor fortune-teller's lounge at a tropical seaside resort in daylight. One broad empty circular muted-teal cushion centered on a white built-in bench, facing the viewer. The cushion top sits in the lower quarter of the picture; leave the large central middle area above it uncluttered for a character image to be placed by a website later. A shallow tray with a single silver spoon rests at the far lower left. At far right a folded pale coral patterned cloth. Two lush palm leaves frame only the outer upper corners, distant turquoise sea and an emerald island at the top. A sheer white canopy edge at the very top. Calm curious whimsical atmosphere, teal green, white, soft coral, a tiny ochre accent. No crystal ball, no luminous orb, no magic particles, no text, no characters, no furniture filling the center.
