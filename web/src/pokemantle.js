import {
  createIcons,
  ScanSearch,
  House,
  CircleHelp,
  ChartNoAxesColumn,
  Search,
  ArrowRight,
  X,
  Lightbulb,
  Flag,
  Share2,
  CalendarDays,
  Trophy,
  ImageOff,
  RotateCw,
  Check,
  ChevronDown,
} from "lucide";
import {
  createSimilarity,
  dailyTarget,
  resolveDay,
  dayKey,
  restoreRound,
  isWon,
  submitGuess,
  nextHint,
  searchForms,
  MAX_HINTS,
} from "./similarity-engine.js";
import "./style.css";
import "./pokemantle.css";

const icons = {
  ScanSearch,
  House,
  CircleHelp,
  ChartNoAxesColumn,
  Search,
  ArrowRight,
  X,
  Lightbulb,
  Flag,
  Share2,
  CalendarDays,
  Trophy,
  ImageOff,
  RotateCw,
  Check,
  ChevronDown,
};
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const esc = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const tool = (action, label, glyph) =>
  `<button class="icon-button" data-action="${action}" aria-label="${label}" data-tooltip="${label}">${icon(glyph)}</button>`;
const app = document.querySelector("#app");
const asset = (path) => `${import.meta.env.BASE_URL}${path}`;
const typeImages = import.meta.glob("./assets/types/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
});
let data, game, round, target, ranked, rankById, typeById;
let matches = [],
  active = -1,
  limit = 40,
  sort = "score",
  latest = null,
  toastTimer;
let storageWarning = false;
const RANKING_PAGE_SIZE = 20;
let resultsView = "history",
  rankingLimit = RANKING_PAGE_SIZE,
  wasEnded = false;
const stored = (key) => {
  try {
    return localStorage.getItem(`pokemantle:${key}`);
  } catch {
    return null;
  }
};
function persist(key, value) {
  try {
    localStorage.setItem(`pokemantle:${key}`, JSON.stringify(value));
  } catch {
    storageWarning = true;
    document.querySelector("#save-warning").hidden = false;
  }
}
const roundKey = () => `${data.version}:${round.day}`;
const sprite = (p) =>
  p.image
    ? `<img class="pm-sprite" src="${data.images[p.image]}" alt="" width="64" height="64" draggable="false" />`
    : `<span class="pm-sprite pm-no-image" role="img" aria-label="이미지 미제공" title="이미지 미제공">${icon("image-off")}</span>`;
const badges = (p) =>
  p.types
    .map((id) => {
      const type = typeById.get(id);
      return `<img class="pm-type" src="${typeImages[`./assets/types/${type.key}.svg`]}" alt="${esc(type.name)} 타입" title="${esc(type.name)}" width="18" height="18" />`;
    })
    .join("");
const hints = () => round.guesses.filter((g) => g.hint).length;
const ended = () => round.gaveUp || isWon(round, target);
function refreshIcons() {
  createIcons({ icons, attrs: { "stroke-width": 1.8 } });
}
function toast(text) {
  const el = document.querySelector("#pm-toast");
  el.textContent = text;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 3200);
}

