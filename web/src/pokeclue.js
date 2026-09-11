import {
  createIcons,
  Gamepad2,
  Languages,
  CircleHelp,
  ChartNoAxesColumn,
  Search,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Check,
  Minus,
  X,
  Flag,
  Share2,
  RotateCw,
  CalendarDays,
  ChevronDown,
  Sparkles,
  ImageOff,
  Fingerprint,
  Trophy,
} from "lucide";
import {
  createClueGame,
  comparePokemon,
  answerKey,
  settingsFromSearch,
  validSeed,
  storageKey,
  restoreRound,
  submitGuess,
  isWon,
  isEnded,
  shareGrid,
  dayKey,
  searchForms,
  GUESS_RANKS,
  rankFor,
  FIELDS,
} from "./clue-engine.js";
import { siteBrand, languagePicker } from "./site-brand.js";
import { t, initLanguage, getLanguage, pokemonName, typeName } from "./i18n.js";
import "./style.css";
import "./pokeclue.css";

const icons = {
  Gamepad2,
  Languages,
  CircleHelp,
  ChartNoAxesColumn,
  Search,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Check,
  Minus,
  X,
  Flag,
  Share2,
  RotateCw,
  CalendarDays,
  ChevronDown,
  Sparkles,
  ImageOff,
  Fingerprint,
  Trophy,
};
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
const tool = (action, label, glyph) =>
  `<button class="icon-button" data-action="${action}" aria-label="${t(label)}" data-tooltip="${t(label)}">${icon(glyph)}</button>`;
const app = document.querySelector("#app");
const asset = (path) => `${import.meta.env.BASE_URL}${path}`;
const typeImages = import.meta.glob("./assets/types/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
});
const labels = {
  types: "타입",
  abilities: "특성",
  eggGroups: "알 그룹",
  evolution: "진화",
  generation: "세대",
  bst: "종족값 합계",
};
const stateLabels = {
  match: "일치",
  partial: "일부 일치",
  miss: "불일치",
  unknown: "미확인",
};
const stateIcons = {
  match: "check",
  partial: "minus",
  miss: "x",
  unknown: "circle-help",
};
let catalog, clues, game, settings, round, types, abilities, eggs, controller;
let matches = [],
  active = -1,
  limit = 30,
  toastTimer,
  storageWarning = false;
const refreshIcons = () =>
  createIcons({ icons, attrs: { "stroke-width": 1.8 } });
const finished = () => isEnded(round, game);
const rankName = (rank) =>
  t(GUESS_RANKS.find((tier) => tier.rank === rank).label);
const localName = (item) =>
  getLanguage() === "ko" ? item.name || item.english : item.english;
const sprite = (p) =>
  p.image && catalog.images[p.image]
    ? `<img class="cq-sprite" src="${catalog.images[p.image]}" alt="" width="64" height="64" draggable="false" />`
    : `<span class="cq-sprite cq-no-image" role="img" aria-label="${t("이미지 미제공")}">${icon("image-off")}</span>`;
const typeMarkup = (ids) =>
  `<span class="cq-types">${ids
    .map((id) => {
      const type = types.get(id);
      return type
        ? `<img src="${typeImages[`./assets/types/${type.key}.svg`]}" alt="${esc(t("{type} 타입", { type: typeName(type) }))}" title="${esc(typeName(type))}" width="24" height="24" />`
        : icon("circle-help");
    })
    .join("")}</span>`;
function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    storageWarning = true;
    const warning = document.querySelector("#cq-save-warning");
    if (warning) warning.hidden = false;
  }
}
function toast(message) {
  const el = document.querySelector("#cq-toast");
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.textContent = "";
  }, 3500);
}

