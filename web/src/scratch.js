import {
  createIcons,
  TreePalm,
  Languages,
  CircleHelp,
  ChartNoAxesColumn,
  CalendarDays,
  Eraser,
  Search,
  ArrowRight,
  RotateCw,
  Share2,
  Trophy,
  Eye,
  X,
  Check,
  ChevronDown,
  ImageOff,
} from "lucide";
import {
  createScratch,
  SIZE,
  COUNT,
  dayKey,
  settingsFromSearch,
  challengeKey,
  storageKey,
  restoreRound,
  serializeRound,
  current,
  isEnded,
  totalScore,
  area,
  potentialScore,
  erase,
  guess,
  giveUp,
  advance,
  searchCandidates,
  validSeed,
  rankFor,
} from "./scratch-engine.js";
import { siteBrand, languagePicker } from "./site-brand.js";
import { t, getLanguage, initLanguage } from "./i18n.js";
import { trainerResultKey } from "./trainers.js";
import {
  trainerBadge,
  trainerTaunt,
  rankName,
  onTrainerImageError,
} from "./trainer-results.js";
import "./style.css";
import "./scratch.css";
import "./game-resort.css";

const icons = {
  TreePalm,
  Languages,
  CircleHelp,
  ChartNoAxesColumn,
  CalendarDays,
  Eraser,
  Search,
  ArrowRight,
  RotateCw,
  Share2,
  Trophy,
  Eye,
  X,
  Check,
  ChevronDown,
  ImageOff,
};
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const tool = (action, label, glyph) =>
  `<button class="icon-button" data-action="${action}" aria-label="${esc(t(label))}" data-tooltip="${esc(t(label))}">${icon(glyph)}</button>`;
const app = document.querySelector("#app"),
  imageCache = new Map();
let catalog,
  game,
  settings,
  round,
  controller,
  epoch = 0,
  saveTimer,
  brush = 16,
  ready = false,
  query = "",
  matches = [],
  activeOption = -1,
  composing = false,
  feedback = "",
  warning = false,
  dialogKind = null,
  shareText = "",
  returnAction = null,
  cursor = [SIZE / 2, SIZE / 2];
const name = (p) => (getLanguage() === "en" ? p.english : p.name);
const target = () => game.byId.get(current(round).id);
const trainerKey = (
  challenge = challengeKey(settings),
  score = totalScore(round),
) => trainerResultKey("scratch", challenge, score);
const recordsKey = () => `scratch:${game.version}:records`;
const sprite = (p) =>
  `<img class="sc-sprite" src="${catalog.images[p.image]}" alt="" width="64" height="64" draggable="false" />`;