function mount() {
  app.innerHTML = `
    <header class="site-header"><div class="header-inner">
      <a class="brand" href="./pokemantle.html"><span class="brand-mark pm-mark">${icon("scan-search")}</span><span>포켓몬틀<span class="brand-caption">POKÉMON SIMILARITY</span></span></a>
      <nav class="header-actions" aria-label="게임 메뉴"><a class="icon-button" href="./" aria-label="게임 목록으로" data-tooltip="게임 목록으로">${icon("house")}</a>${tool("stats", "내 기록", "chart-no-axes-column")}${tool("help", "게임 규칙", "circle-help")}</nav>
    </div></header>
    <main class="main pm-main">
      <div id="new-day" class="pm-day-banner" hidden><span>새로운 오늘의 포켓몬이 도착했어요.</span><button class="text-button" data-action="today">${icon("rotate-cw")}오늘의 문제</button></div>
      <section class="pm-heading"><div><div id="pm-date" class="eyebrow"></div><h1 id="pm-title">오늘의 포켓몬</h1></div><span class="pm-edition">DAILY<br /><strong>GUESS</strong></span></section>
      <p id="save-warning" class="pm-warning" role="status" hidden>브라우저 저장 공간을 사용할 수 없어 진행 상황이 저장되지 않습니다.</p>
      <section class="pm-summary" aria-label="현재 기록"><div><span>시도</span><strong id="attempts">0</strong></div><div><span>최고 유사도</span><strong id="best-score">-</strong></div><div><span>최고 순위</span><strong id="best-rank">-</strong></div></section>
      <section id="answer-panel" class="pm-answer" hidden aria-live="polite"></section>
      <section id="guess-panel" aria-label="포켓몬 추측">
        <form id="guess-form" autocomplete="off"><div class="pm-search-wrap"><label class="pm-search">${icon("search")}<input id="guess-input" role="combobox" aria-label="포켓몬 이름 또는 도감 번호" aria-autocomplete="list" aria-controls="guess-options" aria-expanded="false" placeholder="포켓몬 이름 또는 도감 번호" spellcheck="false" autocomplete="off" /><button type="button" id="clear-guess" class="icon-button" data-action="clear" aria-label="검색 지우기" hidden>${icon("x")}</button></label><button id="guess-submit" class="pm-submit" type="submit" aria-label="추측 제출" title="추측 제출">${icon("arrow-right")}</button>
          <div id="suggestions" class="pm-suggestions" hidden><div id="match-count" class="pm-match-count" role="status"></div><ul id="guess-options" role="listbox" aria-label="포켓몬 검색 결과"></ul><button id="more-results" type="button" class="text-button" data-action="more" hidden>더 보기</button></div>
        </div></form>
        <div id="first-guesses" class="pm-starters"></div>
      </section>
      <div id="pm-toast" role="status" aria-live="polite"></div>
      <div id="result-tabs" class="pm-result-tabs" role="tablist" aria-label="결과 보기" hidden><button id="ranking-tab" role="tab" aria-controls="ranking-panel" aria-selected="false" tabindex="-1" data-results-view="ranking">유사도 순위</button><button id="history-tab" role="tab" aria-controls="history-panel" aria-selected="true" data-results-view="history">내 추측</button></div>
      <section id="history-panel" class="pm-history" aria-labelledby="history-title"><div class="pm-history-heading"><h2 id="history-title">추측 기록 <span id="guess-count">0</span></h2><label class="pm-sort"><span class="sr-only">기록 정렬</span><select id="guess-sort"><option value="score">유사도순</option><option value="recent">최신순</option></select></label></div>
        <div class="pm-table-wrap"><table class="pm-table"><thead><tr><th scope="col">#</th><th scope="col">포켓몬</th><th scope="col">유사도</th><th scope="col">순위</th></tr></thead><tbody id="guess-history"></tbody></table></div>
        <div id="empty-history" class="pm-empty">${icon("scan-search")}<span>아직 추측한 포켓몬이 없어요.</span></div>
      </section>
      <section id="ranking-panel" class="pm-history" role="tabpanel" aria-labelledby="ranking-tab" hidden>
        <div class="pm-history-heading"><h2>정답 유사도 순위</h2><span id="ranking-total" class="pm-ranking-count"></span></div>
        <label class="pm-search pm-ranking-search">${icon("search")}<input id="ranking-search" type="search" aria-label="순위에서 포켓몬 검색" placeholder="포켓몬 검색" autocomplete="off" spellcheck="false" /><button type="button" class="icon-button" id="clear-ranking" data-action="clear-ranking" aria-label="순위 검색 지우기" hidden>${icon("x")}</button></label>
        <div class="pm-table-wrap"><table class="pm-table pm-ranking-table"><thead><tr><th scope="col">순위</th><th scope="col">포켓몬</th><th scope="col">유사도</th></tr></thead><tbody id="similarity-ranking"></tbody></table></div>
        <div id="ranking-empty" class="pm-empty" hidden>일치하는 포켓몬이 없어요.</div>
        <div class="pm-ranking-footer"><span id="ranking-count" class="pm-ranking-count" role="status"></span><button class="text-button" id="more-ranking" data-action="more-ranking">${icon("chevron-down")}더 보기</button></div>
      </section>
      <div class="pm-game-actions"><div><button class="text-button pm-hint" data-action="hint">${icon("lightbulb")}<span id="hint-label">힌트 0/3</span></button><button class="text-button" data-action="give-up">${icon("flag")}포기</button></div><span id="next-puzzle" class="pm-next"></span></div>
      <footer class="footer pm-footer"><span>포켓몬틀 <span class="footer-dot">·</span> 비공식 팬 게임</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">데이터 · PokéAPI ${icon("arrow-right")}</a></footer>
    </main>
    <dialog id="pm-dialog"><div class="dialog-header"><h2 id="pm-dialog-title"></h2>${tool("close-dialog", "닫기", "x")}</div><div id="pm-dialog-body"></div></dialog>`;
  document.querySelector("#guess-input").addEventListener("input", () => {
    active = -1;
    limit = 40;
    renderSuggestions();
  });
  document
    .querySelector("#guess-input")
    .addEventListener("focus", renderSuggestions);
  document
    .querySelector("#guess-input")
    .addEventListener("keydown", onSearchKey);
  document.querySelector("#guess-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const choice =
      active >= 0 ? matches[active] : matches.length === 1 ? matches[0] : null;
    if (choice) guess(choice.id);
    else {
      renderSuggestions();
      toast(
        matches.length
          ? "목록에서 포켓몬의 모습을 선택해 주세요."
          : "포켓몬 이름을 확인해 주세요.",
      );
    }
  });
  document.querySelector("#guess-sort").addEventListener("change", (event) => {
    sort = event.target.value;
    renderHistory();
  });
  document.querySelector("#ranking-search").addEventListener("input", () => {
    rankingLimit = RANKING_PAGE_SIZE;
    renderRankings();
  });
  document
    .querySelector("#result-tabs")
    .addEventListener("keydown", (event) => {
      if (!event.target.matches("[role=tab]")) return;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const view =
        event.key === "Home"
          ? "ranking"
          : event.key === "End"
            ? "history"
            : resultsView === "ranking"
              ? "history"
              : "ranking";
      setResultsView(view);
      document.querySelector(`#${view}-tab`).focus();
    });
  document.addEventListener("click", onClick);
  document.addEventListener("focusin", (event) => {
    if (!event.target.closest("#guess-form")) closeSuggestions();
  });
  document.querySelector("#pm-dialog").addEventListener("click", (event) => {
    if (event.target.id === "pm-dialog") event.target.close();
  });
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("pageshow", tick);
  setInterval(tick, 1000);
}

