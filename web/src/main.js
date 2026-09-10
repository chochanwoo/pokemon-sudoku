import {
  createIcons,
  Grid2X2,
  Undo2,
  Redo2,
  Pencil,
  Eraser,
  Lightbulb,
  CircleCheck,
  CircleHelp,
  ChartNoAxesColumn,
  Search,
  Shuffle,
  Pause,
  Play,
  X,
  LockKeyhole,
  Share2,
  RotateCcw,
  Trophy,
  ArrowRight,
  Check,
  CalendarDays,
  ChevronDown,
} from "lucide";
import {
  makePuzzle,
  newState,
  findConflicts,
  canPlace,
  placePokemon,
  toggleNote,
  undo,
  redo,
  isComplete,
  wrongCells,
  restoreState,
  searchPokemon,
  getPeers,
  dayKey,
  pairKey,
} from "./engine.js";
import "./style.css";

const icons = {
  Grid2X2,
  Undo2,
  Redo2,
  Pencil,
  Eraser,
  Lightbulb,
  CircleCheck,
  CircleHelp,
  ChartNoAxesColumn,
  Search,
  Shuffle,
  Pause,
  Play,
  X,
  LockKeyhole,
  Share2,
  RotateCcw,
  Trophy,
  ArrowRight,
  Check,
  CalendarDays,
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
const difficultyNames = { easy: "쉬움", normal: "보통", hard: "어려움" };
const app = document.querySelector("#app");
let catalog, pack, byId, types, puzzle, state;
let selected = -1,
  mode = "daily",
  size = 6,
  difficulty = "normal",
  seed = "",
  pencil = false;
let query = "",
  filters = [],
  legalOnly = false,
  paused = false,
  checked = new Set(),
  highlighted = null;
let complete = false,
  panelOpen = false,
  storageFailed = false,
  lastTick = performance.now();
let toastTimeout;
const asset = (path) => `${import.meta.env.BASE_URL}${path}`;
const storage = {
  get(key) {
    try {
      return localStorage.getItem(`typedoku:${key}`);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`typedoku:${key}`, value);
    } catch {
      if (!storageFailed) {
        storageFailed = true;
        toast("저장 공간을 사용할 수 없어요. 이번 게임은 저장되지 않습니다.");
      }
    }
  },
};
const sprite = (p, cls = "", lazy = false) =>
  `<img class="sprite ${cls}" src="${p.image || asset(`sprites/${p.id}.png`)}" alt="" width="96" height="96" ${lazy ? 'loading="lazy"' : ""} draggable="false" />`;
const badge = (id) =>
  `<span class="type-badge type-${id}" title="${esc(types.get(id).name)}">${esc(types.get(id).name)}</span>`;
const tool = (action, label, glyph, extra = "") =>
  `<button class="icon-button" data-action="${action}" aria-label="${label}" data-tooltip="${label}" ${extra}>${icon(glyph)}</button>`;