function mount() {
  controller?.abort();
  controller = new AbortController();
  const on = (target, event, handler) =>
    target.addEventListener(event, handler, { signal: controller.signal });
  app.innerHTML = `
    <header class="site-header"><div class="header-inner">${siteBrand()}<nav class="header-actions" aria-label="${t("게임 메뉴")}">${languagePicker()}${tool("stats", "내 기록", "chart-no-axes-column")}${tool("help", "게임 규칙", "circle-help")}</nav></div></header>
    <main class="main cq-main">
      <div id="cq-new-day" class="cq-day-banner" hidden><span>${t("새로운 오늘의 포켓몬이 도착했어요.")}</span><button class="text-button" data-action="daily">${icon("rotate-cw")}${t("오늘의 문제")}</button></div>
      <section class="cq-heading"><div><div class="eyebrow" id="cq-date"></div><h1>${t("포케클루")}</h1></div><div class="segmented cq-mode" role="group" aria-label="${t("게임 모드")}"><button data-action="daily">${t("데일리")}</button><button data-action="practice">${t("연습")}</button></div></section>
      <section class="cq-progress" aria-label="${t("현재 기록")}"><div><span>${t("추측 횟수")}</span><strong id="cq-used"></strong></div><div class="cq-best"><span>${t("일치한 단서")}</span><strong id="cq-best"></strong></div><div><span>${t("완료 등급")}</span><strong id="cq-grade"></strong></div></section>
      <p id="cq-save-warning" class="cq-warning" role="status" hidden>${t("브라우저 저장 공간을 사용할 수 없어 진행 상황이 저장되지 않습니다.")}</p>
      <section id="cq-answer" class="cq-answer" hidden aria-live="polite"></section>
      <section id="cq-search-panel" aria-label="${t("포켓몬 추측")}">
        <form id="cq-form" autocomplete="off"><div class="cq-search-wrap"><label class="cq-search">${icon("search")}<input id="cq-input" role="combobox" aria-label="${t("포켓몬 이름 또는 도감 번호")}" placeholder="${t("이름 또는 도감 번호")}" aria-autocomplete="list" aria-controls="cq-options" aria-expanded="false" spellcheck="false" autocomplete="off" /><button id="cq-clear" type="button" class="icon-button" data-action="clear" aria-label="${t("검색 지우기")}" hidden>${icon("x")}</button></label><button type="submit" class="cq-submit" aria-label="${t("추측 제출")}" title="${t("추측 제출")}">${icon("arrow-right")}</button></div>
          <div id="cq-suggestions" class="cq-suggestions" hidden><div id="cq-match-count" class="cq-match-count" role="status"></div><ul id="cq-options" role="listbox" aria-label="${t("포켓몬 검색 결과")}"></ul><button id="cq-more" type="button" class="text-button" data-action="more" hidden>${icon("chevron-down")}${t("더 보기")}</button></div>
        </form><div id="cq-starters" class="cq-starters"></div>
      </section>
      <div id="cq-toast" class="cq-toast" role="status" aria-live="polite"></div>
      <section class="cq-history" aria-labelledby="cq-history-title"><div class="cq-history-heading"><h2 id="cq-history-title">${t("추측 기록")} <span id="cq-count">0</span></h2><div class="cq-legend">${["match", "partial", "miss"].map((state) => `<span class="cq-legend-${state}">${icon(stateIcons[state])}${t(stateLabels[state])}</span>`).join("")}</div></div>
        <div class="cq-columns" aria-hidden="true"><span>${t("포켓몬")}</span>${FIELDS.map((key) => `<span>${t(labels[key])}</span>`).join("")}</div>
        <ol id="cq-history"></ol><div id="cq-empty" class="cq-empty">${icon("fingerprint")}<span>${t("아직 추측한 포켓몬이 없어요.")}</span><div class="cq-empty-lines" aria-hidden="true">${FIELDS.map(() => `<span></span>`).join("")}</div></div>
      </section>
      <div class="cq-actions"><button id="cq-give-up" class="text-button" data-action="give-up">${icon("flag")}${t("포기")}</button><button id="cq-new-practice" class="text-button" data-action="new-practice" hidden>${icon("rotate-cw")}${t("새 연습")}</button><span id="cq-next" class="cq-next"></span></div>
      <footer class="footer cq-footer"><span>${t("포케클루")} <span class="footer-dot">·</span> ${t("비공식 팬 게임")}</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">${t("데이터 · PokéAPI")} ${icon("arrow-right")}</a></footer>
    </main>
    <dialog id="cq-dialog"><div class="dialog-header"><h2 id="cq-dialog-title"></h2>${tool("close-dialog", "닫기", "x")}</div><div id="cq-dialog-body"></div></dialog>`;
  on(document.querySelector("#cq-input"), "input", () => {
    active = -1;
    limit = 30;
    renderSuggestions();
  });
  on(document.querySelector("#cq-input"), "focus", renderSuggestions);
  on(document.querySelector("#cq-input"), "keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") return closeSuggestions();
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    if (document.querySelector("#cq-suggestions").hidden) renderSuggestions();
    const count = Math.min(matches.length, limit);
    if (!count) return;
    active =
      active < 0
        ? event.key === "ArrowDown"
          ? 0
          : count - 1
        : (active + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
    updateActive();
  });
  on(document.querySelector("#cq-form"), "submit", (event) => {
    event.preventDefault();
    const choice =
      active >= 0 ? matches[active] : matches.length === 1 ? matches[0] : null;
    if (choice) guess(choice.id);
    else {
      renderSuggestions();
      toast(
        t(
          matches.length
            ? "목록에서 포켓몬의 모습을 선택해 주세요."
            : "포켓몬 이름을 확인해 주세요.",
        ),
      );
    }
  });
  on(document, "click", onClick);
  on(document, "focusin", (event) => {
    if (!event.target.closest("#cq-form")) closeSuggestions();
  });
  on(document.querySelector("#cq-dialog"), "click", (event) => {
    if (event.target.id === "cq-dialog") event.target.close();
  });
  on(window, "popstate", () => start(settingsFromSearch(location.search)));
  on(window, "pageshow", tick);
  on(document, "visibilitychange", tick);
}

