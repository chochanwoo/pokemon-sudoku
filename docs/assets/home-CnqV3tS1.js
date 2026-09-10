import{d as i,c as t,A as s}from"./style-42PnWaVO.js";const r=["svg",i,[["line",{x1:"6",x2:"10",y1:"11",y2:"11"}],["line",{x1:"8",x2:"8",y1:"9",y2:"13"}],["line",{x1:"15",x2:"15.01",y1:"12",y2:"12"}],["line",{x1:"18",x2:"18.01",y1:"10",y2:"10"}],["path",{d:"M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"}]]],l=""+new URL("typedoku-preview-B8yMirdL.png",import.meta.url).href,n=""+new URL("pokemantle-preview-CPWxnIqg.png",import.meta.url).href,e=[{id:"typedoku",title:"타입도쿠",category:"스도쿠",formats:"4 × 4 · 6 × 6 · 9 × 9",href:"./sudoku.html",image:l,imageAlt:"포켓몬과 타입 아이콘이 배치된 타입도쿠 4 × 4 보드"},{id:"pokemantle",title:"포켓몬틀",category:"유사도 추리",formats:"데일리 · 1,579개 모습",href:"./pokemantle.html",image:n,imageAlt:"추측한 포켓몬의 유사도와 순위가 표시된 포켓몬틀 기록"}];new URLSearchParams(location.search).has("seed")?location.replace(`./sudoku.html${location.search}${location.hash}`):(document.querySelector("#app").innerHTML=`
    <header class="site-header"><div class="header-inner">
      <a class="brand" href="./" aria-label="포켓몬 게임 메인"><span class="brand-mark"><i data-lucide="gamepad-2" aria-hidden="true"></i></span><span>포켓몬 게임<span class="brand-caption">POKÉMON GAMES</span></span></a>
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
      <footer class="footer hub-footer"><span>포켓몬 게임 <span class="footer-dot">·</span> 비공식 팬 게임</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">데이터 · PokéAPI <i data-lucide="arrow-right" aria-hidden="true"></i></a></footer>
    </main>`,t({icons:{Gamepad2:r,ArrowRight:s},attrs:{"stroke-width":1.8}}));