function mount() {
  app.innerHTML = `
    <header class="site-header"><div class="header-inner">
      <a class="brand" href="./"><span class="brand-mark">${icon("grid-2-x2")}</span><span>타입도쿠<span class="brand-caption">POKÉMON SUDOKU</span></span></a>
      <nav class="header-actions" aria-label="게임 메뉴">${tool("stats", "내 기록", "chart-no-axes-column")}${tool("help", "게임 규칙", "circle-help")}</nav>
    </div></header>
    <main class="main">
      <section class="game-heading">
        <div><div class="eyebrow" id="eyebrow"></div><h1 id="game-title">오늘의 타입 퍼즐</h1></div>
        <div class="segmented mode-switch" aria-label="게임 모드"><button data-mode="daily">오늘의 퍼즐</button><button data-mode="free">자유 플레이</button></div>
      </section>
      <section class="game-settings" aria-label="퍼즐 설정">
        <div class="settings-left"><div class="segmented size-switch" aria-label="보드 크기">${[4, 6, 9].map((n) => `<button data-size="${n}" aria-label="${n} 곱하기 ${n}">${n} × ${n}</button>`).join("")}</div>
        <label class="difficulty-select"><span class="sr-only">난이도</span><select id="difficulty">${Object.entries(
          difficultyNames,
        )
          .map(([v, l]) => `<option value="${v}">${l}</option>`)
          .join("")}</select>${icon("chevron-down")}</label></div>
        <button class="text-button new-button" data-action="new">${icon("shuffle")}<span>새 퍼즐</span></button>
      </section>
      <div class="game-layout">
        <section class="board-section" aria-label="스도쿠 게임">
          <div class="board-status"><div class="status-left"><span class="status-dot"></span><span id="progress-label"></span></div>
            <div class="clock">${icon("calendar-days")}<span id="timer">00:00</span>${tool("pause", "일시 정지", "pause")}</div></div>
          <div class="board-wrap"><div id="board" class="board" role="grid" aria-label="포켓몬 타입 스도쿠"></div>
            <div class="pause-cover" id="pause-cover" hidden><span class="pause-symbol">${icon("pause")}</span><h2>잠깐 쉬어 가요</h2><button class="primary-button" data-action="pause">${icon("play")}계속하기</button></div>
          </div>
          <div class="board-bottom"><div class="progress-track"><div id="progress-fill"></div></div><span id="filled-count"></span></div>
          <div class="toolbar"><div>${tool("undo", "되돌리기", "undo-2")}${tool("redo", "다시 실행", "redo-2")}<span class="tool-divider"></span>${tool("pencil", "타입 메모", "pencil", 'aria-pressed="false"')}${tool("erase", "선택한 칸 지우기", "eraser")}</div>
            <div>${tool("restart", "처음부터", "rotate-ccw")}<span class="tool-divider"></span><button class="text-button" data-action="check">${icon("circle-check")}<span>확인</span></button><button class="text-button hint-button" data-action="hint">${icon("lightbulb")}<span>힌트</span></button></div>
          </div>
          <section class="type-tracker" aria-label="이번 퍼즐의 타입"><div class="section-line"><h2>이번 퍼즐의 타입</h2><span id="type-count"></span></div><div id="type-tracker-list"></div></section>
          <div id="completion-banner" hidden></div>
        </section>
        <aside class="picker" id="picker" aria-label="포켓몬 선택">
          <div class="picker-header"><div><span class="eyebrow" id="cell-label">POKÉDEX</span><h2 id="picker-title">포켓몬 선택</h2></div><button class="icon-button mobile-only" data-action="close-picker" aria-label="선택창 닫기">${icon("x")}</button><span class="picker-count" id="picker-count"></span></div>
          <div id="selected-preview" class="selected-preview"></div>
          <div id="pokemon-picker"><label class="search-box">${icon("search")}<input id="search" type="search" placeholder="이름 또는 도감 번호" autocomplete="off" aria-label="포켓몬 검색" /> </label>
            <div class="picker-filter-heading"><span>타입 필터</span><button id="clear-filter" class="link-button" data-action="clear-filter" hidden>초기화</button></div>
            <div class="type-filters" id="type-filters"></div>
            <label class="legal-toggle"><input id="legal-only" type="checkbox" /><span>충돌 없는 후보만</span></label>
            <div class="results-heading"><span id="result-count"></span><span class="small-muted">기본 폼</span></div>
            <div id="pokemon-results" class="pokemon-results"></div>
          </div>
          <div id="note-picker" hidden><div class="note-types" id="note-types"></div></div>
        </aside>
      </div>
      <footer class="footer"><span>타입도쿠 <span class="footer-dot">·</span> 비공식 팬 게임</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">데이터 · PokéAPI ${icon("arrow-right")}</a></footer>
    </main>
    <div class="picker-backdrop" id="picker-backdrop" hidden></div>
    <dialog id="dialog"><div class="dialog-header"><h2 id="dialog-title"></h2>${tool("close-dialog", "닫기", "x")}</div><div id="dialog-body"></div></dialog>
    <div id="toast" role="status" aria-live="polite"></div>`;
  document.querySelector("#search").addEventListener("input", (e) => {
    query = e.target.value;
    renderResults();
  });
  document
    .querySelector("#difficulty")
    .addEventListener("change", (e) =>
      changeSettings({ difficulty: e.target.value }),
    );
  document.querySelector("#legal-only").addEventListener("change", (e) => {
    legalOnly = e.target.checked;
    renderResults();
  });
  document.querySelector("#dialog").addEventListener("click", (e) => {
    if (e.target.id === "dialog") e.target.close();
  });
  document
    .querySelector("#picker-backdrop")
    .addEventListener("click", closePicker);
  document.addEventListener("click", handleClick);
  document.addEventListener("keydown", handleKey);
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", () => {
    save();
    lastTick = performance.now();
  });
}