function start(next, navigate = false) {
  settings = next;
  if (settings.mode === "practice")
    save("pokeclue:last-practice", settings.seed);
  if (navigate) {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    if (settings.mode === "practice") {
      url.searchParams.set("mode", "practice");
      url.searchParams.set("seed", settings.seed);
    } else if (settings.day !== dayKey())
      url.searchParams.set("date", settings.day);
    history.pushState(null, "", url.href);
  }
  round = restoreRound(read(storageKey(game, settings)), game, settings);
  // The old automatic loss at eight guesses can now continue; explicit give-ups stay final.
  if (settings.mode === "daily" && round.guesses.length === 8 && !finished()) {
    const previous = records();
    const resumed = previous.filter(
      (r) => r.day !== settings.day || r.won || r.attempts !== 8,
    );
    if (resumed.length !== previous.length) save("pokeclue:records", resumed);
  }
  clearTimeout(toastTimer);
  document.querySelector("#cq-toast").textContent = "";
  document.querySelector("#cq-input").value = "";
  matches = [];
  active = -1;
  limit = 30;
  closeSuggestions();
  render();
  tick();
}

function closeSuggestions() {
  document.querySelector("#cq-suggestions").hidden = true;
  const input = document.querySelector("#cq-input");
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  active = -1;
}
function renderSuggestions() {
  const input = document.querySelector("#cq-input"),
    query = input.value.trim();
  document.querySelector("#cq-clear").hidden = !query;
  if (!query || finished()) {
    matches = [];
    return closeSuggestions();
  }
  matches = searchForms(game.pokemon, query);
  const used = new Set(round.guesses.map((id) => answerKey(game.byId.get(id))));
  document.querySelector("#cq-suggestions").hidden = false;
  input.setAttribute("aria-expanded", "true");
  document.querySelector("#cq-match-count").textContent = matches.length
    ? t("{count}개 모습", { count: matches.length })
    : t("일치하는 포켓몬이 없어요.");
  document.querySelector("#cq-options").innerHTML = matches
    .slice(0, limit)
    .map((p, i) => {
      const guessed = used.has(answerKey(p));
      return `<li id="cq-option-${i}" role="option" data-guess="${p.id}" aria-selected="${i === active}" aria-disabled="${guessed}">${sprite(p)}<span class="cq-option-name">${esc(pokemonName(p))}<small>#${String(p.speciesId).padStart(4, "0")}${guessed ? ` · ${t("이미 추측")}` : ""}</small></span>${guessed ? icon("check") : typeMarkup(p.types)}</li>`;
    })
    .join("");
  document.querySelector("#cq-more").hidden = matches.length <= limit;
  updateActive();
  refreshIcons();
}
function updateActive() {
  const input = document.querySelector("#cq-input");
  document
    .querySelectorAll("#cq-options [role=option]")
    .forEach((el, i) => el.setAttribute("aria-selected", active === i));
  if (active >= 0) {
    input.setAttribute("aria-activedescendant", `cq-option-${active}`);
    document
      .querySelector(`#cq-option-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  } else input.removeAttribute("aria-activedescendant");
}

function guess(id) {
  const status = submitGuess(round, game, id);
  if (status !== "ok") {
    if (status === "duplicate") toast(t("이미 같은 단서의 모습을 추측했어요."));
    return;
  }
  save(storageKey(game, settings), round);
  document.querySelector("#cq-input").value = "";
  matches = [];
  closeSuggestions();
  if (finished()) saveRecord();
  render();
  const feedback = comparePokemon(
    game.byId.get(id),
    game.byId.get(round.target),
  );
  toast(
    isWon(round, game)
      ? t("{rank} · {count}번 만에 정답", {
          rank: rankName(rankFor(round.guesses.length)),
          count: round.guesses.length,
        })
      : t("{count}개 단서 일치 · {attempts}번째 추측", {
          count: FIELDS.filter((key) => feedback[key].state === "match").length,
          attempts: round.guesses.length,
        }),
  );
  if (finished())
    document.querySelector("#cq-answer-title").focus({ preventScroll: true });
  else document.querySelector("#cq-input").focus({ preventScroll: true });
}

function values(p, key, result) {
  if (key === "types") return typeMarkup(p.types);
  if (key === "abilities")
    return p.abilities.length
      ? p.abilities
          .map(
            (a) =>
              `<span class="cq-value${result?.shared.includes(a.id) ? " cq-value-match" : ""}">${esc(localName(abilities.get(a.id)))}${a.hidden ? `<span class="cq-hidden-ability" title="${t("숨겨진 특성")}" aria-label="${t("숨겨진 특성")}">${icon("sparkles")}</span>` : ""}</span>`,
          )
          .join("")
      : t("미확인");
  if (key === "eggGroups")
    return (
      p.eggGroups
        .map(
          (key) =>
            `<span class="cq-value${result?.shared.includes(key) ? " cq-value-match" : ""}">${esc(localName(eggs.get(key)))}</span>`,
        )
        .join("") || t("미확인")
    );
  if (key === "evolution")
    return `<span class="cq-numeric">${t("{stage}단계", { stage: p.stage })}</span>`;
  if (key === "generation")
    return `<span class="cq-numeric">${t("{generation}세대", { generation: p.generation })}</span>`;
  return `<span class="cq-numeric">${p.bst}</span>`;
}
function clueCell(p, field, result) {
  const direction =
    result.direction &&
    t(
      result.direction === "up"
        ? "정답의 값이 더 높아요"
        : "정답의 값이 더 낮아요",
    );
  return `<div class="cq-clue cq-${result.state}" data-field="${field}" data-state="${result.state}"${result.direction ? ` data-direction="${result.direction}"` : ""}><dt>${t(labels[field])}</dt><dd><span class="cq-status" title="${t(stateLabels[result.state])}" role="img" aria-label="${t(stateLabels[result.state])}">${icon(stateIcons[result.state])}</span><span class="cq-values">${values(p, field, result)}</span>${direction ? `<span class="cq-direction" title="${direction}" role="img" aria-label="${direction}">${icon(`arrow-${result.direction}`)}</span>` : ""}${field === "evolution" ? `<small class="cq-family">${icon(result.family ? "check" : "x")}${t(result.family ? "같은 계열" : "다른 계열")}</small>` : ""}</dd></div>`;
}
function renderHistory() {
  const target = game.byId.get(round.target);
  document.querySelector("#cq-count").textContent = round.guesses.length;
  document.querySelector("#cq-empty").hidden = round.guesses.length > 0;
  document.querySelector("#cq-history").innerHTML = round.guesses
    .map((id, i) => {
      const p = game.byId.get(id),
        feedback = comparePokemon(p, target);
      return `<li class="cq-row" data-result="${id}"><div class="cq-pokemon"><span class="cq-guess-number">${i + 1}</span>${sprite(p)}<h3>${esc(pokemonName(p))}<small>#${String(p.speciesId).padStart(4, "0")}</small></h3></div><dl class="cq-fields">${FIELDS.map((field) => clueCell(p, field, feedback[field])).join("")}</dl></li>`;
    })
    .reverse()
    .join("");
}
function render() {
  const target = game.byId.get(round.target),
    won = isWon(round, game);
  const rank = won ? rankFor(round.guesses.length) : null;
  document.querySelector("#cq-date").innerHTML =
    `${icon(settings.mode === "daily" ? "calendar-days" : "fingerprint")} ${settings.mode === "daily" ? esc(settings.day.replaceAll("-", ".")) : t("연습 도전")}`;
  document.querySelectorAll(".cq-mode button").forEach((button) => {
    const selected = button.dataset.action === settings.mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", selected);
  });
  document.querySelector("#cq-used").textContent = round.guesses.length;
  document.querySelector("#cq-grade").textContent = rank ? rankName(rank) : "-";
  const best = Math.max(
    0,
    ...round.guesses.map((id) => {
      const feedback = comparePokemon(game.byId.get(id), target);
      return FIELDS.filter((field) => feedback[field].state === "match").length;
    }),
  );
  document.querySelector("#cq-best").textContent = `${best} / ${FIELDS.length}`;
  document.querySelector("#cq-search-panel").hidden = finished();
  document.querySelector("#cq-answer").hidden = !finished();
  if (finished())
    document.querySelector("#cq-answer").innerHTML = `
    <div class="cq-answer-heading">${sprite(target)}<div><span class="cq-answer-state">${icon(won ? "trophy" : "flag")}${t(won ? "정답!" : "정답 공개")}</span><h2 id="cq-answer-title" tabindex="-1">${esc(pokemonName(target))}</h2></div><button class="text-button" data-action="share">${icon("share-2")}${t("결과 공유")}</button></div>
    ${rank ? `<div class="cq-result-rank"><strong class="cq-rank cq-rank-${rank}">${rankName(rank)}</strong><span>${t("{count}번 만에 정답", { count: round.guesses.length })}</span></div>` : ""}
    <dl class="cq-answer-facts">${FIELDS.map((field) => `<div><dt>${t(labels[field])}</dt><dd>${values(target, field)}</dd></div>`).join("")}</dl>`;
  document.querySelector("#cq-starters").hidden = round.guesses.length > 0;
  document.querySelector("#cq-starters").innerHTML = [1, 4, 7, 25, 133]
    .map((id) => game.byId.get(id))
    .filter(Boolean)
    .map(
      (p) =>
        `<button data-guess="${p.id}" aria-label="${esc(t("{pokemon} 추측", { pokemon: pokemonName(p) }))}">${sprite(p)}<span>${esc(pokemonName(p))}</span></button>`,
    )
    .join("");
  document.querySelector("#cq-save-warning").hidden = !storageWarning;
  document.querySelector("#cq-clear").hidden = true;
  document.querySelector("#cq-give-up").disabled = finished();
  document.querySelector("#cq-new-practice").hidden =
    settings.mode !== "practice" && !finished();
  renderHistory();
  refreshIcons();
}

