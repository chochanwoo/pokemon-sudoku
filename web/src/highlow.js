import {
  createIcons,
  Gamepad2,
  Languages,
  CircleHelp,
  ChartNoAxesColumn,
  CalendarDays,
  Flame,
  Trophy,
  ArrowRight,
  ArrowUp,
  Check,
  X,
  RotateCw,
  Share2,
  Heart,
  Swords,
  Shield,
  Sparkles,
  ShieldPlus,
  Zap,
  ImageOff,
} from "lucide";
import {
  createHighLow,
  statInfo,
  statValue,
  difficultyOf,
  profileKey,
  lastPracticeKey,
  MAX_QUESTIONS,
  dayKey,
  validSeed,
  settingsFromSearch,
  challengeKey,
  storageKey,
  restoreRound,
  currentIndex,
  score,
  isEnded,
  submitChoice,
  nextQuestion,
} from "./highlow-engine.js";
import { siteBrand, languagePicker } from "./site-brand.js";
import { t, initLanguage, pokemonName, typeName } from "./i18n.js";
import { HIGHLOW_STREAK_RANKS, streakRankFor } from "./trainer-ranks.js";
import { trainerResultKey } from "./trainers.js";
import {
  trainerBadge,
  trainerGuideBadge,
  trainerTaunt,
  rankName,
  onTrainerImageError,
} from "./trainer-results.js";
import "./style.css";
import "./highlow.css";

const icons = {
  Gamepad2,
  Languages,
  CircleHelp,
  ChartNoAxesColumn,
  CalendarDays,
  Flame,
  Trophy,
  ArrowRight,
  ArrowUp,
  Check,
  X,
  RotateCw,
  Share2,
  Heart,
  Swords,
  Shield,
  Sparkles,
  ShieldPlus,
  Zap,
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
  `<button class="icon-button" data-action="${action}" aria-label="${t(label)}" data-tooltip="${t(label)}">${icon(glyph)}</button>`;
const app = document.querySelector("#app");
const typeImages = import.meta.glob("./assets/types/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
});
let catalog,
  game,
  settings,
  round,
  types,
  controller,
  storageWarning = false,
  toastTimer;
const refreshIcons = () =>
  createIcons({ icons, attrs: { "stroke-width": 1.8 } });
const ended = () => isEnded(round, game, settings);
const streak = () => score(round, game, settings);
const resultRank = () =>
  ended() ? streakRankFor(streak(), settings.difficulty) : null;
const trainerKey = (challenge = challengeKey(settings), wins = streak()) =>
  trainerResultKey("highlow", challenge, wins);
const recordsKey = () => `${profileKey(game, settings)}:records`;
const bestKey = () => `${profileKey(game, settings)}:best`;
const difficultyLabel = () =>
  t(settings.difficulty === "hard" ? "하드" : "일반");
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
    const el = document.querySelector("#hl-save-warning");
    if (el) el.hidden = false;
  }
}
function records() {
  try {
    const list = JSON.parse(read(recordsKey()));
    return Array.isArray(list)
      ? list
          .filter(
            (r) =>
              r &&
              typeof r.challenge === "string" &&
              ["daily", "practice"].includes(r.mode) &&
              /^\d{4}-\d{2}-\d{2}$/.test(r.day) &&
              Number.isInteger(r.score) &&
              r.score >= 0 &&
              r.score <= MAX_QUESTIONS,
          )
          .slice(0, 365)
      : [];
  } catch {
    return [];
  }
}
const best = () => {
  const saved = Number(read(bestKey()));
  return Math.max(
    0,
    Number.isInteger(saved) && saved <= MAX_QUESTIONS ? saved : 0,
    ...records().map((r) => r.score),
    streak(),
  );
};
function saveRecord() {
  if (!ended()) return;
  const record = {
    challenge: challengeKey(settings),
    mode: settings.mode,
    day: settings.day || dayKey(),
    score: streak(),
  };
  save(
    recordsKey(),
    [
      record,
      ...records().filter((r) => r.challenge !== record.challenge),
    ].slice(0, 365),
  );
}
const sprite = (p) =>
  `<span class="hl-sprite"><img src="${catalog.images[p.image]}" alt="" width="96" height="96" draggable="false" /><span class="hl-image-fallback" role="img" aria-label="${t("이미지 미제공")}">${icon("image-off")}</span></span>`;