function start(settings, allowRestore = true) {
  ({ mode, size, difficulty, seed } = settings);
  puzzle = makePuzzle(pack, catalog, { size, difficulty, seed });
  state = allowRestore
    ? restoreState(storage.get(`game:${puzzle.id}`), puzzle, byId) ||
      newState(puzzle)
    : newState(puzzle);
  selected = -1;
  query = "";
  filters = [];
  checked.clear();
  highlighted = null;
  pencil = false;
  paused = false;
  complete = isComplete(puzzle, state, byId);
  lastTick = performance.now();
  closePicker();
  storage.set("settings", JSON.stringify({ mode, size, difficulty, seed }));
  render();
}

function save() {
  if (state) storage.set(`game:${puzzle.id}`, JSON.stringify(state));
}

function changeSettings(changes) {
  save();
  const next = { mode, size, difficulty, seed, ...changes };
  if (next.mode === "daily") next.seed = `daily:${dayKey()}`;
  else if (changes.mode || !next.seed.startsWith("free:"))
    next.seed = newSeed();
  start(next);
  if (next.mode === "daily") history.replaceState(null, "", location.pathname);
}

function newSeed() {
  return `free:${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
}

function render() {
  document.querySelector("#eyebrow").innerHTML =
    mode === "daily"
      ? `${icon("calendar-days")} ${esc(seed.replace("daily:", "").replaceAll("-", "."))} <span>DAILY CHALLENGE</span>`
      : `${icon("shuffle")} FREE PLAY <span>${esc(seed.split(":")[1])}</span>`;
  document.querySelector("#game-title").textContent =
    mode === "daily" ? "오늘의 타입 퍼즐" : "나만의 타입 퍼즐";
  document.querySelectorAll("[data-mode]").forEach((el) => {
    const active = el.dataset.mode === mode;
    el.classList.toggle("active", active);
    el.setAttribute("aria-pressed", active);
  });
  document.querySelectorAll("[data-size]").forEach((el) => {
    const active = Number(el.dataset.size) === size;
    el.classList.toggle("active", active);
    el.setAttribute("aria-pressed", active);
  });
  document.querySelector("#difficulty").value = difficulty;
  renderBoard();
  renderPicker();
  renderStatus();
  document.querySelector("#type-count").textContent =
    `${puzzle.types.length} TYPES`;
  document.querySelector("#type-tracker-list").innerHTML = puzzle.types
    .map((t) => {
      const count = state.entries.filter((id) =>
        byId.get(id)?.types.includes(t),
      ).length;
      return `<button class="tracker-type ${highlighted === t ? "active" : ""} ${count === size ? "type-done" : ""}" data-highlight="${t}" aria-pressed="${highlighted === t}">${badge(t)}<span>${count}<span>/${size}</span></span>${count === size ? icon("check") : ""}</button>`;
    })
    .join("");
  for (const action of ["undo", "redo"])
    document.querySelector(`[data-action="${action}"]`).disabled =
      paused || complete || !state[action].length;
  const editable =
    selected >= 0 && !puzzle.givens[selected] && !paused && !complete;
  document.querySelector('[data-action="erase"]').disabled = !editable;
  const pencilButton = document.querySelector('[data-action="pencil"]');
  pencilButton.classList.toggle("active", pencil);
  pencilButton.setAttribute("aria-pressed", pencil);
  pencilButton.disabled = paused || complete;
  for (const action of ["hint", "check", "restart"])
    document.querySelector(`[data-action="${action}"]`).disabled =
      paused || complete;
  document.querySelector('[data-action="pause"]').disabled = complete;
  const pauseButton = document.querySelector('[data-action="pause"]');
  pauseButton.innerHTML = icon(paused ? "play" : "pause");
  pauseButton.setAttribute("aria-label", paused ? "계속하기" : "일시 정지");
  document.querySelector("#pause-cover").hidden = !paused;
  document.querySelector("#board").inert = paused;
  document.querySelector("#board").classList.toggle("concealed", paused);
  document.querySelector("#picker").inert = paused;
  document.querySelector("#picker").classList.toggle("paused-picker", paused);
  const banner = document.querySelector("#completion-banner");
  banner.hidden = !complete;
  banner.innerHTML = complete
    ? `<div>${icon("trophy")}<div><strong>퍼즐 완성!</strong><span>${formatTime(state.elapsedMs)} · 힌트 ${state.hints}회</span></div></div><button class="text-button" data-action="share">결과 공유 ${icon("share-2")}</button>`
    : "";
  refreshIcons();
}

function renderBoard() {
  const board = document.querySelector("#board");
  board.className = `board size-${size}`;
  board.style.setProperty("--size", size);
  board.setAttribute("aria-rowcount", size);
  board.setAttribute("aria-colcount", size);
  const conflicts = findConflicts(puzzle, state.entries, byId);
  const peers = selected >= 0 ? getPeers(puzzle, selected) : new Set();
  board.innerHTML = state.entries
    .map((id, i) => {
      const p = byId.get(id),
        given = puzzle.givens[i],
        error = conflicts.has(i) || checked.has(i);
      const r = Math.floor(i / size),
        c = i % size;
      const classes = [
        "cell",
        given && "given",
        selected === i && "selected",
        peers.has(i) && "peer",
        error && "conflict",
        (c + 1) % puzzle.boxCols === 0 && c < size - 1 && "box-right",
        (r + 1) % puzzle.boxRows === 0 && r < size - 1 && "box-bottom",
        highlighted && !p?.types.includes(highlighted) && "dimmed",
      ]
        .filter(Boolean)
        .join(" ");
      const label = `${r + 1}행 ${c + 1}열, ${p ? `${p.name}, ${p.types.map((t) => types.get(t).name).join(" ")}` : "빈 칸"}${given ? ", 고정" : ""}${error ? ", 오류" : ""}`;
      return `<button class="${classes}" role="gridcell" data-cell="${i}" aria-label="${esc(label)}" aria-selected="${selected === i}" ${given ? 'aria-readonly="true"' : ""} tabindex="${selected === i || (selected < 0 && i === 0) ? 0 : -1}">
      ${given ? `<span class="cell-lock">${icon("lock-keyhole")}</span>` : ""}
      ${
        p
          ? `${sprite(p)}<span class="cell-name">${esc(p.name)}</span><span class="cell-types">${p.types.map(badge).join("")}</span>`
          : state.notes[i].length
            ? `<span class="cell-notes">${state.notes[i].map((t) => `<span class="note-dot type-${t}" title="${esc(types.get(t).name)}">${esc(types.get(t).name)}</span>`).join("")}</span>`
            : '<span class="empty-dot"></span>'
      }
    </button>`;
    })
    .join("");
}

function renderStatus() {
  const filled = state.entries.filter((id) => id !== null).length;
  document.querySelector("#progress-label").textContent = complete
    ? "모든 타입이 제자리를 찾았어요"
    : `${size * size - filled}칸 남았어요`;
  document.querySelector("#filled-count").textContent =
    `${filled} / ${size * size}`;
  document.querySelector("#progress-fill").style.width =
    `${(filled / (size * size)) * 100}%`;
  document.querySelector("#timer").textContent = formatTime(state.elapsedMs);
}

function renderPicker() {
  const p = byId.get(state.entries[selected]);
  const editable = selected >= 0 && !puzzle.givens[selected] && !complete;
  document.querySelector("#cell-label").textContent =
    selected < 0
      ? "POKÉDEX"
      : `ROW ${Math.floor(selected / size) + 1} / COL ${(selected % size) + 1}`;
  document.querySelector("#picker-title").textContent = pencil
    ? "타입 메모"
    : selected < 0
      ? "포켓몬 도감"
      : puzzle.givens[selected]
        ? "주어진 포켓몬"
        : "포켓몬 선택";
  document.querySelector("#picker-count").textContent =
    `${catalog.pokemon.length}종`;
  document.querySelector("#selected-preview").innerHTML = p
    ? `${sprite(p)}<div><span class="dex-number">No. ${String(p.id).padStart(4, "0")}</span><strong>${esc(p.name)}</strong><div>${p.types.map(badge).join("")}</div></div>${puzzle.givens[selected] ? `<span class="given-label">${icon("lock-keyhole")}고정</span>` : ""}`
    : `<span class="preview-icon">${icon(pencil ? "pencil" : "grid-2-x2")}</span><div><strong>${selected < 0 ? "아직 선택한 칸이 없어요" : `${Math.floor(selected / size) + 1}행 ${(selected % size) + 1}열`}</strong><span class="small-muted">${selected < 0 ? "빈 칸" : pencil ? "메모 중" : "선택한 빈 칸"}</span></div>`;
  document.querySelector("#pokemon-picker").hidden = pencil;
  document.querySelector("#note-picker").hidden = !pencil;
  document.querySelector("#note-types").innerHTML = puzzle.types
    .map(
      (t) =>
        `<button class="note-type ${state.notes[selected]?.includes(t) ? "active" : ""}" data-note="${t}" aria-pressed="${!!state.notes[selected]?.includes(t)}" ${!editable || p ? "disabled" : ""}>${badge(t)}${state.notes[selected]?.includes(t) ? icon("check") : ""}</button>`,
    )
    .join("");
  document.querySelector("#type-filters").innerHTML = puzzle.types
    .map(
      (t) =>
        `<button class="filter-type ${filters.includes(t) ? "active" : ""}" data-filter="${t}" aria-label="${esc(types.get(t).name)} 타입 필터" aria-pressed="${filters.includes(t)}">${badge(t)}</button>`,
    )
    .join("");
  document.querySelector("#search").value = query;
  document.querySelector("#legal-only").checked = legalOnly;
  document.querySelector("#clear-filter").hidden = !filters.length;
  renderResults();
}

function renderResults() {
  let pool = catalog.pokemon.filter(
    (p) =>
      p.types.every((t) => puzzle.types.includes(t)) &&
      filters.every((t) => p.types.includes(t)),
  );
  if (legalOnly && selected >= 0)
    pool = pool.filter((p) =>
      canPlace(puzzle, state.entries, byId, selected, p.id),
    );
  const matches = searchPokemon(pool, query);
  document.querySelector("#result-count").textContent = `${matches.length}마리`;
  const editable =
    selected >= 0 && !puzzle.givens[selected] && !complete && !paused;
  document.querySelector("#pokemon-results").innerHTML = matches.length
    ? matches
        .map(
          (
            p,
          ) => `<button class="pokemon-choice ${state.entries[selected] === p.id ? "chosen" : ""}" data-pokemon="${p.id}" aria-label="${esc(p.name)}, ${p.types.map((t) => types.get(t).name).join(" ")}" ${!editable ? 'aria-disabled="true"' : ""}>
    ${sprite(p, "", true)}<span class="choice-name">${esc(p.name)}</span><span class="choice-types">${p.types.map(badge).join("")}</span><span class="choice-number">#${String(p.id).padStart(3, "0")}</span>
  </button>`,
        )
        .join("")
    : `<div class="empty-results">${icon("search")}<strong>일치하는 포켓몬이 없어요</strong><button class="text-button" data-action="clear-search">검색 초기화</button></div>`;
  refreshIcons();
}

function refreshIcons() {
  createIcons({ icons, attrs: { "stroke-width": 1.8 } });
}

function selectCell(index, open = false) {
  if (paused) return;
  selected = index;
  checked.clear();
  render();
  if (open && matchMedia("(max-width: 800px)").matches) {
    panelOpen = true;
    document.querySelector("#picker").classList.add("sheet-open");
    document.querySelector("#picker-backdrop").hidden = false;
    document.body.classList.add("sheet-visible");
    document.querySelector("#picker").setAttribute("role", "dialog");
    document.querySelector("#picker").setAttribute("aria-modal", "true");
    document
      .querySelectorAll(
        ".site-header,.game-heading,.game-settings,.board-section,.footer",
      )
      .forEach((el) => {
        el.inert = true;
      });
    document.querySelector('#picker [data-action="close-picker"]').focus();
  }
}

function closePicker() {
  panelOpen = false;
  document.querySelector("#picker")?.classList.remove("sheet-open");
  if (document.querySelector("#picker-backdrop"))
    document.querySelector("#picker-backdrop").hidden = true;
  document.body.classList.remove("sheet-visible");
  document.querySelector("#picker")?.removeAttribute("role");
  document.querySelector("#picker")?.removeAttribute("aria-modal");
  document
    .querySelectorAll(
      ".site-header,.game-heading,.game-settings,.board-section,.footer",
    )
    .forEach((el) => {
      el.inert = false;
    });
}

function afterMove() {
  checked.clear();
  const done = isComplete(puzzle, state, byId);
  if (done && !complete) {
    complete = true;
    saveRecord();
    closePicker();
    render();
    save();
    showCompletion();
    return;
  }
  complete = done;
  render();
  save();
}

function choosePokemon(id) {
  if (complete || paused) return;
  if (selected < 0 || puzzle.givens[selected]) {
    toast("먼저 빈 칸을 선택해 주세요.");
    return;
  }
  if (placePokemon(puzzle, state, byId, selected, id)) {
    closePicker();
    afterMove();
    if (!complete)
      document
        .querySelector(`[data-cell="${selected}"]`)
        ?.focus({ preventScroll: true });
  }
}

function handleClick(e) {
  const el = e.target.closest("button");
  if (!el) return;
  if (el.dataset.cell !== undefined) {
    selectCell(Number(el.dataset.cell), true);
    return;
  }
  if (el.dataset.pokemon) {
    choosePokemon(Number(el.dataset.pokemon));
    return;
  }
  if (el.dataset.filter) {
    const id = Number(el.dataset.filter);
    filters = filters.includes(id)
      ? filters.filter((t) => t !== id)
      : [...filters.slice(-1), id];
    renderPicker();
    refreshIcons();
    return;
  }
  if (el.dataset.note) {
    if (toggleNote(puzzle, state, selected, Number(el.dataset.note)))
      afterMove();
    return;
  }
  if (el.dataset.highlight) {
    highlighted =
      highlighted === Number(el.dataset.highlight)
        ? null
        : Number(el.dataset.highlight);
    render();
    return;
  }
  if (el.dataset.mode) {
    changeSettings({ mode: el.dataset.mode });
    return;
  }
  if (el.dataset.size) {
    changeSettings({ size: Number(el.dataset.size) });
    return;
  }
  const action = el.dataset.action;
  if (
    ["undo", "redo", "erase", "hint", "check", "pencil"].includes(action) &&
    (paused || complete)
  )
    return;
  switch (action) {
    case "undo":
      if (undo(state)) afterMove();
      break;
    case "redo":
      if (redo(state)) afterMove();
      break;
    case "erase":
      if (placePokemon(puzzle, state, byId, selected, null)) afterMove();
      break;
    case "pencil":
      pencil = !pencil;
      render();
      if (selected >= 0 && matchMedia("(max-width:800px)").matches)
        selectCell(selected, true);
      break;
    case "check":
      checked = new Set(wrongCells(puzzle, state, byId));
      render();
      toast(
        checked.size
          ? `${checked.size}칸을 다시 살펴보세요.`
          : "지금까지 채운 타입이 모두 맞아요!",
      );
      break;
    case "hint":
      giveHint();
      break;
    case "pause":
      paused = !paused;
      closePicker();
      lastTick = performance.now();
      render();
      save();
      break;
    case "help":
      showHelp();
      break;
    case "stats":
      showStats();
      break;
    case "new":
      showDialog(
        "새 퍼즐",
        `<p class="dialog-copy">현재 퍼즐은 저장됩니다.</p><button class="primary-button wide" data-action="confirm-new">${icon("shuffle")}새 자유 퍼즐 시작</button>`,
      );
      break;
    case "confirm-new":
      document.querySelector("#dialog").close();
      save();
      start({ mode: "free", size, difficulty, seed: newSeed() });
      history.replaceState(null, "", location.pathname);
      break;
    case "restart":
      showDialog(
        "처음부터 다시 풀까요?",
        `<p class="dialog-copy">입력한 포켓몬과 메모, 시간이 초기화됩니다.</p><button class="primary-button wide" data-action="confirm-restart">${icon("rotate-ccw")}처음부터 시작</button>`,
      );
      break;
    case "confirm-restart":
      document.querySelector("#dialog").close();
      start({ mode, size, difficulty, seed }, false);
      save();
      break;
    case "share":
      share();
      break;
    case "clear-filter":
      filters = [];
      renderPicker();
      break;
    case "clear-search":
      query = "";
      filters = [];
      legalOnly = false;
      renderPicker();
      break;
    case "close-picker":
      closePicker();
      document
        .querySelector(`[data-cell="${selected}"]`)
        ?.focus({ preventScroll: true });
      break;
    case "close-dialog":
      document.querySelector("#dialog").close();
      break;
    case "retry":
      location.reload();
      break;
  }
  refreshIcons();
}

function handleKey(e) {
  if (e.key === "Escape" && panelOpen) {
    closePicker();
    return;
  }
  if (document.querySelector("#dialog").open || paused) return;
  if (panelOpen && e.key === "Tab") {
    const controls = [
      ...document
        .querySelector("#picker")
        .querySelectorAll("button:not([disabled]), input"),
    ].filter((el) => el.offsetParent);
    const first = controls[0],
      last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  if (e.target.matches("input,select,textarea")) {
    if (e.target.id === "search" && e.key === "Enter")
      document.querySelector(".pokemon-choice")?.click();
    return;
  }
  if (complete) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey ? redo(state) : undo(state)) afterMove();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    if (redo(state)) afterMove();
    return;
  }
  if (
    selected >= 0 &&
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
  ) {
    e.preventDefault();
    const delta = {
      ArrowUp: -size,
      ArrowDown: size,
      ArrowLeft: -1,
      ArrowRight: 1,
    }[e.key];
    selectCell((selected + delta + size * size) % (size * size));
    document.querySelector(`[data-cell="${selected}"]`)?.focus();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    if (placePokemon(puzzle, state, byId, selected, null)) afterMove();
  }
  if (e.key.toLowerCase() === "n") {
    pencil = !pencil;
    render();
  }
}

function giveHint() {
  const wrong = wrongCells(puzzle, state, byId);
  const index =
    selected >= 0 &&
    !puzzle.givens[selected] &&
    (state.entries[selected] === null || wrong.includes(selected))
      ? selected
      : (wrong[0] ?? state.entries.findIndex((id) => id === null));
  if (index < 0) return;
  const pair = puzzle.solution[index];
  state.hints++;
  selected = index;
  placePokemon(puzzle, state, byId, index, puzzle.representatives[index]);
  afterMove();
  toast(
    `${Math.floor(index / size) + 1}행 ${(index % size) + 1}열: ${pair.map((t) => types.get(t).name).join(" + ")}`,
  );
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60),
    s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function records() {
  try {
    const value = JSON.parse(storage.get("records") || "[]");
    return Array.isArray(value)
      ? value.filter(
          (r) => r && typeof r.id === "string" && Number.isFinite(r.elapsedMs),
        )
      : [];
  } catch {
    return [];
  }
}

function saveRecord() {
  const list = records();
  if (!list.some((r) => r.id === puzzle.id)) {
    list.unshift({
      id: puzzle.id,
      mode,
      size,
      difficulty,
      elapsedMs: state.elapsedMs,
      hints: state.hints,
      date: dayKey(),
    });
    storage.set("records", JSON.stringify(list.slice(0, 200)));
  }
}

function showDialog(title, body) {
  document.querySelector("#dialog-title").textContent = title;
  document.querySelector("#dialog-body").innerHTML = body;
  refreshIcons();
  document.querySelector("#dialog").showModal();
}

function showHelp() {
  showDialog(
    "타입도쿠 규칙",
    `<div class="rule-example">${sprite(byId.get(1))}<div><strong>이상해씨</strong><div>${[12, 4].map(badge).join("")}</div></div></div>
    <ol class="rules"><li>빈 칸마다 <strong>두 타입을 가진 포켓몬</strong>을 놓습니다.</li><li>같은 가로줄, 세로줄, 굵은 선으로 나눈 구역 안에서는 <strong>어떤 타입도 두 번 나올 수 없습니다.</strong></li><li>각 줄과 구역에 이번 퍼즐의 ${puzzle.types.length}개 타입이 한 번씩 들어가면 완성입니다.</li><li>주어진 포켓몬은 바꿀 수 없습니다. 같은 타입 조합의 포켓몬은 모두 정답으로 인정합니다.</li></ol>
    <p class="dialog-copy">오늘의 퍼즐은 한국 시간 자정에 바뀝니다. 크기와 난이도가 같으면 모두 같은 문제를 받습니다.</p>
    <p class="dialog-copy">포켓몬 기본 폼 526종을 사용합니다. 지역 폼과 메가진화는 포함하지 않습니다.</p>`,
  );
}

function showStats() {
  const list = records(),
    unassisted = list.filter((r) => r.hints === 0);
  const best = unassisted
    .filter((r) => r.size === size && r.difficulty === difficulty)
    .sort((a, b) => a.elapsedMs - b.elapsedMs)[0];
  showDialog(
    "내 기록",
    `<div class="stats-row"><div><strong>${list.length}</strong><span>완성한 퍼즐</span></div><div><strong>${unassisted.length}</strong><span>힌트 없이 완성</span></div><div><strong>${best ? formatTime(best.elapsedMs) : "—"}</strong><span>${size}×${size} ${difficultyNames[difficulty]} 최고</span></div></div>
    <h3 class="history-title">최근 완성한 퍼즐</h3>${
      list.length
        ? `<div class="history-list">${list
            .slice(0, 8)
            .map(
              (r) =>
                `<div><span>${esc(r.date)}<small>${r.mode === "daily" ? "오늘의 퍼즐" : "자유 플레이"} · ${r.size}×${r.size} · ${difficultyNames[r.difficulty] || ""}</small></span><strong>${formatTime(r.elapsedMs)}<small>힌트 ${r.hints}회</small></strong></div>`,
            )
            .join("")}</div>`
        : '<p class="dialog-copy">첫 번째 완성을 기다리고 있어요.</p>'
    }`,
  );
}

function showCompletion() {
  showDialog(
    "퍼즐 완성!",
    `<div class="completion-art">${sprite(byId.get(6))}${icon("trophy")}${sprite(byId.get(1))}</div><p class="completion-message">모든 타입이 제자리를 찾았어요.</p><div class="stats-row"><div><strong>${formatTime(state.elapsedMs)}</strong><span>완주 시간</span></div><div><strong>${state.hints}</strong><span>사용한 힌트</span></div><div><strong>${size}×${size}</strong><span>${difficultyNames[difficulty]}</span></div></div><button class="primary-button wide" data-action="share">${icon("share-2")}결과 공유</button>`,
  );
}

async function share() {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("size", String(size));
  url.searchParams.set("level", difficulty);
  url.searchParams.set("seed", seed);
  const text = `타입도쿠 ${mode === "daily" ? seed.replace("daily:", "") : "자유 퍼즐"}\n${size}×${size} · ${difficultyNames[difficulty]}\n${formatTime(state.elapsedMs)} · 힌트 ${state.hints}회\n${url.href}`;
  try {
    if (navigator.share && matchMedia("(max-width:800px)").matches)
      await navigator.share({ title: "타입도쿠", text });
    else {
      await navigator.clipboard.writeText(text);
      toast("결과와 퍼즐 링크를 복사했어요.");
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    showDialog(
      "결과 공유",
      `<textarea class="share-text" readonly aria-label="공유할 결과">${esc(text)}</textarea>`,
    );
    document.querySelector(".share-text").select();
  }
}

function toast(message) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove("visible"), 3500);
}

async function boot() {
  app.innerHTML =
    '<div class="loading-screen"><span class="loading-spinner"></span><strong>퍼즐을 준비하고 있어요</strong></div>';
  try {
    [catalog, pack] = await Promise.all(
      ["catalog.json", "puzzles.json"].map(async (path) => {
        const response = await fetch(asset(path));
        if (!response.ok) throw new Error(`Data: ${response.status}`);
        return response.json();
      }),
    );
    byId = new Map(catalog.pokemon.map((p) => [p.id, p]));
    types = new Map(catalog.types.map((t) => [t.id, t]));
    let settings = {
      mode: "daily",
      size: 6,
      difficulty: "normal",
      seed: `daily:${dayKey()}`,
    };
    try {
      const saved = JSON.parse(storage.get("settings"));
      if (
        saved &&
        [4, 6, 9].includes(saved.size) &&
        difficultyNames[saved.difficulty] &&
        ["daily", "free"].includes(saved.mode) &&
        typeof saved.seed === "string"
      )
        settings = saved;
    } catch {}
    if (settings.mode === "daily") settings.seed = `daily:${dayKey()}`;
    const params = new URLSearchParams(location.search),
      sharedSeed = params.get("seed");
    if (
      sharedSeed &&
      /^(daily:\d{4}-\d{2}-\d{2}|free:[a-z0-9]{1,20})$/.test(sharedSeed)
    ) {
      settings = {
        mode: sharedSeed.startsWith("daily:") ? "daily" : "free",
        seed: sharedSeed,
        size: [4, 6, 9].includes(Number(params.get("size")))
          ? Number(params.get("size"))
          : 6,
        difficulty: difficultyNames[params.get("level")]
          ? params.get("level")
          : "normal",
      };
    }
    mount();
    start(settings);
    setInterval(() => {
      const now = performance.now(),
        delta = now - lastTick;
      lastTick = now;
      if (!paused && !complete && !document.hidden) {
        state.elapsedMs += Math.min(delta, 2000);
        renderStatus();
      }
    }, 1000);
    setInterval(save, 5000);
  } catch (error) {
    console.error(error);
    app.innerHTML =
      '<div class="loading-screen"><h1>게임을 불러오지 못했어요</h1><p>연결을 확인하고 다시 시도해 주세요.</p><button class="primary-button" id="retry">다시 시도</button></div>';
    document.querySelector("#retry").onclick = () => location.reload();
  }
}
boot();
