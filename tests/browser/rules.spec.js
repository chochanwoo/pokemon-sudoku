import { test, expect } from "@playwright/test";
import { chooseLanguage } from "../../scripts/browser-language.mjs";
import english from "../../web/src/locales/en.js";

const practice = "연습 모드를 통해 더 많은 퀴즈를 즐겨보세요!";
const guess = "오늘의 포켓몬을 맞혀보세요!";
const pokemonReset = "오늘의 포켓몬은 한국 시간 자정에 변경됩니다.";
const cases = [
  {
    page: "sudoku",
    lines: [
      "포켓몬 타입 스도쿠를 완성해보세요!",
      "같은 가로줄, 세로줄, 굵은 선으로 나눈 구역 안에서는 <strong>어떤 타입도 두 번 나올 수 없습니다.</strong>",
      "<strong>같은 포켓몬은 보드 전체에서 한 번만</strong> 사용할 수 있습니다. 주어진 포켓몬도 포함합니다.",
      "주어진 포켓몬은 바꿀 수 없습니다.",
      "같은 타입 조합이라도 서로 다른 포켓몬이면 사용할 수 있습니다.",
    ],
    footer: "오늘의 퍼즐은 한국 시간 자정에 바뀝니다.",
  },
  {
    page: "pokemantle",
    lines: [
      guess,
      "오늘의 포켓몬에 대한 힌트가 유사도로 주어집니다! 유사도가 높을수록 정답과 가깝습니다.",
      "유사도에는 타입, 특성, 알 그룹, 도감 설명, 배우는 기술, 모티브 요소 등 거의 모든 것이 포함됩니다!",
      "힌트는 지금보다 가까운 포켓몬을 최대 3번 공개하며 시도 횟수에 포함됩니다.",
    ],
    footer: pokemonReset,
  },
  {
    page: "pokeclue",
    lines: [
      guess,
      "타입, 특성, 알 그룹, 진화 단계, 최초 출현 세대, 종족값 합계가 힌트로 주어집니다.",
      "외형이 다른 동일한 포켓몬(플라엣테 빨간 꽃, 노란 꽃 등)은 모두 동일하게 정답으로 간주됩니다.",
      practice,
    ],
    footer: pokemonReset,
  },
  {
    page: "highlow",
    lines: [
      "어느 포켓몬의 종족값이 더 높을까요?",
      "틀릴 때까지 도전이 계속됩니다.",
      practice,
    ],
    footer: "데일리 문제의 출제 순서는 한국 시간 자정에 변경됩니다.",
  },
  {
    page: "pokinator",
    lines: [
      "똑똑한 윤겔라가 당신이 생각한 포켓몬을 맞힐 수 있을까요?",
      "질문은 최대 25개, 추측은 최대 3회입니다.",
      "뒤로가기를 통해 이전 질문의 답변을 바꿀 수 있습니다. 답변을 바꾸면 그 이후의 문답부터 다시 추리합니다.",
    ],
  },
  {
    page: "scratch",
    lines: [
      "가림막 뒤에는 어떤 포켓몬이 숨어있을까요? 마우스나 손가락으로 문지르거나, 커서를 올린 뒤 Space 또는 Enter로 지울 수 있어요.",
      "퀴즈 한 세트는 총 5개의 문제로 구성되며, 각 문제마다 100점의 점수가 배정됩니다.",
      "가림막을 긁어낼수록 점수가 더 낮아집니다!",
      practice,
    ],
    footer: "데일리 문제는 한국 시간 자정에 변경됩니다.",
  },
];

for (const item of cases) {
  test(`${item.page}: friendly bilingual rules have no rank cutoffs and fit small screens`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`./${item.page}.html`);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 1080 });
      for (const language of ["ko", "en"]) {
        await chooseLanguage(page, language);
        await page.locator('[data-action="help"]').click();
        const popup = page.locator("dialog[open]");
        const translated = (text) => (language === "ko" ? text : english[text]);
        const textOnly = (text) => text.replaceAll(/<\/?strong>/g, "");
        await expect(popup.locator("li")).toHaveText(
          item.lines.map((line) => textOnly(translated(line))),
        );
        if (item.footer)
          await expect(popup).toContainText(translated(item.footer));
        await expect(
          popup.locator(".trainer-rank-guide, .trainer-rank-rules"),
        ).toHaveCount(0);
        expect(await popup.innerText()).not.toMatch(/등급 기준|Rank criteria/);
        if (language === "en")
          expect(await popup.innerText()).not.toMatch(/[가-힣]/);
        if (item.page === "pokemantle")
          expect(await popup.innerText()).not.toMatch(/연습|Practice/);
        if (item.page === "sudoku")
          await expect(popup.locator("li strong")).toHaveCount(2);
        const fit = await popup.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left >= 0 &&
            r.right <= innerWidth &&
            r.top >= 0 &&
            r.bottom <= innerHeight &&
            el.scrollWidth <= el.clientWidth
          );
        });
        expect(fit).toBe(true);
        await page.screenshot({
          path: `.preview/rules-${item.page}-${language}-${width}.png`,
        });
        await popup.locator('[data-action="close-dialog"]').click();
        await expect(popup).toHaveCount(0);
      }
    }
    expect(errors).toEqual([]);
  });
}