const badges = (p) =>
  `<span class="hl-types">${p.types
    .map((id) => {
      const type = types.get(id),
        src = type && typeImages[`./assets/types/${type.key}.svg`];
      return src
        ? `<img src="${src}" width="20" height="20" alt="${esc(typeName(type))}" title="${esc(typeName(type))}" />`
        : "";
    })
    .join("")}</span>`;

function mount() {
  controller?.abort();
  controller = new AbortController();
  const on = (target, event, handler) =>
    target.addEventListener(event, handler, { signal: controller.signal });
  app.innerHTML = `<header class="site-header"><div class="header-inner">${siteBrand()}<nav class="header-actions" aria-label="${t("게임 메뉴")}">${languagePicker()}${tool("stats", "내 기록", "chart-no-axes-column")}${tool("help", "게임 규칙", "circle-help")}</nav></div></header>
  <main class="main hl-main">
    <div class="hl-day-banner" id="hl-new-day" hidden><span>${t("새로운 오늘의 대결이 열렸어요.")}</span><button class="text-button" data-action="daily">${icon("rotate-cw")}${t("오늘의 문제")}</button></div>
    <section class="hl-heading"><div><div class="eyebrow" id="hl-date"></div><h1>${t("포케 하이로우")}</h1></div><div class="segmented hl-mode" role="group" aria-label="${t("게임 모드")}"><button data-action="daily">${t("데일리")}</button><button data-action="practice">${t("연습")}</button></div></section>
    <div class="hl-difficulty-row"><span>${t("난이도")}</span><div class="segmented hl-difficulty" role="group" aria-label="${t("난이도")}"><button data-difficulty="normal">${icon("chart-no-axes-column")}${t("일반")}</button><button data-difficulty="hard">${icon("flame")}${t("하드")}</button></div></div>
    <div class="hl-summary" aria-label="${t("현재 기록")}"><div class="hl-streak">${icon("flame")}<span>${t("연속 정답")}<strong id="hl-streak">0</strong></span></div><div class="hl-best">${icon("trophy")}<span>${t("내 최고")}<strong id="hl-best">0</strong></span></div></div>
    <p class="hl-warning" id="hl-save-warning" role="status" hidden>${t("브라우저 저장 공간을 사용할 수 없어 진행 상황이 저장되지 않습니다.")}</p>
    <section id="hl-arena" aria-labelledby="hl-question"><div class="hl-question-heading"><span id="hl-round-number"></span><h2 id="hl-question"></h2></div><div id="hl-duel" class="hl-duel"></div></section>
    <div class="hl-feedback-row"><p id="hl-feedback" role="status" aria-live="polite"></p><button class="primary-button" id="hl-next" data-action="next" hidden>${t("다음 대결")}${icon("arrow-right")}</button><button class="primary-button" id="hl-result" data-action="result" hidden>${icon("trophy")}${t("결과 보기")}</button></div>
    <section class="hl-recent" id="hl-recent" hidden><h2>${t("최근 대결")}</h2><ol id="hl-history"></ol></section>
    <div class="hl-actions"><button class="text-button" data-action="new-practice">${icon("rotate-cw")}${t("새 연습")}</button><span id="hl-next-day"></span></div>
    <p id="hl-toast" class="hl-toast" role="status"></p>
    <footer class="footer hl-footer"><span>${t("포케 하이로우")} <span class="footer-dot">·</span> ${t("비공식 팬 게임")}</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">${t("데이터 · PokéAPI")} ${icon("arrow-right")}</a></footer>
  </main><dialog id="hl-dialog" aria-labelledby="hl-dialog-title"><div class="dialog-header"><h2 id="hl-dialog-title"></h2>${tool("close-dialog", "닫기", "x")}</div><div id="hl-dialog-body"></div></dialog>`;
  on(document, "click", onClick);
  on(document.querySelector("#hl-duel"), "keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || round.revealed)
      return;
    event.preventDefault();
    document
      .querySelector(
        `[data-choice="${event.key === "ArrowLeft" ? "left" : "right"}"]`,
      )
      .focus();
  });
  app.addEventListener(
    "error",
    (event) => {
      onTrainerImageError(event);
      if (event.target.matches?.(".hl-sprite img"))
        event.target.parentElement.classList.add("is-missing");
    },
    { capture: true, signal: controller.signal },
  );
  on(document.querySelector("#hl-dialog"), "click", (event) => {
    if (event.target.id === "hl-dialog") event.target.close();
  });
  on(document.querySelector("#hl-dialog"), "close", () => {
    if (ended())
      document.querySelector("#hl-result").focus({ preventScroll: true });
  });
  on(window, "popstate", () => start(settingsFromSearch(location.search)));
  on(window, "pageshow", tick);
  on(document, "visibilitychange", tick);
}

