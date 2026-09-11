import { createIcons, Gamepad2, ArrowRight, Languages } from "lucide";
import { games } from "./games.js";
import { siteBrand, languagePicker } from "./site-brand.js";
import { t, initLanguage, getLanguage } from "./i18n.js";
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
      <div class="header-actions"><span class="hub-header-label">${t("비공식 팬 게임")}</span>${languagePicker()}</div>
    </div></header>
    <main class="main hub-main">
      <section aria-labelledby="games-title">
        <div class="hub-heading"><h1 id="games-title">${t("전체 게임")}</h1><span>${t("{count}개 게임", { count: games.length })}</span></div>
        <div class="game-library">${games
          .map(
            (game) => `
          <a class="game-card" href="${game.href}" aria-labelledby="${game.id}-title ${game.id}-play">
            <div class="game-cover"><img src="${getLanguage() === "en" ? game.imageEn : game.image}" alt="${t(game.imageAlt)}" width="540" height="620" /></div>
            <div class="game-card-content">
              <span class="game-category">${t(game.category)}</span>
              <h2 id="${game.id}-title">${t(game.title)}</h2>
              <p class="game-formats">${t(game.formats)}</p>
              <span class="game-launch"><span id="${game.id}-play">${t("플레이")}</span><i data-lucide="arrow-right" aria-hidden="true"></i></span>
            </div>
          </a>`,
          )
          .join("")}</div>
      </section>
      <footer class="footer hub-footer"><span>${t("포켓몬 퀴즈")} <span class="footer-dot">·</span> ${t("비공식 팬 게임")}</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">${t("데이터 · PokéAPI")} <i data-lucide="arrow-right" aria-hidden="true"></i></a></footer>
    </main>`;
  createIcons({
    icons: { Gamepad2, ArrowRight, Languages },
    attrs: { "stroke-width": 1.8 },
  });
}