function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    warning = true;
    const el = document.querySelector("#sc-save-warning");
    if (el) el.hidden = false;
  }
}
function records() {
  try {
    const rows = JSON.parse(read(recordsKey()));
    return Array.isArray(rows)
      ? rows
          .filter(
            (r) =>
              r &&
              typeof r.challenge === "string" &&
              ["daily", "practice"].includes(r.mode) &&
              /^\d{4}-\d{2}-\d{2}$/.test(r.day) &&
              rankFor(r.score),
          )
          .slice(0, 365)
      : [];
  } catch {
    return [];
  }
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!round) return;
  save(storageKey(game, settings), serializeRound(round));
  if (isEnded(round)) {
    const record = {
      challenge: challengeKey(settings),
      mode: settings.mode,
      day: settings.day || dayKey(),
      score: totalScore(round),
    };
    save(
      recordsKey(),
      JSON.stringify(
        [
          record,
          ...records().filter((r) => r.challenge !== record.challenge),
        ].slice(0, 365),
      ),
    );
  }
}
const scheduleSave = () => {
  if (!saveTimer) saveTimer = setTimeout(persist, 250);
};
function loadImage(p) {
  if (!imageCache.has(p.image))
    imageCache.set(
      p.image,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const [x, y, w, h] = p.crop;
          if (x + w > img.naturalWidth || y + h > img.naturalHeight)
            reject(new Error("Invalid crop"));
          else resolve(img);
        };
        img.onerror = () => reject(new Error("Image loading failed"));
        img.src = catalog.images[p.image];
      }).catch((e) => {
        imageCache.delete(p.image);
        throw e;
      }),
    );
  return imageCache.get(p.image);
}
function live() {
  const item = current(round),
    percentage = (100 * item.erased) / area(target());
  document.querySelector("#sc-points").textContent = item.outcome
    ? item.points
    : potentialScore(item.erased, area(target()), item.guesses.length);
  document.querySelector("#sc-erased").textContent =
    `${percentage.toFixed(1)}%`;
  document.querySelector("#sc-mistakes").textContent =
    item.guesses.length - (item.outcome === "solved" ? 1 : 0);
  document.querySelector("#sc-total").textContent = totalScore(round);
}
function setControls() {
  const locked = !ready || !!current(round).outcome;
  for (const selector of ["#sc-input", "#sc-submit", "#sc-brush"])
    document.querySelector(selector).disabled = locked;
  document
    .querySelector("#sc-mask")
    .setAttribute("aria-disabled", String(locked));
}
async function mount() {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal,
    token = ++epoch;
  const on = (el, event, listener, options = {}) =>
    el.addEventListener(event, listener, { ...options, signal });
  ready = false;
  composing = false;
  const item = current(round),
    p = target();
  app.innerHTML = `<header class="site-header"><div class="header-inner">${siteBrand()}<nav class="header-actions" aria-label="${t("게임 메뉴")}">${languagePicker()}${tool("stats", "내 기록", "chart-no-axes-column")}${tool("help", "게임 규칙", "circle-help")}</nav></div></header>
  <main class="main sc-main resort-main">
    <div id="sc-new-day" class="sc-day-banner" hidden><span>${t("새로운 오늘의 그림이 열렸어요.")}</span><button class="text-button" data-action="daily">${t("오늘의 문제")}${icon("arrow-right")}</button></div>
    <section class="sc-heading resort-heading"><div><p class="eyebrow">${icon("calendar-days")}${settings.mode === "daily" ? esc(settings.day.replaceAll("-", ".")) : t("연습")}</p><h1>${t("포케 스크래치")}</h1></div><div class="segmented" role="group" aria-label="${t("게임 모드")}">${["daily", "practice"].map((mode) => `<button data-action="${mode}" class="${mode === settings.mode ? "active" : ""}" aria-pressed="${mode === settings.mode}">${t(mode === "daily" ? "데일리" : "연습")}</button>`).join("")}</div></section>
    <div class="sc-set-bar"><ol class="sc-steps" aria-label="${t("문제 진행")}">${round.items.map((it, i) => `<li class="${i === round.index ? "current" : ""} ${it.outcome || ""}" ${i === round.index ? 'aria-current="step"' : ""} aria-label="${esc(t("{count}번째 그림", { count: i + 1 }))}${it.outcome ? ` · ${t(it.outcome === "solved" ? "정답" : "포기")}` : ""}">${it.outcome ? icon(it.outcome === "solved" ? "check" : "x") : i + 1}</li>`).join("")}</ol><span class="sc-total-label">${t("합계")} <strong id="sc-total"></strong><span>/ 500</span></span></div>
    <p class="sc-warning" id="sc-save-warning" role="status" ${warning ? "" : "hidden"}>${t("브라우저 저장 공간을 사용할 수 없어 진행 상황이 저장되지 않습니다.")}</p>
    <section class="sc-play" aria-label="${t("그림 추리")}"><div class="sc-picture-column">
      <div id="sc-surface" class="sc-surface ${item.outcome ? "is-revealed" : ""}"><canvas id="sc-picture" width="256" height="256" aria-hidden="true"></canvas><canvas id="sc-mask" width="256" height="256" tabindex="${item.outcome ? -1 : 0}" role="group" aria-label="${t("스크래치 보드")}"></canvas><span id="sc-cursor" aria-hidden="true" hidden></span><div id="sc-loading" class="sc-loading"><span class="loading-spinner"></span></div><div id="sc-art-error" class="sc-art-error" hidden>${icon("image-off")}<p>${t("그림을 불러오지 못했어요.")}</p><button class="text-button" data-action="retry-image">${icon("rotate-cw")}${t("다시 시도")}</button></div></div>
      <div class="sc-brush-tools"><label for="sc-brush">${icon("eraser")}<span>${t("지우개 크기")}</span></label><input id="sc-brush" type="range" min="4" max="32" step="2" value="${brush}" /><output id="sc-brush-value" for="sc-brush">${brush}</output></div>
    </div><div class="sc-answer-column"><div class="sc-question-line"><span>${t("{count}번째 그림", { count: round.index + 1 })}</span><span>${round.index + 1} / ${COUNT}</span></div>
      <h2 id="sc-question">${item.outcome ? esc(name(p)) : t("어떤 포켓몬일까요?")}</h2>
      <div class="sc-scoreboard"><div class="sc-score"><span>${t(item.outcome ? "획득 점수" : "현재 점수")}</span><strong><span id="sc-points"></span><small>${t("점")}</small></strong></div><dl><div><dt>${t("지운 면적")}</dt><dd id="sc-erased"></dd></div><div><dt>${t("오답")}</dt><dd id="sc-mistakes"></dd></div></dl></div>
      <form id="sc-form" autocomplete="off" ${item.outcome ? "hidden" : ""}><div class="sc-search"><label>${icon("search")}<input id="sc-input" type="search" role="combobox" aria-label="${t("포켓몬 이름 또는 도감 번호")}" aria-controls="sc-options" aria-autocomplete="list" aria-expanded="false" value="${esc(query)}" spellcheck="false" autocomplete="off" /></label><button id="sc-submit" class="primary-button" aria-label="${t("추측 제출")}">${icon("arrow-right")}</button></div><ul id="sc-options" role="listbox" aria-label="${t("검색 결과")}" hidden></ul></form>
      <p id="sc-feedback" class="sc-feedback ${item.outcome === "solved" ? "correct" : ""}" role="status" aria-live="polite">${item.outcome ? t(item.outcome === "solved" ? "정답이에요!" : "이번 그림은 넘겼어요.") : t(feedback)}</p>
      ${item.outcome ? `<button class="primary-button sc-next" id="sc-next" data-action="${isEnded(round) ? "result" : "next"}">${t(isEnded(round) ? "결과 보기" : "다음 그림")}${icon(isEnded(round) ? "trophy" : "arrow-right")}</button>` : `<button class="text-button sc-give-up" data-action="give-up">${icon("eye")}${t("정답 공개")}</button>`}
      <div class="sc-guesses" ${item.guesses.length ? "" : "hidden"}><h3>${t("추측 기록")} <span>${item.guesses.length}</span></h3><ol>${[
        ...item.guesses,
      ]
        .reverse()
        .map(
          (id) =>
            `<li>${icon(game.byId.get(id).art === p.art ? "check" : "x")}<span>${esc(name(game.byId.get(id)))}</span></li>`,
        )
        .join("")}</ol></div>
    </div></section>
    ${isEnded(round) ? `<section class="sc-results"><h2>${t("도전 결과")}</h2><ol>${round.items.map((it, i) => `<li>${sprite(game.byId.get(it.id))}<div><span>${i + 1}. ${esc(name(game.byId.get(it.id)))}</span><small>${t("공개 {percent}% · 오답 {count}회", { percent: ((100 * it.erased) / area(game.byId.get(it.id))).toFixed(1), count: it.guesses.length - (it.outcome === "solved" ? 1 : 0) })}</small></div><strong>${it.points}<small>${t("점")}</small></strong></li>`).join("")}</ol></section>` : ""}
    <div class="sc-bottom"><button class="text-button" data-action="new-practice">${icon("rotate-cw")}${t("새 연습")}</button><span id="sc-countdown"></span></div>
    <footer class="footer"><span>${t("포케 스크래치")} <span class="footer-dot">·</span> ${t("비공식 팬 게임")}</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">${t("데이터 · PokéAPI")} ${icon("arrow-right")}</a></footer>
  </main><dialog id="sc-dialog" aria-labelledby="sc-dialog-title"><div class="dialog-header"><h2 id="sc-dialog-title"></h2>${tool("close-dialog", "닫기", "x")}</div><div id="sc-dialog-body"></div></dialog>`;
  createIcons({ icons, attrs: { "stroke-width": 1.8 } });
  live();
  setControls();
  tick();
  on(app, "click", onClick);
  on(app, "error", onTrainerImageError, { capture: true });
  on(document.querySelector("#sc-input"), "input", (e) => {
    query = e.target.value;
    activeOption = -1;
    search();
  });
  on(document.querySelector("#sc-input"), "keydown", searchKey);
  on(document.querySelector("#sc-input"), "compositionstart", () => {
    composing = true;
  });
  on(document.querySelector("#sc-input"), "compositionend", () => {
    composing = false;
  });
  on(document.querySelector("#sc-form"), "submit", (e) => {
    e.preventDefault();
    if (!composing) submitSearch();
  });
  on(document, "pointerdown", (e) => {
    if (!e.target.closest("#sc-form")) closeSearch();
  });
  on(document.querySelector("#sc-form"), "focusout", (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) closeSearch();
  });
  on(document.querySelector("#sc-brush"), "input", (e) => {
    brush = Number(e.target.value);
    document.querySelector("#sc-brush-value").textContent = brush;
    save("scratch:brush", String(brush));
    showCursor(cursor);
  });
  on(document.querySelector("#sc-dialog"), "close", () => {
    dialogKind = null;
    const button =
      returnAction && document.querySelector(`[data-action="${returnAction}"]`);
    (
      button || document.querySelector(item.outcome ? "#sc-next" : "#sc-input")
    )?.focus({ preventScroll: true });
  });
  on(window, "popstate", () => start(settingsFromSearch(location.search)));
  on(window, "pagehide", persist);
  on(document, "visibilitychange", () => {
    persist();
    tick();
  });
  if (dialogKind) dialog(dialogKind);
  try {
    const img = await loadImage(p);
    if (token !== epoch) return;
    document
      .querySelector("#sc-picture")
      .getContext("2d").imageSmoothingEnabled = false;
    document
      .querySelector("#sc-picture")
      .getContext("2d")
      .drawImage(img, ...p.crop, ...p.frame);
    bindCanvas(on);
    ready = true;
    document.querySelector("#sc-loading").hidden = true;
    setControls();
  } catch {
    if (token !== epoch) return;
    document.querySelector("#sc-loading").hidden = true;
    document.querySelector("#sc-art-error").hidden = false;
  }
}
function showCursor(point) {
  const el = document.querySelector("#sc-cursor");
  el.style.left = `${(point[0] / SIZE) * 100}%`;
  el.style.top = `${(point[1] / SIZE) * 100}%`;
  el.style.width = el.style.height = `${((2 * brush) / SIZE) * 100}%`;
}
function bindCanvas(on) {
  const canvas = document.querySelector("#sc-mask"),
    ctx = canvas.getContext("2d"),
    overlay = ctx.createImageData(SIZE, SIZE),
    item = current(round),
    [x, y, w, h] = target().frame;
  // Use position-only sand colors; the saved mask remains the sole alpha source.
  for (let py = y; py < y + h; py++)
    for (let px = x; px < x + w; px++) {
      const i = py * SIZE + px,
        offset = i * 4,
        grain =
          ((Math.imul(px + 1, 374761393) ^ Math.imul(py + 1, 668265263)) >>> 0) %
            17 -
          8,
        ripple = Math.round(3 * Math.sin(py / 9 + Math.sin(px / 28)));
      overlay.data.set(
        [
          233 + grain + ripple,
          215 + grain + ripple,
          177 + grain + ripple,
          item.mask[i] || item.outcome ? 0 : 255,
        ],
        offset,
      );
    }
  ctx.putImageData(overlay, 0, 0);
  const pointer = document.querySelector("#sc-cursor");
  let held = null,
    last = null;
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * SIZE,
      ((e.clientY - r.top) / r.height) * SIZE,
    ];
  };
  const stroke = (from, to) => {
    if (!ready) return;
    const changed = erase(round, game, from, to, brush);
    if (!changed.length) return;
    for (const i of changed) overlay.data[i * 4 + 3] = 0;
    ctx.putImageData(overlay, 0, 0);
    live();
    scheduleSave();
  };
  on(canvas, "pointerdown", (e) => {
    if (!ready || item.outcome || !e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    held = e.pointerId;
    last = cursor = point(e);
    showCursor(cursor);
    pointer.hidden = e.pointerType === "touch";
    stroke(last, last);
  });
  on(canvas, "pointermove", (e) => {
    if (item.outcome) return;
    cursor = point(e);
    showCursor(cursor);
    pointer.hidden = e.pointerType === "touch";
    if (held === e.pointerId) {
      stroke(last, cursor);
      last = cursor;
    }
  });
  const stop = (e) => {
    if (held !== e.pointerId) return;
    held = null;
    last = null;
    persist();
  };
  on(canvas, "pointerup", stop);
  on(canvas, "pointercancel", stop);
  on(canvas, "lostpointercapture", stop);
  on(canvas, "pointerleave", () => {
    if (held === null) pointer.hidden = true;
  });
  on(canvas, "focus", () => {
    if (!item.outcome) {
      showCursor(cursor);
      pointer.hidden = false;
    }
  });
  on(canvas, "blur", () => {
    pointer.hidden = true;
  });
  on(document, "keydown", (e) => {
    if (
      !ready ||
      item.outcome ||
      e.defaultPrevented ||
      e.ctrlKey ||
      e.altKey ||
      e.metaKey
    )
      return;
    const focused = document.activeElement === canvas;
    const hovering =
      canvas.matches(":hover") && document.activeElement === document.body;
    if (!focused && !(hovering && [" ", "Enter"].includes(e.key))) return;
    if (
      document.querySelector(
        'dialog[open], [data-language-trigger][aria-expanded="true"]',
      )
    )
      return;
    const directions = {
      ArrowLeft: [-8, 0],
      ArrowRight: [8, 0],
      ArrowUp: [0, -8],
      ArrowDown: [0, 8],
    };
    if (directions[e.key]) {
      e.preventDefault();
      cursor = cursor.map((v, i) =>
        Math.max(0, Math.min(SIZE, v + directions[e.key][i])),
      );
      showCursor(cursor);
      pointer.hidden = false;
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      stroke(cursor, cursor);
      persist();
    }
  });
}
function closeSearch() {
  document.querySelector("#sc-options").hidden = true;
  document.querySelector("#sc-input").setAttribute("aria-expanded", "false");
  document.querySelector("#sc-input").removeAttribute("aria-activedescendant");
}
function search() {
  matches = query.trim() ? searchCandidates(game, query).slice(0, 12) : [];
  const list = document.querySelector("#sc-options"),
    input = document.querySelector("#sc-input");
  list.innerHTML = matches
    .map(
      (p, i) =>
        `<li role="option" id="sc-option-${i}" aria-selected="${i === activeOption}"><button type="button" data-guess="${p.id}" tabindex="-1"><span>${esc(name(p))}</span><small>#${String(p.speciesId).padStart(3, "0")}</small></button></li>`,
    )
    .join("");
  list.hidden = !matches.length;
  input.setAttribute("aria-expanded", String(!!matches.length));
  if (activeOption >= 0 && matches[activeOption]) {
    input.setAttribute("aria-activedescendant", `sc-option-${activeOption}`);
    document
      .querySelector(`#sc-option-${activeOption}`)
      .scrollIntoView({ block: "nearest" });
  } else input.removeAttribute("aria-activedescendant");
}
function searchKey(e) {
  if (e.isComposing || composing || e.keyCode === 229) {
    if (e.key === "Enter") e.preventDefault();
    return;
  }
  if (["ArrowDown", "ArrowUp"].includes(e.key) && matches.length) {
    e.preventDefault();
    activeOption =
      (activeOption + (e.key === "ArrowDown" ? 1 : -1) + matches.length) %
      matches.length;
    search();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeSearch();
    activeOption = -1;
  }
}
function submitSearch() {
  const exact = matches.filter((p) =>
    [p.name, p.english, p.key, String(p.speciesId)].some(
      (n) => n.toLowerCase() === query.trim().toLowerCase(),
    ),
  );
  const p =
    matches[activeOption] ||
    (exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null);
  if (p) submit(p.id);
  else {
    feedback = "목록에서 포켓몬을 선택해 주세요.";
    document.querySelector("#sc-feedback").textContent = t(feedback);
  }
}
async function submit(id) {
  if (!ready) return;
  const status = guess(round, game, id);
  if (status === "locked" || status === "invalid") return;
  feedback =
    status === "duplicate"
      ? "이미 추측한 포켓몬이에요."
      : status === "incorrect"
        ? "아니에요. 오답 1회, 5점 감점!"
        : "";
  query = "";
  matches = [];
  activeOption = -1;
  persist();
  await mount();
  if (status === "correct" && isEnded(round)) dialog("result");
  else
    document
      .querySelector(current(round).outcome ? "#sc-next" : "#sc-input")
      ?.focus({ preventScroll: true });
}
async function start(next, navigate = false) {
  persist();
  dialogKind = null;
  settings = next;
  query = "";
  matches = [];
  activeOption = -1;
  feedback = "";
  cursor = [128, 128];
  if (next.mode === "practice") save("scratch:last-practice", next.seed);
  if (navigate) {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    if (next.mode === "practice") {
      url.searchParams.set("mode", "practice");
      url.searchParams.set("seed", next.seed);
    } else if (next.day !== dayKey()) url.searchParams.set("date", next.day);
    history.pushState(null, "", url);
  }
  round = restoreRound(read(storageKey(game, settings)), game, settings);
  persist();
  await mount();
}
const freshPractice = () =>
  start({ mode: "practice", seed: crypto.randomUUID() }, true);
