import {
  createIcons,
  TreePalm,
  ArrowRight,
  Languages,
  ChevronDown,
  Check,
} from "lucide";
import { games } from "./games.js";
import { siteBrand, languagePicker } from "./site-brand.js";
import { t, initLanguage, getLanguage } from "./i18n.js";
import raichu from "./assets/alola-raichu.png";
import rowlet from "./assets/alola-rowlet.png";
import resort from "./assets/alola-resort.webp";
import "./style.css";
import "./home.css";

// Links shared before the game hub existed still open the same puzzle.
initLanguage("포켓몬 퀴즈", renderHome);
if (new URLSearchParams(location.search).has("seed")) {
  location.replace(`./sudoku.html${location.search}${location.hash}`);
} else {
  renderHome();
}
function renderHome() {
  document.querySelector("#app").innerHTML = `
    <header class="site-header"><div class="header-inner">
      ${siteBrand()}
      <div class="header-actions">${languagePicker()}</div>
    </div></header>
    <main class="main hub-main">
      <div class="hub-intro">
        <img class="hub-scenery" src="${resort}" alt="" width="2172" height="724" fetchpriority="high" draggable="false" />
        <div class="hub-intro-inner"><div class="hub-welcome"><span class="hub-island-label">ALOLA ISLAND</span><h1>Alola<span>.</span></h1><p>${t("잠깐 쉬어가도 괜찮아.")}</p></div><div class="hub-residents"><img src="${raichu}" alt="${t("라이츄 (알로라)")}" width="96" height="96" draggable="false" /><img src="${rowlet}" alt="${t("나몰빼미")}" width="80" height="80" draggable="false" /></div></div>
      </div>
      <section class="hub-games" aria-labelledby="games-title">
        <div class="hub-heading"><h2 id="games-title">${t("전체 게임")}</h2></div>
        <div class="game-library">${games
          .map(
            (game) => `
          <a class="game-card" href="${game.href}" aria-labelledby="${game.id}-title ${game.id}-play">
            <div class="game-cover"><img src="${getLanguage() === "en" ? game.imageEn : game.image}" alt="${t(game.imageAlt)}" width="540" height="620" /></div>
            <div class="game-card-content">
              <span class="game-category">${t(game.category)}</span>
              <h2 id="${game.id}-title">${t(game.title)}</h2>
              <span class="game-launch"><span class="sr-only" id="${game.id}-play">${t("플레이")}</span><i data-lucide="arrow-right" aria-hidden="true"></i></span>
            </div>
          </a>`,
          )
          .join("")}</div>
      </section>
      <footer class="footer hub-footer"><span>${t("포켓몬 퀴즈")} <span class="footer-dot">·</span> ${t("비공식 팬 게임")}</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">${t("데이터 · PokéAPI")} <i data-lucide="arrow-right" aria-hidden="true"></i></a></footer>
    </main>`;
  createIcons({
    icons: { TreePalm, ArrowRight, Languages, ChevronDown, Check },
    attrs: { "stroke-width": 1.8 },
  });
}