function start(day) {
  clearTimeout(toastTimer);
  document.querySelector("#pm-toast").textContent = "";
  document.querySelector("#pm-toast").classList.remove("visible");
  round = restoreRound(stored(`${data.version}:${day}`), data, day);
  target = dailyTarget(data, day);
  ranked = game.ranking(target);
  rankById = new Map(ranked.map((row) => [row.id, row]));
  resultsView = "history";
  rankingLimit = RANKING_PAGE_SIZE;
  wasEnded = false;
  document.querySelector("#ranking-search").value = "";
  latest = null;
  document.querySelector("#guess-input").value = "";
  document.querySelector("#pm-title").textContent =
    day === dayKey() ? "오늘의 포켓몬" : "지난 포켓몬";
  document.querySelector("#pm-date").innerHTML =
    `${icon("calendar-days")} ${esc(day.replaceAll("-", "."))}`;
  render();
  tick();
}

function closeSuggestions() {
  document.querySelector("#suggestions").hidden = true;
  const input = document.querySelector("#guess-input");
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  active = -1;
}

function renderSuggestions() {
  const input = document.querySelector("#guess-input");
  const query = input.value.trim();
  document.querySelector("#clear-guess").hidden = !query;
  if (!query || ended()) {
    matches = [];
    closeSuggestions();
    return;
  }
  matches = searchForms(data.pokemon, query);
  const guessed = new Set(round.guesses.map((g) => g.id));
  document.querySelector("#suggestions").hidden = false;
  input.setAttribute("aria-expanded", "true");
  document.querySelector("#match-count").textContent = matches.length
    ? `${matches.length}개 모습`
    : "일치하는 포켓몬이 없어요.";
  document.querySelector("#guess-options").innerHTML = matches
    .slice(0, limit)
    .map(
      (p, i) =>
        `<li id="guess-option-${i}" role="option" aria-selected="${active === i}" data-guessed="${guessed.has(p.id)}" data-guess="${p.id}">${sprite(p)}<span class="pm-option-name">${esc(p.name)}<small>#${String(p.speciesId).padStart(4, "0")}${guessed.has(p.id) ? " · 이미 추측" : ""}</small></span><span class="pm-option-types">${guessed.has(p.id) ? icon("check") : badges(p)}</span></li>`,
    )
    .join("");
  document.querySelector("#more-results").hidden = matches.length <= limit;
  updateActive();
  refreshIcons();
}

