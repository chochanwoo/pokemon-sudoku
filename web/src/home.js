import { createIcons, Gamepad2, ArrowRight } from "lucide";
import { games } from "./games.js";
import "./style.css";
import "./home.css";

// Links shared before the game hub existed still open the same puzzle.
if (new URLSearchParams(location.search).has("seed")) {
  location.replace(`./sudoku.html${location.search}${location.hash}`);
} else {
  document.querySelector("#app").innerHTML = `
    <header class="site-header"><div class="header-inner">
      <a class="brand" href="./" aria-label="포켓몬 게임 메인"><span class="brand-mark"><i data-lucide="gamepad-2" aria-hidden="true"></i></span><span>포켓몬 게임<span class="brand-caption">POKÉMON GAMES</span></span></a>
      <span class="hub-header-label">비공식 팬 게임</span>
    </div></header>
    <main class="main hub-main">
      <section aria-labelledby="games-title">
        <div class="hub-heading"><h1 id="games-title">전체 게임</h1><span>${games.length}개 게임</span></div>
        <div class="game-library">${games
          .map(
            (game) => `
          <a class="game-card" href="${game.href}" aria-labelledby="${game.id}-title ${game.id}-play">
            <div class="game-cover"><img src="${game.image}" alt="${game.imageAlt}" width="540" height="620" /></div>
            <div class="game-card-content">
              <span class="game-category">${game.category}</span>
              <h2 id="${game.id}-title">${game.title}</h2>
              <p class="game-formats">${game.formats}</p>
              <span class="game-launch"><span id="${game.id}-play">플레이</span><i data-lucide="arrow-right" aria-hidden="true"></i></span>
            </div>
          </a>`,
          )
          .join("")}</div>
      </section>
      <footer class="footer hub-footer"><span>포켓몬 게임 <span class="footer-dot">·</span> 비공식 팬 게임</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">데이터 · PokéAPI <i data-lucide="arrow-right" aria-hidden="true"></i></a></footer>
    </main>`;
  createIcons({
    icons: { Gamepad2, ArrowRight },
    attrs: { "stroke-width": 1.8 },
  });
}
