import eevee from "./assets/home-art/eevee.webp";
import vaporeon from "./assets/home-art/vaporeon.webp";
import jolteon from "./assets/home-art/jolteon.webp";
import pikachu from "./assets/home-art/pikachu.webp";
import rowlet from "./assets/home-art/rowlet.webp";
import incineroar from "./assets/home-art/incineroar.webp";
import lycanroc from "./assets/home-art/lycanroc.webp";
import kadabra from "./assets/home-art/kadabra.webp";
import grass from "./assets/types/grass.svg";
import fire from "./assets/types/fire.svg";
import water from "./assets/types/water.svg";
import electric from "./assets/types/electric.svg";
import flying from "./assets/types/flying.svg";

const character = (src, name) =>
  `<img class="cover-character cover-${name}" src="${src}" alt="" width="384" height="384" draggable="false" />`;
const type = (src) => `<img src="${src}" alt="" width="32" height="32" draggable="false" />`;

// These static scenes never load game data or depend on today's answers.
const scenes = {
  pokemantle: character(vaporeon, "vaporeon") + character(eevee, "eevee") + character(jolteon, "jolteon"),
  scratch: `<span class="cover-reveal">${character(pikachu, "pikachu")}</span>`,
  pokeclue: character(rowlet, "rowlet") + `<span class="cover-clues">
    <span>${type(grass)}${type(flying)}<i data-lucide="check"></i></span>
    <span><i data-lucide="egg"></i><i data-lucide="check"></i></span>
    <span><i data-lucide="arrow-right"></i><i data-lucide="check"></i></span>
  </span>`,
  highlow: character(incineroar, "incineroar") + character(lycanroc, "lycanroc"),
  typedoku: `<span class="cover-puzzle">${[
    grass, fire, water, electric,
    water, electric, grass, fire,
    fire, grass, electric, water,
    electric, water, fire, grass,
  ].map((src, i) => `<span class="cover-tile${[3, 6, 12].includes(i) ? " is-empty" : ""}">${type(src)}</span>`).join("")}</span>`,
  pokinator: character(kadabra, "kadabra"),
};

export function homeArt(id) {
  return scenes[id] || "";
}
