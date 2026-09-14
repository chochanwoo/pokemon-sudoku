import {
  createIcons,
  Gamepad2,
  Languages,
  CircleHelp,
  ChartNoAxesColumn,
  Check,
  X,
  RotateCw,
  Undo2,
  ArrowRight,
  Search,
  Share2,
  ImageOff,
  Brain,
  Eye,
  ChevronDown,
} from "lucide";
import {
  createPokinator,
  newRound,
  restoreRound,
  viewRound,
  answerQuestion,
  rejectGuess,
  askMore,
  finishRound,
  stopRound,
  undo,
  searchCandidates,
  MAX_QUESTIONS,
  STORAGE_KEY,
} from "./pokinator-engine.js";
import { siteBrand, languagePicker } from "./site-brand.js";
import { t, getLanguage, initLanguage } from "./i18n.js";
import { dayKey } from "./engine.js";
import "./style.css";
import "./pokinator.css";

const icons = {
  Gamepad2,
  Languages,
  CircleHelp,
  ChartNoAxesColumn,
  Check,
  X,
  RotateCw,
  Undo2,
  ArrowRight,
  Search,
  Share2,
  ImageOff,
  Brain,
  Eye,
  ChevronDown,
};
const app = document.querySelector("#app");
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const tool = (action, label, glyph, disabled = false) =>
  `<button class="icon-button" data-action="${action}" aria-label="${esc(t(label))}" data-tooltip="${esc(t(label))}" ${disabled ? "disabled" : ""}>${icon(glyph)}</button>`;
const answerLabels = { yes: "예", no: "아니오", unknown: "모르겠습니다" };
const answerIcons = { yes: "check", no: "x", unknown: "circle-help" };
const RECORDS_KEY = "pokinator:records";
let catalog,
  game,
  round,
  view,
  dialogState = null,
  historyOpen = false,
  query = "",
  limit = 20,
  storageWarning = false,
  roundUpdated = false;
const name = (p) => (getLanguage() === "en" ? p.english : p.name);
const questionText = (q) => (getLanguage() === "en" ? q.en : q.ko);
const refreshIcons = () =>
  createIcons({ icons, attrs: { "stroke-width": 1.8 } });
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
    const el = document.querySelector("#pn-save-warning");
    if (el) el.hidden = false;
  }
}
const sprite = (p, extra = "") =>
  `<span class="pn-sprite ${extra}">${p?.image && catalog.images[p.image] ? `<img src="${catalog.images[p.image]}" alt="" width="96" height="96" draggable="false" />` : ""}<span class="pn-image-fallback" ${p?.image && catalog.images[p.image] ? "hidden" : ""} role="img" aria-label="${t("이미지 미제공")}">${icon("image-off")}</span></span>`;