async function onClick(e) {
  const button = e.target.closest("button");
  if (!button || button.disabled) return;
  if (button.dataset.guess) return submit(Number(button.dataset.guess));
  const action = button.dataset.action;
  if (action === "daily") return start({ mode: "daily", day: dayKey() }, true);
  if (action === "practice") {
    if (settings.mode === "practice") return;
    const seed = read("scratch:last-practice");
    return validSeed(seed)
      ? start({ mode: "practice", seed }, true)
      : freshPractice();
  }
  if (action === "new-practice")
    return settings.mode === "practice" &&
      !isEnded(round) &&
      (round.index ||
        current(round).erased ||
        current(round).guesses.length ||
        current(round).outcome)
      ? dialog("practice-confirm")
      : freshPractice();
  if (action === "start-practice") return freshPractice();
  if (action === "next" && advance(round)) {
    query = "";
    feedback = "";
    cursor = [128, 128];
    persist();
    await mount();
    document.querySelector("#sc-mask").focus({ preventScroll: true });
  } else if (action === "reveal") {
    giveUp(round);
    persist();
    dialogKind = null;
    await mount();
    if (isEnded(round)) dialog("result");
    else document.querySelector("#sc-next").focus({ preventScroll: true });
  } else if (action === "close-dialog")
    document.querySelector("#sc-dialog").close();
  else if (["help", "stats", "result", "give-up"].includes(action))
    dialog(action);
  else if (action === "retry-image") {
    imageCache.delete(target().image);
    await mount();
  } else if (action === "share") await share();
}
function dialog(kind) {
  if (kind === "result" && !isEnded(round)) return;
  if (!dialogKind)
    returnAction = document.activeElement?.dataset.action || null;
  dialogKind = kind;
  const el = document.querySelector("#sc-dialog");
  let title, body;
  if (kind === "give-up") {
    title = "정답을 공개할까요?";
    body = `<p class="dialog-copy">${t("이 그림은 0점으로 마무리하고 다음 그림으로 넘어갈 수 있어요.")}</p><div class="sc-dialog-actions"><button class="text-button" data-action="close-dialog">${t("취소")}</button><button class="primary-button" data-action="reveal">${icon("eye")}${t("정답 공개")}</button></div>`;
  } else if (kind === "practice-confirm") {
    title = "새 연습을 시작할까요?";
    body = `<div class="sc-dialog-actions"><button class="text-button" data-action="close-dialog">${t("취소")}</button><button class="primary-button" data-action="start-practice">${icon("rotate-cw")}${t("새 연습 시작")}</button></div>`;
  } else if (kind === "help") {
    title = "포케 스크래치 규칙";
    body = `<ul class="rules"><li>${t("가림막 뒤에는 어떤 포켓몬이 숨어있을까요? 마우스나 손가락으로 문지르거나, 커서를 올린 뒤 Space 또는 Enter로 지울 수 있어요.")}</li><li>${t("퀴즈 한 세트는 총 5개의 문제로 구성되며, 각 문제마다 100점의 점수가 배정됩니다.")}</li><li>${t("가림막을 긁어낼수록 점수가 더 낮아집니다!")}</li><li>${t("연습 모드를 통해 더 많은 퀴즈를 즐겨보세요!")}</li></ul><p class="dialog-copy">${t("데일리 문제는 한국 시간 자정에 변경됩니다.")}</p>`;
  } else if (kind === "result") {
    title = "도전 결과";
    const score = totalScore(round),
      rank = rankFor(score);
    body = `<div class="sc-award">${trainerBadge(rank, "", trainerKey())}<p class="sc-final-score">${score}<small>/ 500</small></p>${trainerTaunt(rank)}<p>${t("{count}마리 정답", { count: round.items.filter((it) => it.outcome === "solved").length })}</p></div><div class="sc-dialog-actions"><button class="primary-button" data-action="share">${icon("share-2")}${t("결과 공유")}</button><button class="text-button" data-action="close-dialog">${t("계속 보기")}${icon("arrow-right")}</button></div>`;
  } else if (kind === "stats") {
    title = "내 기록";
    const list = records().filter((r) => r.mode === settings.mode);
    body = `<div class="sc-record-summary"><span>${t(settings.mode === "daily" ? "데일리" : "연습")}</span><strong>${t("최고 {score}점", { score: Math.max(0, ...list.map((r) => r.score)) })}</strong></div><div class="sc-records">${
      list
        .slice(0, 10)
        .map(
          (r) =>
            `<div><span>${esc(r.day)}</span>${trainerBadge(rankFor(r.score), "", trainerKey(r.challenge, r.score))}<strong>${r.score}</strong></div>`,
        )
        .join("") ||
      `<p class="dialog-copy">${t("아직 완료한 도전이 없어요.")}</p>`
    }</div>`;
  } else {
    title = "결과 공유";
    body = `<textarea class="share-text" aria-label="${t("결과 공유")}" readonly>${esc(shareText)}</textarea>`;
  }
  document.querySelector("#sc-dialog-title").textContent = t(title);
  document.querySelector("#sc-dialog-body").innerHTML = body;
  createIcons({ icons, attrs: { "stroke-width": 1.8 } });
  if (!el.open) el.showModal();
}
async function share() {
  if (!isEnded(round)) return;
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  if (settings.mode === "practice") {
    url.searchParams.set("mode", "practice");
    url.searchParams.set("seed", settings.seed);
  } else url.searchParams.set("date", settings.day);
  const score = totalScore(round);
  shareText = `${t("포케 스크래치")} · ${t(settings.mode === "daily" ? "데일리" : "연습")}\n${rankName(rankFor(score), trainerKey())} · ${score}/500\n${round.items.map((it) => it.points).join(" · ")}\n${url.href}`;
  try {
    if (navigator.share && matchMedia("(max-width:640px)").matches)
      await navigator.share({ title: t("포케 스크래치"), text: shareText });
    else {
      await navigator.clipboard.writeText(shareText);
      document.querySelector("#sc-dialog-title").textContent =
        t("결과를 복사했어요.");
    }
  } catch (e) {
    if (e.name !== "AbortError") dialog("share");
  }
}
function tick() {
  if (!round || !document.querySelector("#sc-new-day")) return;
  const today = dayKey();
  document.querySelector("#sc-new-day").hidden =
    settings.mode !== "daily" || settings.day === today;
  const seconds = Math.max(
    0,
    Math.ceil(
      (Date.parse(`${today}T00:00:00+09:00`) + 86400000 - Date.now()) / 1000,
    ),
  );
  document.querySelector("#sc-countdown").textContent =
    settings.mode === "daily"
      ? t("다음 문제 {time}", {
          time: [
            Math.floor(seconds / 3600),
            Math.floor((seconds % 3600) / 60),
            seconds % 60,
          ]
            .map((n) => String(n).padStart(2, "0"))
            .join(":"),
        })
      : "";
}
async function boot() {
  app.innerHTML = `<div class="loading-screen"><span class="loading-spinner"></span><strong>${t("오늘의 그림을 준비하고 있어요")}</strong></div>`;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}pokemantle.json`, {
      cache: "no-cache",
    });
    if (!response.ok) throw new Error("Catalog loading failed");
    catalog = await response.json();
    const data = await fetch(`${import.meta.env.BASE_URL}scratch.json`, {
      cache: "no-cache",
    });
    if (!data.ok) throw new Error("Scratch loading failed");
    game = createScratch(catalog, await data.json());
    const savedBrush = Number(read("scratch:brush"));
    if (
      Number.isInteger(savedBrush) &&
      savedBrush >= 4 &&
      savedBrush <= 32 &&
      savedBrush % 2 === 0
    )
      brush = savedBrush;
    await start(settingsFromSearch(location.search));
    setInterval(tick, 1000);
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="loading-screen"><h1>${t("게임을 불러오지 못했어요")}</h1><p>${t("연결을 확인하고 다시 시도해 주세요.")}</p><button class="primary-button" id="sc-retry">${t("다시 시도")}</button><a class="text-button" href="./">${t("게임 목록으로")}</a></div>`;
    document.querySelector("#sc-retry").onclick = () => location.reload();
  }
}
initLanguage("포케 스크래치 | 포켓몬 퀴즈", () => {
  if (round) {
    persist();
    mount();
  }
});
boot();
