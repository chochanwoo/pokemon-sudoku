import { GUESS_RANKS, rankFor } from "./trainer-ranks.js";
import { t } from "./i18n.js";
import "./trainer-results.css";

const images = import.meta.glob("./assets/trainers/*.png", {
  query: "?url",
  import: "default",
  eager: true,
});
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
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
export const rankName = (rank) =>
  t(GUESS_RANKS.find((tier) => tier.rank === rank)?.label || "-");

function portrait(rank) {
  const tier = GUESS_RANKS.find((tier) => tier.rank === rank);
  const src = tier && images[`./assets/trainers/${tier.sprite}.png`];
  return `<span class="trainer-portrait${src ? "" : " is-missing"}" aria-hidden="true">${src ? `<img data-trainer src="${src}" alt="" width="80" height="80" draggable="false" />` : ""}<span class="trainer-image-fallback">${icon("trophy")}</span></span>`;
}

export function onTrainerImageError(event) {
  if (event.target.matches?.("img[data-trainer]"))
    event.target.parentElement.classList.add("is-missing");
}

export function trainerBadge(rank, extraClass = "") {
  if (!rank) return "";
  return `<span class="trainer-badge trainer-tier-${rank} ${extraClass}">${portrait(rank)}<span>${esc(rankName(rank))}</span></span>`;
}

export function trainerReplay(rank, extraClass = "") {
  return `<button class="trainer-replay" data-action="trainer-result" aria-label="${esc(t("{rank} · 등급 다시 보기", { rank: rankName(rank) }))}" data-tooltip="${t("등급 다시 보기")}">${trainerBadge(rank, extraClass)}${icon("chevron-down")}</button>`;
}

export function trainerGuide(extraClass = "", ranks = GUESS_RANKS) {
  return `<section class="trainer-rank-rules"><h3>${t("등급 기준")}</h3><dl class="trainer-rank-guide ${extraClass}">${ranks
    .map((tier, index) => {
      const min = index ? ranks[index - 1].max + 1 : 1;
      const range = Number.isFinite(tier.max)
        ? t("{min}~{max}회", { min, max: tier.max })
        : t("{min}회 이상", { min });
      return `<div><dt>${trainerBadge(tier.rank)}</dt><dd>${range}</dd></div>`;
    })
    .join("")}</dl></section>`;
}

export function trainerResult({
  attempts,
  context,
  answerName,
  answerSprite,
  hints,
  legacyWin,
  ranks = GUESS_RANKS,
}) {
  const rank = rankFor(attempts, ranks);
  if (!rank) return "";
  return `<div class="trainer-award trainer-tier-${rank}" data-trainer-rank="${rank}">
    <p class="trainer-context">${esc(context)}</p>
    <div class="trainer-stage">${portrait(rank)}</div>
    <p class="trainer-kicker">${t("당신의 트레이너 등급")}</p>
    <h3 class="trainer-award-title">${esc(rankName(rank))}</h3>
    <p class="trainer-attempts">${t("{count}번 만에 정답", { count: attempts })}</p>
    <div class="trainer-answer">${answerSprite}<div><span>${t("정답")}</span><strong>${esc(answerName)}</strong></div></div>
    ${Number.isInteger(hints) ? `<p class="trainer-hints">${t("힌트 {count}회", { count: hints })}</p>` : ""}
    ${legacyWin ? `<p class="trainer-legacy">${t("이전 세대 기준으로 완료한 기록입니다. 기존 정답 인정은 유지됩니다.")}</p>` : ""}
  </div><div class="trainer-result-actions"><button class="primary-button wide" data-action="share-award">${icon("share-2")}${t("결과 공유")}</button><button class="text-button" data-action="close-dialog">${t("계속 보기")}${icon("arrow-right")}</button></div>`;
}