function updateActive() {
  const input = document.querySelector("#guess-input");
  document
    .querySelectorAll("#guess-options [role=option]")
    .forEach((option, i) => option.setAttribute("aria-selected", i === active));
  if (active >= 0) {
    input.setAttribute("aria-activedescendant", `guess-option-${active}`);
    document
      .querySelector(`#guess-option-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  } else input.removeAttribute("aria-activedescendant");
}

function onSearchKey(event) {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    closeSuggestions();
    return;
  }
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  if (document.querySelector("#suggestions").hidden) renderSuggestions();
  const count = Math.min(matches.length, limit);
  if (!count) return;
  active =
    active < 0
      ? event.key === "ArrowDown"
        ? 0
        : count - 1
      : (active + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
  updateActive();
}

function guess(id, hint = false) {
  const result = submitGuess(round, id, target, game.byId, hint);
  if (result !== "ok") {
    if (result === "duplicate") toast("이미 추측한 모습이에요.");
    return;
  }
  latest = id;
  persist(roundKey(), round);
  document.querySelector("#guess-input").value = "";
  matches = [];
  closeSuggestions();
  render();
  const row = rankById.get(id);
  toast(
    isWon(round, target)
      ? "정답이에요!"
      : `유사도 ${row.score.toFixed(2)} · ${row.rank}위`,
  );
  if (ended()) {
    saveRecord();
    document.querySelector("#answer-title").focus({ preventScroll: true });
  } else document.querySelector("#guess-input").focus({ preventScroll: true });
}

function render() {
  if (ended() && !wasEnded) resultsView = "ranking";
  wasEnded = ended();
  const best = ranked.find((row) => round.guesses.some((g) => g.id === row.id));
  document.querySelector("#attempts").textContent = round.guesses.length;
  document.querySelector("#best-score").textContent = best
    ? best.score.toFixed(2)
    : "-";
  document.querySelector("#best-rank").textContent = best
    ? `${best.rank}위`
    : "-";
  document.querySelector("#guess-panel").hidden = ended();
  document.querySelector("#answer-panel").hidden = !ended();
  if (ended()) {
    const p = game.byId.get(target);
    document.querySelector("#answer-panel").innerHTML =
      `${sprite(p)}<div class="pm-answer-details"><span>${isWon(round, target) ? "정답!" : "오늘의 정답"}</span><h2 id="answer-title" tabindex="-1">${esc(p.name)}</h2><div class="pm-answer-types">${badges(p)}</div></div><button class="text-button" data-action="share">${icon("share-2")}결과 공유</button>`;
  }
  document.querySelector("#first-guesses").hidden = round.guesses.length > 0;
  document.querySelector("#first-guesses").innerHTML = [1, 6, 25, 94, 131]
    .map((id) => game.byId.get(id))
    .filter(Boolean)
    .map(
      (p) =>
        `<button class="pm-starter" data-guess="${p.id}" aria-label="${esc(p.name)} 추측">${sprite(p)}<span>${esc(p.baseName)}</span></button>`,
    )
    .join("");
  document.querySelector("#hint-label").textContent =
    `힌트 ${hints()}/${MAX_HINTS}`;
  document.querySelector('[data-action="hint"]').disabled =
    ended() || nextHint(round, ranked) === null;
  document.querySelector('[data-action="give-up"]').disabled = ended();
  document.querySelector("#save-warning").hidden = !storageWarning;
  document.querySelector("#clear-guess").hidden = true;
  renderHistory();
  renderRankings();
  renderResultsView();
}

function setResultsView(view) {
  if (!ended() || !["history", "ranking"].includes(view)) return;
  resultsView = view;
  renderResultsView();
}

function renderResultsView() {
  const finished = ended();
  document.querySelector("#result-tabs").hidden = !finished;
  document.querySelector("#ranking-panel").hidden =
    !finished || resultsView !== "ranking";
  const history = document.querySelector("#history-panel");
  history.hidden = finished && resultsView !== "history";
  if (finished) history.setAttribute("role", "tabpanel");
  else history.removeAttribute("role");
  history.setAttribute(
    "aria-labelledby",
    finished ? "history-tab" : "history-title",
  );
  for (const view of ["ranking", "history"]) {
    const tab = document.querySelector(`#${view}-tab`);
    tab.setAttribute("aria-selected", resultsView === view);
    tab.tabIndex = resultsView === view ? 0 : -1;
  }
}

function renderRankings() {
  const body = document.querySelector("#similarity-ranking");
  if (!ended()) {
    body.replaceChildren();
    document.querySelector("#ranking-total").textContent = "";
    document.querySelector("#ranking-count").textContent = "";
    return;
  }
  const query = document.querySelector("#ranking-search").value.trim();
  const matching = query
    ? new Set(searchForms(data.pokemon, query).map((p) => p.id))
    : null;
  const rows = matching ? ranked.filter((row) => matching.has(row.id)) : ranked;
  const visible = rows.slice(0, rankingLimit);
  const guesses = new Map(round.guesses.map((guess) => [guess.id, guess]));
  body.innerHTML = visible
    .map((row) => {
      const p = game.byId.get(row.id);
      const warmth =
        row.score >= 70 ? "hot" : row.score >= 40 ? "warm" : "cool";
      const label =
        p.id === target
          ? "정답"
          : guesses.has(p.id)
            ? guesses.get(p.id).hint
              ? "내 추측 · 힌트"
              : "내 추측"
            : "";
      return `<tr data-ranking="${p.id}" class="${p.id === target ? "pm-ranking-answer" : ""}"><td class="pm-rank">${row.rank.toLocaleString("ko-KR")}위</td><th scope="row"><div class="pm-pokemon">${sprite(p)}<span>${esc(p.name)}<small class="pm-ranking-meta">${badges(p)}${label ? `<span>${label}</span>` : ""}</small></span></div></th><td><div class="pm-score ${warmth}"><strong>${row.score.toFixed(2)}</strong><span class="pm-score-track"><span style="width:${row.score}%"></span></span></div></td></tr>`;
    })
    .join("");
  document.querySelector("#clear-ranking").hidden = !query;
  document.querySelector("#ranking-empty").hidden = rows.length > 0;
  document.querySelector("#ranking-total").textContent =
    `${rows.length.toLocaleString("ko-KR")}개 모습`;
  document.querySelector("#ranking-count").textContent =
    `${visible.length.toLocaleString("ko-KR")} / ${rows.length.toLocaleString("ko-KR")}`;
  document.querySelector("#more-ranking").hidden =
    visible.length >= rows.length;
  refreshIcons();
}

function renderHistory() {
  const guesses = round.guesses.map((guess, i) => ({
    ...guess,
    ...rankById.get(guess.id),
    number: i + 1,
  }));
  guesses.sort(
    sort === "recent"
      ? (a, b) => b.number - a.number
      : (a, b) => b.score - a.score || b.number - a.number,
  );
  document.querySelector("#guess-count").textContent = guesses.length;
  document.querySelector("#empty-history").hidden = guesses.length > 0;
  document.querySelector("#guess-history").innerHTML = guesses
    .map((row) => {
      const p = game.byId.get(row.id);
      const warmth =
        row.score >= 70 ? "hot" : row.score >= 40 ? "warm" : "cool";
      return `<tr data-result="${p.id}" class="${latest === p.id ? "pm-latest" : ""}"><td class="pm-number">${row.number}</td><th scope="row"><div class="pm-pokemon">${sprite(p)}<span>${esc(p.name)}${row.hint ? '<small class="pm-hint-tag">힌트</small>' : ""}</span></div></th><td><div class="pm-score ${warmth}"><strong>${row.score.toFixed(2)}</strong><span class="pm-score-track"><span style="width:${row.score}%"></span></span></div></td><td class="pm-rank">${row.rank.toLocaleString("ko-KR")}위</td></tr>`;
    })
    .join("");
  refreshIcons();
}

function dialog(title, body) {
  closeSuggestions();
  document.querySelector("#pm-dialog-title").textContent = title;
  document.querySelector("#pm-dialog-body").innerHTML = body;
  refreshIcons();
  document.querySelector("#pm-dialog").showModal();
}

function records() {
  try {
    const value = JSON.parse(stored("records"));
    return Array.isArray(value)
      ? value.filter(
          (r) =>
            r &&
            typeof r.day === "string" &&
            typeof r.won === "boolean" &&
            Number.isInteger(r.attempts) &&
            r.attempts >= 0,
        )
      : [];
  } catch {
    return [];
  }
}
function saveRecord() {
  const list = records().filter(
    (r) => !(r.day === round.day && r.version === data.version),
  );
  list.unshift({
    day: round.day,
    version: data.version,
    won: isWon(round, target),
    attempts: round.guesses.length,
    hints: hints(),
  });
  persist("records", list.slice(0, 365));
}

async function share() {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("date", round.day);
  const text = `포켓몬틀 ${round.day}\n${isWon(round, target) ? `${round.guesses.length}번 만에 정답` : "도전 종료"} · 힌트 ${hints()}회\n${url.href}`;
  try {
    if (navigator.share && matchMedia("(max-width:800px)").matches)
      await navigator.share({ title: "포켓몬틀", text });
    else {
      await navigator.clipboard.writeText(text);
      toast("정답을 제외한 결과를 복사했어요.");
    }
  } catch (error) {
    if (error.name !== "AbortError")
      dialog(
        "결과 공유",
        `<textarea class="share-text" readonly aria-label="공유할 결과">${esc(text)}</textarea>`,
      );
  }
}

function onClick(event) {
  const resultTab = event.target.closest("[data-results-view]");
  if (resultTab) {
    setResultsView(resultTab.dataset.resultsView);
    return;
  }
  const guessOption = event.target.closest("[data-guess]");
  if (guessOption) {
    guess(Number(guessOption.dataset.guess));
    return;
  }
  if (!event.target.closest("#guess-form")) closeSuggestions();
  const button = event.target.closest("[data-action]");
  if (!button) return;
  switch (button.dataset.action) {
    case "more-ranking":
      if (ended()) {
        rankingLimit += RANKING_PAGE_SIZE;
        renderRankings();
      }
      break;
    case "clear-ranking":
      document.querySelector("#ranking-search").value = "";
      rankingLimit = RANKING_PAGE_SIZE;
      renderRankings();
      document.querySelector("#ranking-search").focus();
      break;
    case "clear":
      document.querySelector("#guess-input").value = "";
      renderSuggestions();
      document.querySelector("#guess-input").focus();
      break;
    case "more":
      limit += 40;
      renderSuggestions();
      break;
    case "hint": {
      const id = nextHint(round, ranked);
      if (id !== null) guess(id, true);
      break;
    }
    case "give-up":
      if (!ended())
        dialog(
          "정답을 공개할까요?",
          `<p class="dialog-copy">이 문제의 도전이 종료됩니다.</p><button class="primary-button wide" data-action="confirm-give-up">${icon("flag")}정답 공개</button>`,
        );
      break;
    case "confirm-give-up":
      if (!ended()) {
        round.gaveUp = true;
        persist(roundKey(), round);
        saveRecord();
        document.querySelector("#pm-dialog").close();
        render();
      }
      break;
    case "close-dialog":
      document.querySelector("#pm-dialog").close();
      break;
    case "share":
      share();
      break;
    case "today":
      history.replaceState(null, "", location.pathname);
      start(dayKey());
      break;
    case "help":
      dialog(
        "포켓몬틀 규칙",
        `<ul class="rules"><li>하루에 한 포켓몬의 <strong>정확한 모습</strong>을 맞힙니다. 알로라·가라르·히스이·팔데아, 메가진화와 외형 차이도 각각 별개의 정답입니다.</li><li>유사도가 높을수록 정답과 가깝습니다. 정답은 <strong>100점, 1위</strong>이며 같은 점수는 공동 순위입니다.</li><li>도감 설명 30%, 타입 20%, 진화 15%, 종족값·특성·습득 기술 각 10%, 알그룹 3%, 체격 2%를 반영합니다. 없는 데이터는 비교에서 제외합니다.</li><li>힌트는 지금보다 가까운 포켓몬을 최대 3번 공개하며 시도 횟수에 포함됩니다.</li><li>한국 시간 자정에 다음 문제가 열립니다. 진행 상황은 이 브라우저에 저장됩니다.</li></ul>`,
      );
      break;
    case "stats": {
      const list = records();
      const wins = list.filter((r) => r.won);
      dialog(
        "내 기록",
        `<div class="stats-row"><div><strong>${list.length}</strong><span>완료한 도전</span></div><div><strong>${wins.length}</strong><span>정답</span></div><div><strong>${wins.length ? (wins.reduce((sum, r) => sum + r.attempts, 0) / wins.length).toFixed(1) : "-"}</strong><span>평균 시도</span></div></div><div class="history-list">${
          list
            .slice(0, 8)
            .map(
              (r) =>
                `<div><span>${esc(r.day)}<small>힌트 ${r.hints || 0}회</small></span><strong>${r.won ? `${r.attempts}회 정답` : "도전 종료"}</strong></div>`,
            )
            .join("") || '<p class="dialog-copy">아직 완료한 도전이 없어요.</p>'
        }</div>`,
      );
      break;
    }
  }
}

function tick() {
  if (!round) return;
  const today = dayKey();
  document.querySelector("#new-day").hidden = round.day === today;
  const seconds = Math.max(
    0,
    Math.ceil(
      (Date.parse(`${today}T00:00:00+09:00`) + 86400000 - Date.now()) / 1000,
    ),
  );
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60;
  document.querySelector("#next-puzzle").textContent =
    `다음 문제 ${[h, m, s].map((n) => String(n).padStart(2, "0")).join(":")}`;
}

async function boot() {
  app.innerHTML =
    '<div class="loading-screen"><span class="loading-spinner"></span><strong>오늘의 포켓몬을 준비하고 있어요</strong></div>';
  try {
    const response = await fetch(asset("pokemantle.json"));
    if (!response.ok) throw new Error(`Catalog: ${response.status}`);
    data = await response.json();
    const matrixResponse = await fetch(
      asset(`pokemantle-scores.bin?v=${data.matrixSha256}`),
    );
    if (!matrixResponse.ok) throw new Error(`Scores: ${matrixResponse.status}`);
    const buffer = await matrixResponse.arrayBuffer();
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (digest !== data.matrixSha256)
      throw new Error("Similarity data version mismatch");
    game = createSimilarity(data, buffer);
    typeById = new Map(data.types.map((t) => [t.id, t]));
    mount();
    start(resolveDay(new URLSearchParams(location.search).get("date")));
  } catch (error) {
    console.error(error);
    app.innerHTML =
      '<div class="loading-screen"><h1>게임을 불러오지 못했어요</h1><p>연결을 확인하고 다시 시도해 주세요.</p><button class="primary-button" id="retry">다시 시도</button><a class="text-button" href="./">게임 목록으로</a></div>';
    document.querySelector("#retry").onclick = () => location.reload();
  }
}
boot();