function records() {
  try {
    const rows = JSON.parse(read(RECORDS_KEY));
    return Array.isArray(rows)
      ? rows
          .filter(
            (r) =>
              r &&
              /^[a-zA-Z0-9_-]{1,64}$/.test(r.id) &&
              /^\d{4}-\d{2}-\d{2}$/.test(r.day) &&
              game.byId.has(r.answerId) &&
              Number.isInteger(r.questions) &&
              r.questions >= 0 &&
              r.questions <= MAX_QUESTIONS &&
              ["guessed", "revealed"].includes(r.outcome),
          )
          .slice(0, 365)
      : [];
  } catch {
    return [];
  }
}
function saveProgress() {
  save(STORAGE_KEY, round);
  if (round.result)
    save(
      RECORDS_KEY,
      [
        {
          id: round.id,
          day: dayKey(),
          answerId: round.result.id,
          questions: viewRound(game, round).answered,
          outcome: round.result.outcome,
        },
        ...records().filter((r) => r.id !== round.id),
      ].slice(0, 365),
    );
}
function portraitPanel() {
  const character =
    view.kind === "guess"
      ? view.guess
      : view.kind === "complete"
        ? game.byId.get(round.result.id)
        : catalog.pokemon.find((p) => p.id === 65);
  return `<div class="pn-character ${view.kind === "question" ? "is-thinking" : ""}">${sprite(character, "pn-portrait")}<span>${view.kind === "question" || view.kind === "shortlist" ? t("포키네이터") : esc(name(character))}</span></div>`;
}
function stage() {
  if (view.kind === "question")
    return `${portraitPanel()}<div class="pn-question-content"><p class="pn-kicker">${t("마음속의 포켓몬은…")}</p><h2 id="pn-prompt" tabindex="-1" data-question="${view.question.id}" ${view.question.note ? 'aria-describedby="pn-question-note"' : ""}>${esc(questionText(view.question))}</h2>${view.question.note ? `<p id="pn-question-note">${esc(view.question.note[getLanguage()])}</p>` : ""}<div class="pn-answer-buttons">${Object.keys(
      answerLabels,
    )
      .map(
        (value) =>
          `<button class="pn-answer pn-${value}" data-answer="${value}">${icon(answerIcons[value])}${t(answerLabels[value])}</button>`,
      )
      .join("")}</div></div>`;
  if (view.kind === "guess")
    return `${portraitPanel()}<div class="pn-question-content"><p class="pn-kicker">${t(view.guess.weight < 0.78 ? "가장 유력한 후보예요" : "단서가 모였어요")}</p><h2 id="pn-prompt" tabindex="-1">${t("혹시 {pokemon}인가요?", { pokemon: esc(name(view.guess)) })}</h2><div class="pn-answer-buttons pn-confirm-buttons"><button class="pn-answer pn-yes" data-action="confirm">${icon("check")}${t("맞아요!")}</button><button class="pn-answer pn-no" data-action="reject">${icon("x")}${t("아니에요")}</button></div>${view.canAsk && !view.continued ? `<button class="text-button pn-continue" data-action="continue">${icon("circle-help")}${t("질문 더 해보기")}</button>` : ""}</div>`;
  if (view.kind === "shortlist")
    return `${portraitPanel()}<div class="pn-question-content"><p class="pn-kicker">${t("마지막 확인")}</p><h2 id="pn-prompt" tabindex="-1">${t("아직 확신하기 어려워요.")}</h2><p class="pn-result-copy">${t("생각한 포켓몬은 누구였나요?")}</p><label class="pn-search">${icon("search")}<input id="pn-search" type="search" aria-label="${t("포켓몬 이름 또는 도감 번호")}" placeholder="${t("이름 또는 도감 번호")}" value="${esc(query)}" autocomplete="off" /></label></div><div class="pn-candidates-area"><ul id="pn-candidates" aria-label="${t("마지막 후보")}"></ul><button id="pn-more" class="text-button" data-action="more" hidden>${icon("chevron-down")}${t("더 보기")}</button></div>`;
  const success = round.result.outcome === "guessed";
  return `${portraitPanel()}<div class="pn-question-content"><p class="pn-kicker">${t("추리 완료")}</p><h2 id="pn-prompt" tabindex="-1">${t(success ? "맞혔어요!" : "이번에는 놓쳤네요.")}</h2><p class="pn-result-copy">${t("{count}개의 질문", { count: view.answered })} · ${t("모르겠습니다 {count}회", { count: view.answered - view.known })}</p><div class="pn-result-actions"><button class="primary-button" data-action="share">${icon("share-2")}${t("결과 공유")}</button><button class="text-button" data-action="new">${icon("rotate-cw")}${t("새 포켓몬으로 도전")}</button></div></div>`;
}
function render(focus = false) {
  view = viewRound(game, round);
  app.innerHTML = `<header class="site-header"><div class="header-inner">${siteBrand()}<nav class="header-actions" aria-label="${t("게임 메뉴")}">${languagePicker()}${tool("stats", "내 기록", "chart-no-axes-column")}${tool("help", "게임 규칙", "circle-help")}</nav></div></header>
    <main class="main pn-main"><section class="pn-heading"><div><p class="eyebrow">${icon("brain")}${t("역방향 추리")}</p><h1>${t("포키네이터")}</h1></div><span class="pn-counter">${t("문답")} <strong>${view.answered}</strong><span>/ ${MAX_QUESTIONS}</span></span></section>
    <div class="pn-progress" role="progressbar" aria-label="${t("진행한 질문")}" aria-valuemin="0" aria-valuemax="${MAX_QUESTIONS}" aria-valuenow="${view.answered}"><span style="width:${(view.answered / MAX_QUESTIONS) * 100}%"></span></div>
    <p id="pn-save-warning" class="pn-warning" role="status" ${storageWarning ? "" : "hidden"}>${t("브라우저 저장 공간을 사용할 수 없어 진행 상황이 저장되지 않습니다.")}</p>
    ${roundUpdated ? `<p class="pn-warning" id="pn-updated" role="status">${t("질문이 업데이트되어 새 문답을 시작했어요. 완료한 기록은 유지됩니다.")}</p>` : ""}
    <section id="pn-stage" class="pn-stage pn-${view.kind}" aria-labelledby="pn-prompt">${stage()}</section>
    <div class="pn-tools">${tool("undo", "이전 답변으로", "undo-2", !round.events.length || !!round.result)}<span></span>${view.kind === "question" || view.kind === "guess" ? `<button class="text-button" data-action="stop">${icon("eye")}${t("여기까지 추리하기")}</button>` : ""}${view.kind !== "complete" ? tool("new", "새 포켓몬으로 도전", "rotate-cw") : ""}</div>
    <details id="pn-history" ${historyOpen ? "open" : ""}><summary><span>${t("문답 기록")} <b>${view.answered}</b></span>${icon("chevron-down")}</summary><ol class="pn-history-list">${round.events.map((e, index) => (e.kind === "answer" ? `<li><span class="pn-history-question">${esc(questionText(game.questionById.get(e.question)))}</span><span class="pn-history-answer pn-${e.value}">${icon(answerIcons[e.value])}${t(answerLabels[e.value])}</span>${!round.result ? `<button class="icon-button" data-rewind="${index}" aria-label="${esc(t("{question} — 이 답변부터 다시", { question: questionText(game.questionById.get(e.question)) }))}" data-tooltip="${t("이 답변부터 다시")}">${icon("undo-2")}</button>` : ""}</li>` : e.kind === "reject" ? `<li class="pn-rejected"><span>${t("{pokemon} 추측", { pokemon: esc(name(game.byId.get(e.id))) })}</span><span>${t("아니에요")}</span></li>` : "")).join("") || `<li class="pn-empty">${t("아직 답변한 질문이 없어요.")}</li>`}</ol></details>
    <footer class="footer pn-footer"><span>${t("포키네이터")} <span class="footer-dot">·</span> ${t("비공식 팬 게임")}</span><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">${t("데이터 · PokéAPI")} ${icon("arrow-right")}</a></footer></main>
    <dialog id="pn-dialog" aria-labelledby="pn-dialog-title"><div class="dialog-header"><h2 id="pn-dialog-title"></h2>${tool("close-dialog", "닫기", "x")}</div><div id="pn-dialog-body"></div></dialog><div id="pn-toast" class="pn-toast" role="status" aria-live="polite"></div>`;
  if (view.kind === "shortlist") renderCandidates();
  document.querySelector("#pn-history").addEventListener("toggle", (e) => {
    historyOpen = e.target.open;
  });
  document.querySelector("#pn-dialog").addEventListener("close", () => {
    dialogState = null;
    document.querySelector("#pn-prompt")?.focus({ preventScroll: true });
  });
  if (dialogState) showDialog(dialogState);
  refreshIcons();
  if (focus && !dialogState) {
    const prompt = document.querySelector("#pn-prompt");
    prompt.focus({ preventScroll: true });
    const bounds = prompt.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > innerHeight)
      prompt.scrollIntoView({ block: "center" });
  }
}
function renderCandidates() {
  const matches = query.trim()
    ? searchCandidates(game, query)
    : view.ranking.slice(0, 6);
  document.querySelector("#pn-candidates").innerHTML =
    matches
      .slice(0, limit)
      .map(
        (p) =>
          `<li><button data-pick="${p.id}">${sprite(p)}<span>${esc(name(p))}</span>${icon("arrow-right")}</button></li>`,
      )
      .join("") || `<li class="pn-empty">${t("검색 결과가 없어요.")}</li>`;
  document.querySelector("#pn-more").hidden = matches.length <= limit;
  refreshIcons();
}
function showDialog(state) {
  dialogState = state;
  let title, body;
  if (state.kind === "help") {
    title = "게임 규칙";
    body = `<ul class="dialog-list"><li>${t("정답 범위는 기본 모습, 리전폼, 메가진화입니다. 전설과 환상의 포켓몬도 포함됩니다.")}</li><li>${t("거다이맥스, 지가르데의 비율별 모습, 무늬와 기념폼은 원본으로 합칩니다. 합쳐진 포켓몬은 기본 모습 기준입니다.")}</li><li>${t("메가진화는 X·Y 등 각각의 모습을 구분합니다. 타입과 특성은 생각한 모습 기준입니다.")}</li><li>${t("질문은 최대 25개, 추측은 최대 3회입니다. 모르는 정보는 모르겠습니다로 답해도 됩니다.")}</li><li>${t("이전 답변을 바꾸면 그 이후의 문답부터 다시 추리합니다.")}</li></ul>`;
  } else if (state.kind === "new") {
    title = "새 도전을 시작할까요?";
    body = `<p class="dialog-copy">${t("진행 중인 문답은 초기화됩니다. 완료한 기록은 유지됩니다.")}</p><div class="pn-dialog-actions"><button class="text-button" data-action="close-dialog">${t("취소")}</button><button class="primary-button" data-action="restart">${icon("rotate-cw")}${t("새 포켓몬으로 도전")}</button></div>`;
  } else if (state.kind === "stats") {
    title = "내 기록";
    const rows = records();
    body = `<div class="stats-grid"><div><strong>${rows.length}</strong><span>${t("완료한 도전")}</span></div><div><strong>${rows.filter((r) => r.outcome === "guessed").length}</strong><span>${t("맞힌 도전")}</span></div></div><div class="pn-records">${
      rows
        .slice(0, 10)
        .map(
          (r) =>
            `<div>${sprite(game.byId.get(r.answerId))}<span><strong>${esc(name(game.byId.get(r.answerId)))}</strong><small>${esc(r.day)} · ${t("{count}개의 질문", { count: r.questions })}</small></span><b>${t(r.outcome === "guessed" ? "맞힘" : "놓침")}</b></div>`,
        )
        .join("") ||
      `<p class="dialog-copy">${t("아직 완료한 도전이 없어요.")}</p>`
    }</div>`;
  } else {
    title = "결과 공유";
    body = `<textarea class="share-text" readonly aria-label="${t("결과 공유")}">${esc(state.text)}</textarea>`;
  }
  document.querySelector("#pn-dialog-title").textContent = t(title);
  document.querySelector("#pn-dialog-body").innerHTML = body;
  refreshIcons();
  document.querySelector("#pn-dialog").showModal();
}
function restart() {
  dialogState = null;
  roundUpdated = false;
  round = newRound(game, crypto.randomUUID());
  historyOpen = false;
  query = "";
  limit = 20;
  saveProgress();
  render(true);
}
async function share() {
  if (!round.result) return;
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  const text = `${t("포키네이터")}\n${name(game.byId.get(round.result.id))} · ${t(round.result.outcome === "guessed" ? "맞힘" : "놓침")}\n${t("{count}개의 질문", { count: view.answered })}\n${url.href}`;
  try {
    if (navigator.share && matchMedia("(max-width:800px)").matches)
      await navigator.share({ title: t("포키네이터"), text });
    else {
      await navigator.clipboard.writeText(text);
      document.querySelector("#pn-toast").textContent = t("결과를 복사했어요.");
    }
  } catch (e) {
    if (e.name !== "AbortError") showDialog({ kind: "share", text });
  }
}
app.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!game || !button || button.disabled) return;
  const action = button.dataset.action;
  let changed = false;
  if (button.dataset.answer)
    changed = answerQuestion(game, round, button.dataset.answer);
  else if (button.dataset.rewind)
    changed = undo(round, Number(button.dataset.rewind));
  else if (button.dataset.pick)
    changed = finishRound(game, round, Number(button.dataset.pick));
  else if (action === "confirm") changed = finishRound(game, round);
  else if (action === "reject") changed = rejectGuess(game, round);
  else if (action === "continue") changed = askMore(game, round);
  else if (action === "undo") changed = undo(round);
  else if (action === "stop") changed = stopRound(round);
  else if (action === "new")
    return round.events.length && !round.result
      ? showDialog({ kind: "new" })
      : restart();
  else if (action === "restart") return restart();
  else if (["help", "stats"].includes(action))
    return showDialog({ kind: action });
  else if (action === "close-dialog")
    return document.querySelector("#pn-dialog").close();
  else if (action === "more") {
    limit += 20;
    return renderCandidates();
  } else if (action === "share") return void share();
  if (changed) {
    query = "";
    limit = 20;
    saveProgress();
    render(true);
  }
});
app.addEventListener("input", (e) => {
  if (e.target.id !== "pn-search") return;
  query = e.target.value;
  limit = 20;
  renderCandidates();
});
app.addEventListener(
  "error",
  (e) => {
    if (!e.target.matches?.(".pn-sprite img")) return;
    e.target.hidden = true;
    e.target.nextElementSibling.hidden = false;
  },
  true,
);
async function boot() {
  app.innerHTML = `<div class="loading-screen"><span class="loading-spinner"></span><strong>${t("포키네이터가 준비하고 있어요")}</strong></div>`;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}pokemantle.json`, {
      cache: "no-cache",
    });
    if (!response.ok) throw new Error("Catalog loading failed");
    catalog = await response.json();
    const questions = await fetch(`${import.meta.env.BASE_URL}pokinator.json`, {
      cache: "no-cache",
    });
    if (!questions.ok) throw new Error("Question loading failed");
    game = createPokinator(catalog, await questions.json());
    const saved = read(STORAGE_KEY);
    round = restoreRound(saved, game, crypto.randomUUID());
    try {
      const previous = JSON.parse(saved);
      roundUpdated =
        previous?.version?.startsWith("pokinator-") &&
        previous.dataVersion !== game.dataVersion &&
        previous.id !== round.id;
    } catch {
      /* Invalid saves already fall back to a new round. */
    }
    save(STORAGE_KEY, round);
    render();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="loading-screen"><h1>${t("게임을 불러오지 못했어요")}</h1><p>${t("연결을 확인하고 다시 시도해 주세요.")}</p><button class="primary-button" id="pn-retry">${t("다시 시도")}</button><a class="text-button" href="./">${t("게임 목록으로")}</a></div>`;
    document.querySelector("#pn-retry").onclick = () => location.reload();
  }
}
initLanguage("포키네이터 | 포켓몬 퀴즈", () => {
  if (round) render();
});
boot();