function start(next, navigate = false) {
  document.querySelector("#hl-dialog").close();
  clearTimeout(toastTimer);
  document.querySelector("#hl-toast").textContent = "";
  settings = { ...next, difficulty: difficultyOf(next) };
  if (next.mode === "practice") save(lastPracticeKey(settings), next.seed);
  if (navigate) {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    if (next.mode === "practice") {
      url.searchParams.set("mode", "practice");
      url.searchParams.set("seed", next.seed);
    } else if (next.day !== dayKey()) url.searchParams.set("date", next.day);
    url.searchParams.set("difficulty", settings.difficulty);
    history.pushState(null, "", url);
  }
  round = restoreRound(read(storageKey(game, settings)), game, settings);
  render();
  tick();
}
function render() {
  const q = game.question(settings, currentIndex(round)),
    stat = statInfo(q.stat);
  const chosen = round.revealed ? round.choices.at(-1) : null;
  document.querySelector("#hl-date").innerHTML =
    `${icon("calendar-days")} ${settings.mode === "daily" ? esc(settings.day.replaceAll("-", ".")) : t("연습")}`;
  document.querySelectorAll(".hl-mode button").forEach((el) => {
    const active = el.dataset.action === settings.mode;
    el.classList.toggle("active", active);
    el.setAttribute("aria-pressed", active);
  });
  document.querySelectorAll("button[data-difficulty]").forEach((el) => {
    const active = el.dataset.difficulty === settings.difficulty;
    el.classList.toggle("active", active);
    el.setAttribute("aria-pressed", active);
  });
  document.querySelector(".hl-main").dataset.difficultyMode =
    settings.difficulty;
  document.querySelector("#hl-streak").textContent = streak();
  document.querySelector("#hl-best").textContent = best();
  document.querySelector("#hl-round-number").textContent = `${t(
    "{count}번째 대결",
    { count: q.index + 1 },
  )} · ${difficultyLabel()}`;
  document.querySelector("#hl-question").innerHTML =
    `${icon(stat.icon)}<span>${t("{stat}, 어느 쪽이 더 높을까?", { stat: t(stat.label) })}</span>`;
  document.querySelector("#hl-arena").dataset.stat = stat.key;
  document.querySelector("#hl-duel").innerHTML =
    ["left", "right"]
      .map((side) => {
        const p = game.byId.get(q[side]);
        const result = chosen
          ? side === q.winner
            ? "winner"
            : "lower"
          : "hidden";
        const selected = chosen === side;
        const label = chosen
          ? `${pokemonName(p)}, ${t(stat.label)} ${statValue(p, q.stat)}, ${t(side === q.winner ? "더 높은 쪽" : "더 낮은 쪽")}`
          : t("{pokemon} 선택", { pokemon: pokemonName(p) });
        return `<button class="hl-choice hl-${side} ${selected ? "is-chosen" : ""}" data-choice="${side}" data-pokemon="${p.id}" data-result="${result}" ${chosen ? "disabled" : ""} aria-label="${esc(label)}" aria-pressed="${selected}">
      <span class="hl-card-top"><span>#${String(p.speciesId).padStart(4, "0")}</span>${badges(p)}</span>${sprite(p)}<span class="hl-name">${esc(pokemonName(p))}</span>
      <span class="hl-stat-label">${t(stat.label)}</span><strong class="hl-value">${chosen ? statValue(p, q.stat) : "?"}</strong><span class="hl-pick">${icon(chosen ? (side === q.winner ? "check" : selected ? "x" : "arrow-up") : "arrow-up")}${chosen ? t(side === q.winner ? "더 높은 쪽" : selected ? "내 선택" : "더 낮은 쪽") : t("이쪽이 더 높다")}</span></button>`;
      })
      .join("") + '<span class="hl-versus" aria-hidden="true">VS</span>';
  const feedback = document.querySelector("#hl-feedback");
  feedback.className = chosen
    ? chosen === q.winner
      ? "hl-correct"
      : "hl-incorrect"
    : "";
  feedback.innerHTML = chosen
    ? `${ended() ? trainerBadge(resultRank(), "hl-finish-rank", trainerKey()) : icon("check")}<span>${t(ended() ? "{count}연속으로 도전 종료" : "{count}연속 정답!", { count: streak() })}</span>`
    : "";
  document.querySelector("#hl-next").hidden = !round.revealed || ended();
  document.querySelector("#hl-result").hidden = !ended();
  document.querySelector("#hl-save-warning").hidden = !storageWarning;
  document.querySelector("#hl-recent").hidden = !round.choices.length;
  document.querySelector("#hl-history").innerHTML = round.choices
    .map((side, i) => ({ side, i }))
    .slice(-6)
    .reverse()
    .map(({ side, i }) => {
      const item = game.question(settings, i),
        a = game.byId.get(item.left),
        b = game.byId.get(item.right);
      return `<li data-history="${i}"><span class="hl-history-index">${i + 1}</span><div><span class="hl-history-stat">${t(statInfo(item.stat).label)}</span><span class="hl-history-pair">${esc(pokemonName(a))} <b>${statValue(a, item.stat)}</b><span aria-hidden="true">/</span>${esc(pokemonName(b))} <b>${statValue(b, item.stat)}</b></span></div><span class="${side === item.winner ? "hl-correct" : "hl-incorrect"}" aria-label="${t(side === item.winner ? "정답" : "오답")}">${icon(side === item.winner ? "check" : "x")}</span></li>`;
    })
    .join("");
  refreshIcons();
}
function choose(side) {
  const result = submitChoice(round, game, settings, side);
  if (!["correct", "incorrect"].includes(result)) return;
  save(storageKey(game, settings), round);
  save(bestKey(), best());
  if (ended()) saveRecord();
  render();
  if (ended()) showResult();
  else document.querySelector("#hl-next").focus({ preventScroll: true });
}
function dialog(title, body, result = false) {
  const el = document.querySelector("#hl-dialog");
  el.classList.toggle("hl-result-dialog", result);
  el.classList.toggle("trainer-dialog", result);
  document.querySelector("#hl-dialog-title").textContent = t(title);
  document.querySelector("#hl-dialog-body").innerHTML = body;
  refreshIcons();
  el.showModal();
}
function showResult() {
  if (!ended()) return;
  const q = game.question(settings, currentIndex(round)),
    a = game.byId.get(q.left),
    b = game.byId.get(q.right);
  dialog(
    "도전 완료",
    `<div class="hl-result-summary" data-trainer-rank="${resultRank()}"><span class="hl-result-mode">${difficultyLabel()} · ${t(settings.mode === "daily" ? "데일리" : "연습")}</span><div class="hl-award" aria-label="${t("당신의 트레이너 등급")}">${trainerBadge(resultRank(), "hl-award-badge", trainerKey())}</div>${trainerTaunt(resultRank())}<strong>${streak()}</strong><span>${t("연속 정답")}</span><p>${streak() > 0 && streak() === best() ? `${icon("trophy")}${t("최고 기록!")}` : t("다음 도전을 기다릴게요.")}</p></div><div class="hl-last-duel"><p>${t(statInfo(q.stat).label)}</p><div>${[a, b].map((p) => `<div>${sprite(p)}<span>${esc(pokemonName(p))}</span><strong>${statValue(p, q.stat)}</strong></div>`).join("")}</div></div><div class="hl-result-actions"><button class="primary-button wide" data-action="share">${icon("share-2")}${t("결과 공유")}</button><button class="text-button" data-action="start-practice">${icon("rotate-cw")}${t("새 연습")}</button></div>`,
    true,
  );
}
function newPractice() {
  start(
    {
      mode: "practice",
      seed: crypto.randomUUID(),
      difficulty: settings.difficulty,
    },
    true,
  );
}
function resumePractice(difficulty, fallbackSeed) {
  let seed;
  try {
    seed = JSON.parse(read(lastPracticeKey({ difficulty })));
  } catch {
    /* Invalid saved seeds start a new practice. */
  }
  start(
    {
      mode: "practice",
      difficulty,
      seed: validSeed(seed) ? seed : fallbackSeed || crypto.randomUUID(),
    },
    true,
  );
}
async function share() {
  if (!ended()) return;
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  if (settings.mode === "daily") url.searchParams.set("date", settings.day);
  else {
    url.searchParams.set("mode", "practice");
    url.searchParams.set("seed", settings.seed);
  }
  url.searchParams.set("difficulty", settings.difficulty);
  const text = `${t("포케 하이로우")} · ${difficultyLabel()} · ${settings.mode === "daily" ? settings.day : t("연습")}\n${rankName(resultRank(), trainerKey())} · ${t("{count}연속 정답", { count: streak() })}\n${url.href}`;
  try {
    if (navigator.share && matchMedia("(max-width:800px)").matches)
      await navigator.share({ title: t("포케 하이로우"), text });
    else {
      await navigator.clipboard.writeText(text);
      document.querySelector("#hl-dialog").close();
      const el = document.querySelector("#hl-toast");
      el.textContent = t("정답을 제외한 결과를 복사했어요.");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        el.textContent = "";
      }, 3200);
    }
  } catch (error) {
    if (error.name !== "AbortError")
      dialog(
        "결과 공유",
        `<textarea class="share-text" readonly aria-label="${t("공유할 결과")}">${esc(text)}</textarea>`,
      );
  }
}
function rankGuide() {
  const ranks = HIGHLOW_STREAK_RANKS[settings.difficulty];
  return `<section class="trainer-rank-rules"><h3>${t("등급 기준")} · ${difficultyLabel()}</h3><dl class="trainer-rank-guide">${ranks
    .map((tier, index) => {
      const range = index
        ? t("{min}~{max}연속 정답", {
            min: tier.min,
            max: ranks[index - 1].min - 1,
          })
        : t("{min}연속 정답 이상", { min: tier.min });
      return `<div><dt>${trainerGuideBadge(tier.rank)}</dt><dd>${range}</dd></div>`;
    })
    .join("")}</dl></section>`;
}
function onClick(event) {
  const difficulty = event.target.closest("button[data-difficulty]")?.dataset
    .difficulty;
  if (["normal", "hard"].includes(difficulty)) {
    if (difficulty === settings.difficulty) return;
    if (settings.mode === "practice") resumePractice(difficulty, settings.seed);
    else start({ ...settings, difficulty }, true);
    return;
  }
  const choice = event.target.closest("[data-choice]");
  if (choice) return choose(choice.dataset.choice);
  const action = event.target.closest("[data-action]")?.dataset.action;
  switch (action) {
    case "next":
      if (nextQuestion(round, game, settings)) {
        save(storageKey(game, settings), round);
        render();
        document
          .querySelector('[data-choice="left"]')
          .focus({ preventScroll: true });
      }
      break;
    case "daily":
      start(
        { mode: "daily", day: dayKey(), difficulty: settings.difficulty },
        true,
      );
      break;
    case "practice": {
      if (settings.mode === "practice") break;
      resumePractice(settings.difficulty);
      break;
    }
    case "new-practice":
      if (settings.mode === "practice" && round.choices.length && !ended())
        dialog(
          "새 연습을 시작할까요?",
          `<button class="primary-button wide" data-action="start-practice">${icon("rotate-cw")}${t("새 연습 시작")}</button>`,
        );
      else newPractice();
      break;
    case "start-practice":
      newPractice();
      break;
    case "result":
      showResult();
      break;
    case "share":
      share();
      break;
    case "close-dialog":
      document.querySelector("#hl-dialog").close();
      break;
    case "help":
      dialog(
        "포케 하이로우 규칙",
        `<ul class="rules"><li>${t("일반은 종족값 합계, 하드는 매 대결에 지정된 개별 능력치를 비교합니다. 더 높은 포켓몬을 선택하면 양쪽 수치를 공개합니다.")}</li><li>${t("맞히면 다음 대결로 이어지고, 한 번 틀리면 도전이 끝납니다. 동률인 문제는 나오지 않습니다.")}</li><li>${t("하드는 HP·공격·방어·특수공격·특수방어·스피드가 번갈아 출제됩니다. 레벨, 성격, 노력치 등은 반영하지 않으며 메가·리전 폼은 해당 모습의 종족값을 사용합니다.")}</li><li>${t("난이도마다 데일리·연습·최고 기록을 따로 저장합니다. 같은 난이도의 데일리는 모두에게 같은 순서로 출제되며 한국 시간 자정에 바뀝니다. 기존 개별 능력치 기록은 하드에서 이어집니다.")}</li></ul>${rankGuide()}`,
      );
      break;
    case "stats": {
      const list = records();
      dialog(
        "내 기록",
        `<p class="hl-record-mode">${difficultyLabel()}</p><div class="stats-row"><div><strong>${best()}</strong><span>${t("내 최고")}</span></div><div><strong>${list.length}</strong><span>${t("완료한 도전")}</span></div></div><div class="history-list">${
          list
            .slice(0, 10)
            .map(
              (r) =>
                `<div><span>${esc(r.day)}<small>${t(r.mode === "daily" ? "데일리" : "연습")}</small></span><strong class="hl-record-result">${trainerBadge(streakRankFor(r.score, settings.difficulty), "", trainerKey(r.challenge, r.score))}<span>${t("{count}연속 정답", { count: r.score })}</span></strong></div>`,
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
  document.querySelector("#hl-new-day").hidden =
    settings.mode !== "daily" || settings.day === today;
  const seconds = Math.max(
    0,
    Math.ceil(
      (Date.parse(`${today}T00:00:00+09:00`) + 86400000 - Date.now()) / 1000,
    ),
  );
  document.querySelector("#hl-next-day").textContent =
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
  app.innerHTML = `<div class="loading-screen"><span class="loading-spinner"></span><strong>${t("오늘의 대결을 준비하고 있어요")}</strong></div>`;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}pokemantle.json`, {
      cache: "no-cache",
    });
    if (!response.ok) throw new Error("Catalog loading failed");
    catalog = await response.json();
    const stats = await fetch(`${import.meta.env.BASE_URL}highlow.json`, {
      cache: "no-cache",
    });
    if (!stats.ok) throw new Error("Stats loading failed");
    game = createHighLow(catalog, await stats.json());
    types = new Map(catalog.types.map((type) => [type.id, type]));
    mount();
    start(settingsFromSearch(location.search));
    setInterval(tick, 1000);
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="loading-screen"><h1>${t("게임을 불러오지 못했어요")}</h1><p>${t("연결을 확인하고 다시 시도해 주세요.")}</p><button class="primary-button" id="hl-retry">${t("다시 시도")}</button><a class="text-button" href="./">${t("게임 목록으로")}</a></div>`;
    document.querySelector("#hl-retry").onclick = () => location.reload();
  }
}
initLanguage("포케 하이로우 | 포켓몬 퀴즈", () => {
  if (!round) return;
  const resultOpen = document
    .querySelector("#hl-dialog")
    .matches(".hl-result-dialog[open]");
  mount();
  render();
  tick();
  if (resultOpen) showResult();
});
boot();
