import{i as r,s,t as a,l as n,g as o,c as l,L as d,A as c,G as p}from"./style-VX3kBIor.js";const h=""+new URL("typedoku-preview-B8yMirdL.png",import.meta.url).href,m=""+new URL("pokemantle-preview-CPWxnIqg.png",import.meta.url).href,g=""+new URL("typedoku-preview-en-B53C74ZQ.png",import.meta.url).href,u=""+new URL("pokemantle-preview-en-BEnqBw6W.png",import.meta.url).href,t=[{id:"typedoku",title:"타입도쿠",category:"스도쿠",formats:"4 × 4 · 6 × 6 · 9 × 9",href:"./sudoku.html",image:h,imageEn:g,imageAlt:"포켓몬과 타입 아이콘이 배치된 타입도쿠 4 × 4 보드"},{id:"pokemantle",title:"포케맨틀",category:"유사도 추리",formats:"데일리",href:"./pokemantle.html",image:m,imageEn:u,imageAlt:"추측한 포켓몬의 유사도와 순위가 표시된 포케맨틀 기록"}];r("포켓몬 퀴즈",i);new URLSearchParams(location.search).has("seed")?location.replace(`./sudoku.html${location.search}${location.hash}`):i();function i(){document.querySelector("#app").innerHTML=`
    <header class="site-header"><div class="header-inner">
      ${s()}
      <div class="header-actions"><span class="hub-header-label">${a("비공식 팬 게임")}</span>${n()}</div>
    </div></header>
    <main class="main hub-main">
      <section aria-labelledby="games-title">
        <div class="hub-heading"><h1 id="games-title">${a("전체 게임")}</h1><span>${a("{count}개 게임",{count:t.length})}</span></div>
        <div class="game-library">${t.map(e=>`
          <a class="game-card" href="${e.href}" aria-labelledby="${e.id}-title ${e.id}-play">
            <div class="game-cover"><img src="${o()==="en"?e.imageEn:e.image}" alt="${a(e.imageAlt)}" width="540" height="620" /></div>
            <div class="game-card-content">
              <span class="game-category">${a(e.category)}</span>
              <h2 id="${e.id}-title">${a(e.title)}</h2>
              <p class="game-formats">${a(e.formats)}</p>
              <span class="game-launch"><span id="${e.id}-play">${a("플레이")}</span><i data-lucide="arrow-right" aria-hidden="true"></i></span>
            </div>
          </a>`).join("")}</div>
      </section>
      <footer class="footer hub-footer"><span>${a("포켓몬 퀴즈")} <span class="footer-dot">·</span> ${a("비공식 팬 게임")}</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">${a("데이터 · PokéAPI")} <i data-lucide="arrow-right" aria-hidden="true"></i></a></footer>
    </main>`,l({icons:{Gamepad2:p,ArrowRight:c,Languages:d},attrs:{"stroke-width":1.8}})}
