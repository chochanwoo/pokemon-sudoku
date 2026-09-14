import{i as r,s as n,t as a,l as o,g as s,c as l,L as p,A as m,G as c}from"./style-CRuik8BR.js";const h=""+new URL("typedoku-preview-B8yMirdL.png",import.meta.url).href,g=""+new URL("pokemantle-preview-CPWxnIqg.png",import.meta.url).href,d=""+new URL("typedoku-preview-en-B53C74ZQ.png",import.meta.url).href,w=""+new URL("pokemantle-preview-en-BEnqBw6W.png",import.meta.url).href,u=""+new URL("pokeclue-preview-Djnt1yz9.png",import.meta.url).href,f=""+new URL("pokeclue-preview-en-r7CxjnpD.png",import.meta.url).href,v=""+new URL("highlow-preview-X4PObmAk.png",import.meta.url).href,k=""+new URL("highlow-preview-en-B4eklXwn.png",import.meta.url).href,$=""+new URL("pokinator-preview-j8UHT6iW.png",import.meta.url).href,y=""+new URL("pokinator-preview-en-CjNZHjOX.png",import.meta.url).href,i=[{id:"typedoku",title:"타입도쿠",category:"스도쿠",formats:"4 × 4 · 6 × 6 · 9 × 9",href:"./sudoku.html",image:h,imageEn:d,imageAlt:"포켓몬과 타입 아이콘이 배치된 타입도쿠 4 × 4 보드"},{id:"pokemantle",title:"포맨틀",category:"유사도 추리",formats:"데일리",href:"./pokemantle.html",image:g,imageEn:w,imageAlt:"추측한 포켓몬의 유사도와 순위가 표시된 포맨틀 기록"},{id:"pokeclue",title:"포케클루",category:"단서 추리",formats:"데일리 · 연습",href:"./pokeclue.html",image:u,imageEn:f,imageAlt:"타입과 특성 등 여섯 가지 단서를 비교한 포케클루 추측 기록"},{id:"highlow",title:"포케 하이로우",category:"종족값 대결",formats:"데일리 · 연습",href:"./highlow.html",image:v,imageEn:k,imageAlt:"두 포켓몬의 종족값을 비교하는 포케 하이로우 대결"},{id:"pokinator",title:"포키네이터",category:"역방향 추리",formats:"자유 플레이",href:"./pokinator.html",image:$,imageEn:y,imageAlt:"포키네이터의 질문에 예, 아니오, 모르겠습니다로 답하는 화면"}];r("포켓몬 퀴즈",t);new URLSearchParams(location.search).has("seed")?location.replace(`./sudoku.html${location.search}${location.hash}`):t();function t(){document.querySelector("#app").innerHTML=`
    <header class="site-header"><div class="header-inner">
      ${n()}
      <div class="header-actions"><span class="hub-header-label">${a("비공식 팬 게임")}</span>${o()}</div>
    </div></header>
    <main class="main hub-main">
      <section aria-labelledby="games-title">
        <div class="hub-heading"><h1 id="games-title">${a("전체 게임")}</h1><span>${a("{count}개 게임",{count:i.length})}</span></div>
        <div class="game-library">${i.map(e=>`
          <a class="game-card" href="${e.href}" aria-labelledby="${e.id}-title ${e.id}-play">
            <div class="game-cover"><img src="${s()==="en"?e.imageEn:e.image}" alt="${a(e.imageAlt)}" width="540" height="620" /></div>
            <div class="game-card-content">
              <span class="game-category">${a(e.category)}</span>
              <h2 id="${e.id}-title">${a(e.title)}</h2>
              <p class="game-formats">${a(e.formats)}</p>
              <span class="game-launch"><span id="${e.id}-play">${a("플레이")}</span><i data-lucide="arrow-right" aria-hidden="true"></i></span>
            </div>
          </a>`).join("")}</div>
      </section>
      <footer class="footer hub-footer"><span>${a("포켓몬 퀴즈")} <span class="footer-dot">·</span> ${a("비공식 팬 게임")}</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">${a("데이터 · PokéAPI")} <i data-lucide="arrow-right" aria-hidden="true"></i></a></footer>
    </main>`,l({icons:{Gamepad2:c,ArrowRight:m,Languages:p},attrs:{"stroke-width":1.8}})}