function dialog(title, body) {
  closeSuggestions();
  document.querySelector("#cq-dialog-title").textContent = t(title);
  document.querySelector("#cq-dialog-body").innerHTML = body;
  refreshIcons();
  document.querySelector("#cq-dialog").showModal();
}
function records() {
  try {
    const rows = JSON.parse(read("pokeclue:records"));
    return Array.isArray(rows)
      ? rows.filter(
          (r) =>
            r &&
            r.version === game.version &&
            /^\d{4}-\d{2}-\d{2}$/.test(r.day) &&
            typeof r.won === "boolean" &&
            Number.isInteger(r.attempts) &&
            r.attempts >= (r.won ? 1 : 0) &&
            r.attempts <= game.pokemon.length,
        )
      : [];
  } catch {
    return [];
  }
}
function saveRecord() {
  if (settings.mode !== "daily") return;
  const rows = records().filter((r) => r.day !== settings.day);
  rows.push({
    version: game.version,
    day: settings.day,
    won: isWon(round, game),
    attempts: round.guesses.length,
  });
  save(
    "pokeclue:records",
    rows.sort((a, b) => b.day.localeCompare(a.day)).slice(0, 365),
  );
}
function newPractice() {
  let seed;
  do {
    seed = crypto.randomUUID();
  } while (
    game.targetFor({ mode: "practice", seed }) === round.target &&
    game.answers.length > 1
  );
  start({ mode: "practice", seed }, true);
}
async function share() {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  if (settings.mode === "daily") url.searchParams.set("date", settings.day);
  else {
    url.searchParams.set("mode", "practice");
    url.searchParams.set("seed", settings.seed);
  }
  const result = isWon(round, game)
    ? t("{rank} · {count}번 만에 정답", {
        rank: rankName(rankFor(round.guesses.length)),
        count: round.guesses.length,
      })
    : t("도전 종료 · {count}회 추측", { count: round.guesses.length });
  const text = `${t("포케클루")} ${settings.mode === "daily" ? settings.day : t("연습")}\n${result}\n${shareGrid(round, game)}\n${t("일치 O · 일부 ~ · 불일치 X")}\n${url.href}`;
  try {
    if (navigator.share && matchMedia("(max-width:800px)").matches)
      await navigator.share({ title: t("포케클루"), text });
    else {
      await navigator.clipboard.writeText(text);
      toast(t("정답을 제외한 결과를 복사했어요."));
    }
  } catch (error) {
    if (error.name !== "AbortError")
      dialog(
        "결과 공유",
        `<textarea class="share-text" readonly aria-label="${t("공유할 결과")}">${esc(text)}</textarea>`,
      );
  }
}
function onClick(event) {
  const option = event.target.closest("[data-guess]");
  if (option) return guess(Number(option.dataset.guess));
  if (!event.target.closest("#cq-form")) closeSuggestions();
  const action = event.target.closest("[data-action]")?.dataset.action;
  switch (action) {
    case "clear":
      document.querySelector("#cq-input").value = "";
      renderSuggestions();
      document.querySelector("#cq-input").focus();
      break;
    case "more":
      limit += 30;
      renderSuggestions();
      break;
    case "daily":
      start({ mode: "daily", day: dayKey() }, true);
      break;
    case "practice": {
      if (settings.mode === "practice") break;
      let seed;
      try {
        seed = JSON.parse(read("pokeclue:last-practice"));
      } catch {
        /* A corrupt preference is optional. */
      }
      if (validSeed(seed)) start({ mode: "practice", seed }, true);
      else newPractice();
      break;
    }
    case "new-practice":
      if (!finished() && round.guesses.length)
        dialog(
          "새 연습을 시작할까요?",
          `<p class="dialog-copy">${t("새로운 포켓몬으로 연습을 시작합니다.")}</p><button class="primary-button wide" data-action="confirm-practice">${icon("rotate-cw")}${t("새 연습")}</button>`,
        );
      else newPractice();
      break;
    case "confirm-practice":
      document.querySelector("#cq-dialog").close();
      newPractice();
      break;
    case "give-up":
      if (!finished())
        dialog(
          "정답을 공개할까요?",
          `<p class="dialog-copy">${t("이 문제의 도전이 종료됩니다.")}</p><button class="primary-button wide" data-action="reveal">${icon("flag")}${t("정답 공개")}</button>`,
        );
      break;
    case "reveal":
      if (!finished()) {
        round.gaveUp = true;
        save(storageKey(game, settings), round);
        saveRecord();
        document.querySelector("#cq-dialog").close();
        closeSuggestions();
        render();
        document
          .querySelector("#cq-answer-title")
          .focus({ preventScroll: true });
      }
      break;
    case "close-dialog":
      document.querySelector("#cq-dialog").close();
      break;
    case "share":
      share();
      break;
    case "help":
      dialog(
        "포케클루 규칙",
        `<ul class="rules">
      <li>${t("횟수 제한 없이 추측하고, 정답을 맞히기까지 사용한 횟수로 등급을 받습니다. 타입·특성·알 그룹은 순서와 무관하게 모두 같으면 일치, 일부만 같으면 일부 일치입니다.")}</li>
      <li>${t("화살표는 정답을 가리킵니다. 위 화살표는 정답의 값이 더 높고, 아래 화살표는 더 낮다는 뜻입니다.")}</li>
      <li>${t("진화는 단계와 계열을 함께 비교합니다. 계열은 이상해씨·이상해풀·이상해꽃처럼 이어지는 진화 계보입니다. 아기 포켓몬부터 1단계로 세며, 메가진화는 단계를 올리지 않습니다. 세대는 해당 종이 처음 등장한 세대입니다.")}</li>
      <li>${t("특성은 숨겨진 특성을 포함합니다. 미확인 자료는 판정하지 않습니다. 특성 자료가 없거나 다른 종과 모든 단서가 같아 구별할 수 없는 포켓몬은 정답으로 출제하지 않습니다.")}</li>
      <li>${t("메가·리전 폼도 포함합니다. 같은 종에서 모든 단서가 같은 외형 차이는 같은 정답으로 인정하며, 일부 이벤트·기념용 모습은 제외합니다.")}</li>
      <li>${t("데일리는 한국 시간 자정에 바뀝니다. 연습은 데일리 기록과 별개이며, 진행 상황은 이 브라우저에 저장됩니다.")}</li></ul>
      <section class="cq-rank-rules"><h3>${t("등급 기준")}</h3><dl class="cq-rank-guide">${GUESS_RANKS.map(
        (tier, index) => {
          const min = index ? GUESS_RANKS[index - 1].max + 1 : 1;
          const range = Number.isFinite(tier.max)
            ? t("{min}~{max}회", { min, max: tier.max })
            : t("{min}회 이상", { min });
          return `<div><dt><span class="cq-rank cq-rank-${tier.rank}">${t(tier.label)}</span></dt><dd>${range}</dd></div>`;
        },
      ).join("")}</dl></section>`,
      );
      break;
    case "stats": {
      const list = records(),
        wins = list.filter((r) => r.won);
      dialog(
        "데일리 기록",
        `<div class="stats-row"><div><strong>${list.length}</strong><span>${t("완료한 도전")}</span></div><div><strong>${wins.length}</strong><span>${t("정답")}</span></div><div><strong>${wins.length ? (wins.reduce((sum, r) => sum + r.attempts, 0) / wins.length).toFixed(1) : "-"}</strong><span>${t("평균 시도")}</span></div></div><div class="history-list">${
          list
            .slice(0, 8)
            .map(
              (r) =>
                `<div><span>${esc(r.day)}</span><strong class="cq-record-result">${r.won ? `<span class="cq-rank cq-rank-${rankFor(r.attempts)}">${rankName(rankFor(r.attempts))}</span>` : ""}<span>${r.won ? t("{count}회 정답", { count: r.attempts }) : t("도전 종료")}</span></strong></div>`,
            )
            .join("") ||
          `<p class="dialog-copy">${t("아직 완료한 도전이 없어요.")}</p>`
        }</div>`,
      );
      break;
    }
  }
}
function tick() {
  if (!round) return;
  const today = dayKey();
  document.querySelector("#cq-new-day").hidden =
    settings.mode !== "daily" || settings.day === today;
  const seconds = Math.max(
    0,
    Math.ceil(
      (Date.parse(`${today}T00:00:00+09:00`) + 86400000 - Date.now()) / 1000,
    ),
  );
  document.querySelector("#cq-next").textContent = t("다음 문제 {time}", {
    time: [
      Math.floor(seconds / 3600),
      Math.floor((seconds % 3600) / 60),
      seconds % 60,
    ]
      .map((n) => String(n).padStart(2, "0"))
      .join(":"),
  });
}
async function boot() {
  app.innerHTML = `<div class="loading-screen"><span class="loading-spinner"></span><strong>${t("오늘의 단서를 준비하고 있어요")}</strong></div>`;
  try {
    const catalogResponse = await fetch(asset("pokemantle.json"), {
      cache: "no-cache",
    });
    if (!catalogResponse.ok) throw new Error("Catalog loading failed");
    catalog = await catalogResponse.json();
    const response = await fetch(asset("pokeclue.json"), { cache: "no-cache" });
    if (!response.ok) throw new Error("Clue loading failed");
    clues = await response.json();
    game = createClueGame(catalog, clues);
    types = new Map(catalog.types.map((type) => [type.id, type]));
    abilities = new Map(clues.abilities.map((a) => [a.id, a]));
    eggs = new Map(clues.eggGroups.map((g) => [g.key, g]));
    mount();
    start(settingsFromSearch(location.search));
    setInterval(tick, 1000);
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="loading-screen"><h1>${t("게임을 불러오지 못했어요")}</h1><p>${t("연결을 확인하고 다시 시도해 주세요.")}</p><button class="primary-button" id="cq-retry">${t("다시 시도")}</button><a class="text-button" href="./">${t("게임 목록으로")}</a></div>`;
    document.querySelector("#cq-retry").onclick = () => location.reload();
  }
}
initLanguage("포케클루 | 포켓몬 퀴즈", () => {
  if (!round) return;
  const query = document.querySelector("#cq-input").value;
  clearTimeout(toastTimer);
  mount();
  render();
  document.querySelector("#cq-input").value = query;
  if (query) renderSuggestions();
  tick();
});
boot();
