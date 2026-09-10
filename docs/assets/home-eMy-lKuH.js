import{s as t,c as i,A as s,G as r}from"./style-B4la26SQ.js";const o=""+new URL("typedoku-preview-B8yMirdL.png",import.meta.url).href,l=""+new URL("pokemantle-preview-CPWxnIqg.png",import.meta.url).href,e=[{id:"typedoku",title:"타입도쿠",category:"스도쿠",formats:"4 × 4 · 6 × 6 · 9 × 9",href:"./sudoku.html",image:o,imageAlt:"포켓몬과 타입 아이콘이 배치된 타입도쿠 4 × 4 보드"},{id:"pokemantle",title:"포케맨틀",category:"유사도 추리",formats:"데일리",href:"./pokemantle.html",image:l,imageAlt:"추측한 포켓몬의 유사도와 순위가 표시된 포케맨틀 기록"}];new URLSearchParams(location.search).has("seed")?location.replace(`./sudoku.html${location.search}${location.hash}`):(document.querySelector("#app").innerHTML=`
    <header class="site-header"><div class="header-inner">
      ${t}
      <span class="hub-header-label">비공식 팬 게임</span>
    </div></header>
    <main class="main hub-main">
      <section aria-labelledby="games-title">
        <div class="hub-heading"><h1 id="games-title">전체 게임</h1><span>${e.length}개 게임</span></div>
        <div class="game-library">${e.map(a=>`
          <a class="game-card" href="${a.href}" aria-labelledby="${a.id}-title ${a.id}-play">
            <div class="game-cover"><img src="${a.image}" alt="${a.imageAlt}" width="540" height="620" /></div>
            <div class="game-card-content">
              <span class="game-category">${a.category}</span>
              <h2 id="${a.id}-title">${a.title}</h2>
              <p class="game-formats">${a.formats}</p>
              <span class="game-launch"><span id="${a.id}-play">플레이</span><i data-lucide="arrow-right" aria-hidden="true"></i></span>
            </div>
          </a>`).join("")}</div>
      </section>
      <footer class="footer hub-footer"><span>포켓몬 퀴즈 <span class="footer-dot">·</span> 비공식 팬 게임</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">데이터 · PokéAPI <i data-lucide="arrow-right" aria-hidden="true"></i></a></footer>
    </main>`,i({icons:{Gamepad2:r,ArrowRight:s},attrs:{"stroke-width":1.8}}));
