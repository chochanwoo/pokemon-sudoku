import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  dailyTarget,
  createSimilarity,
  searchForms,
} from "../../web/src/similarity-engine.js";

const data = JSON.parse(
  readFileSync(new URL("../../web/public/pokemantle.json", import.meta.url)),
);
const bytes = readFileSync(
  new URL("../../web/public/pokemantle-scores.bin", import.meta.url),
);
const game = createSimilarity(
  data,
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const regionalId = data.pokemon.find((p) => p.key === "vulpix-alola").id;
function dateFor(id) {
  const start = Date.parse("2026-09-01T00:00:00Z");
  for (let i = 0; i < data.pokemon.length; i++) {
    const day = new Date(start - i * 86400000).toISOString().slice(0, 10);
    if (dailyTarget(data, day) === id) return day;
  }
  throw new Error("Target date missing");
}
const regionalDate = dateFor(regionalId);
const path = `./pokemantle.html?date=${regionalDate}`;

async function guess(page, key) {
  const pokemon = data.pokemon.find((p) => p.key === key);
  await page
    .getByRole("combobox", { name: "포켓몬 이름 또는 도감 번호" })
    .fill(key);
  await page.locator(`#guess-options [data-guess="${pokemon.id}"]`).click();
}

test("regional forms are distinct answers; keyboard guessing, duplicate prevention, save and spoiler-free sharing work", async ({
  page,
}) => {
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(path);
  const input = page.getByRole("combobox", {
    name: "포켓몬 이름 또는 도감 번호",
  });
  await expect(input).toBeVisible();
  await expect(page.locator("#answer-panel")).toBeHidden();
  await input.fill("식스테일");
  await expect(page.locator("#guess-options").getByRole("option")).toHaveCount(
    2,
  );
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page.locator("#attempts")).toHaveText("1");
  await expect(page.locator("#answer-panel")).toBeHidden();
  await expect(page.locator('[data-result="37"] .pm-score strong')).toHaveText(
    game.score(regionalId, 37).toFixed(2),
  );
  await guess(page, "vulpix");
  await expect(page.locator("#attempts")).toHaveText("1");
  await expect(page.locator("#pm-toast")).toHaveText("이미 추측한 모습이에요.");
  await page.reload();
  await expect(page.locator("#attempts")).toHaveText("1");
  await input.fill("알로라식스테일");
  await expect(page.locator("#guess-options").getByRole("option")).toHaveCount(
    1,
  );
  await input.press("Enter");
  await expect(page.locator("#answer-title")).toHaveText("식스테일 (알로라)");
  await expect(page.locator("#best-score")).toHaveText("100.00");
  await expect(page.locator("#best-rank")).toHaveText("1위");
  await expect(input).toBeHidden();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.sharedResult = text;
        },
      },
    }),
  );
  await page.getByRole("button", { name: "결과 공유" }).click();
  const shared = await page.evaluate(() => window.sharedResult);
  expect(shared).not.toContain("식스테일");
  expect(shared).toContain(`pokemantle.html?date=${regionalDate}`);
  await page.reload();
  await expect(page.locator("#answer-title")).toHaveText("식스테일 (알로라)");
  await page.getByRole("button", { name: "내 기록" }).click();
  await expect(page.locator("#pm-dialog-body")).toContainText("2회 정답");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("link", { name: "게임 목록으로" }).click();
  await page
    .getByRole("link", { name: "포켓몬틀 플레이", exact: true })
    .click();
  await expect(page).toHaveURL(/\/pokemon\/pokemantle\.html$/);
  await expect(input).toBeVisible();
  expect(errors).toEqual([]);
  expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(
    true,
  );
});

test("mobile search, long form names, images, sorting and hints fit without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  const input = page.getByRole("combobox", {
    name: "포켓몬 이름 또는 도감 번호",
  });
  await input.fill("없는포켓몬");
  await expect(page.locator("#match-count")).toHaveText(
    "일치하는 포켓몬이 없어요.",
  );
  await page.getByRole("button", { name: "검색 지우기" }).click();
  await expect(page.locator("#suggestions")).toBeHidden();
  await guess(page, "pikachu");
  await guess(page, "tauros-paldea-aqua-breed");
  await guess(page, "urshifu-rapid-strike-gmax");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1080 });
    const fit = await page.locator(".pm-main").evaluate(async (main) => {
      await Promise.all(
        [...main.querySelectorAll("img")].map((img) => img.decode()),
      );
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        images: [...main.querySelectorAll("img")].every(
          (img) => img.naturalWidth > 0,
        ),
        rows: [...main.querySelectorAll("tbody tr")].every((row) => {
          const cells = [...row.children].map((c) => c.getBoundingClientRect());
          return cells.every(
            (cell, i) => !i || cell.left >= cells[i - 1].right - 1,
          );
        }),
      };
    });
    expect(fit).toEqual({ overflow: false, images: true, rows: true });
    await page.screenshot({
      path: `.preview/pokemantle-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByLabel("기록 정렬").selectOption("recent");
  await expect(page.locator("#guess-history tr").first()).toContainText(
    "우라오스",
  );
  await page.getByLabel("기록 정렬").selectOption("score");
  let best = Number(await page.locator("#best-score").textContent());
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-action="hint"]').click();
    const current = Number(await page.locator("#best-score").textContent());
    expect(current).toBeGreaterThan(best);
    best = current;
  }
  await expect(page.locator("#hint-label")).toHaveText("힌트 3/3");
  await expect(page.locator('[data-action="hint"]')).toBeDisabled();
  await expect(page.locator("#answer-panel")).toBeHidden();
  await page.reload();
  await expect(page.locator("#hint-label")).toHaveText("힌트 3/3");
  await expect(page.locator("#attempts")).toHaveText("6");
});

test("giving up is confirmed and persists; bad storage and blocked storage do not break guessing", async ({
  page,
}) => {
  await page.addInitScript((day) => {
    if (!sessionStorage.getItem("seeded-corrupt-round")) {
      localStorage.setItem("typedoku:settings", "sudoku-untouched");
      localStorage.setItem(`pokemantle:pokemantle-v1:${day}`, "{invalid");
      sessionStorage.setItem("seeded-corrupt-round", "yes");
    }
  }, regionalDate);
  await page.goto(path);
  await expect(page.locator("#attempts")).toHaveText("0");
  await page.getByRole("button", { name: "포기", exact: true }).click();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator("#answer-panel")).toBeHidden();
  await page.getByRole("button", { name: "포기", exact: true }).click();
  await page.getByRole("button", { name: "정답 공개", exact: true }).click();
  await expect(page.locator("#answer-title")).toHaveText("식스테일 (알로라)");
  const saved = await page.evaluate(() =>
    JSON.parse(
      localStorage[
        Object.keys(localStorage).find((key) =>
          key.startsWith("pokemantle:pokemantle-v1:"),
        )
      ],
    ),
  );
  expect(saved.gaveUp).toBe(true);
  await page.reload();
  await expect(page.locator("#answer-title")).toHaveText("식스테일 (알로라)");
  expect(
    await page.evaluate(() => localStorage.getItem("typedoku:settings")),
  ).toBe("sudoku-untouched");
  await page.goto("./pokemantle.html");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "QuotaExceededError");
    };
  });
  await guess(page, "pikachu");
  await expect(page.locator("#save-warning")).toBeVisible();
  await expect(page.locator("#attempts")).toHaveText("1");
});

test("Korean midnight offers a new round without discarding the current guesses", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-10T14:59:00Z") });
  await page.goto("./pokemantle.html");
  await guess(page, "pikachu");
  await expect(page.locator("#new-day")).toBeHidden();
  await page.clock.fastForward(61000);
  await expect(page.locator("#new-day")).toBeVisible();
  await expect(page.locator("#attempts")).toHaveText("1");
  await page.getByRole("button", { name: "오늘의 문제", exact: true }).click();
  await expect(page.locator("#pm-date")).toContainText("2026.09.11");
  await expect(page.locator("#attempts")).toHaveText("0");
  await expect(page.locator("#new-day")).toBeHidden();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("pokemantle:pokemantle-v1:2026-09-10"),
    ),
  ).toContain('"id":25');
});

test("mismatched deployment data shows a recoverable error instead of scoring guesses incorrectly", async ({
  page,
}) => {
  await page.route("**/pokemantle-scores.bin*", (route) =>
    route.fulfill({
      body: Buffer.alloc(4),
      contentType: "application/octet-stream",
    }),
  );
  await page.goto("./pokemantle.html");
  await expect(
    page.getByRole("heading", { name: "게임을 불러오지 못했어요" }),
  ).toBeVisible();
  await page.unroute("**/pokemantle-scores.bin*");
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(
    page.getByRole("combobox", { name: "포켓몬 이름 또는 도감 번호" }),
  ).toBeVisible();
});

test("touch selection preserves the exact regional form and feedback stays outside the table", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(
      `http://127.0.0.1:4173/pokemon/pokemantle.html?date=${regionalDate}`,
    );
    const input = page.getByRole("combobox", {
      name: "포켓몬 이름 또는 도감 번호",
    });
    await input.tap();
    await input.fill("식스테일");
    await page.locator('#guess-options [data-guess="37"]').tap();
    await expect(page.locator("#attempts")).toHaveText("1");
    const message = await page.locator("#pm-toast").boundingBox();
    const history = await page.locator("#history-panel").boundingBox();
    expect(message.y + message.height).toBeLessThanOrEqual(history.y);
    await input.fill("알로라 식스테일");
    await page.locator(`#guess-options [data-guess="${regionalId}"]`).tap();
    await expect(page.locator("#answer-title")).toHaveText("식스테일 (알로라)");
    await page.screenshot({
      path: ".preview/pokemantle-touch-win.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

async function expectRanking(page, rows) {
  await expect(page.locator("#similarity-ranking tr")).toHaveCount(rows.length);
  const actual = await page
    .locator("#similarity-ranking tr")
    .evaluateAll((elements) =>
      elements.map((row) => ({
        id: Number(row.dataset.ranking),
        rank: row.querySelector(".pm-rank").textContent,
        score: row.querySelector(".pm-score strong").textContent,
      })),
    );
  expect(actual).toEqual(
    rows.map((row) => ({
      id: row.id,
      rank: `${row.rank.toLocaleString("ko-KR")}위`,
      score: row.score.toFixed(2),
    })),
  );
}

test("winning unlocks ranked results with paging, search and accessible history tabs", async ({
  page,
}) => {
  await page.goto(path);
  await expect(page.locator("#result-tabs")).toBeHidden();
  await expect(page.locator("#ranking-panel")).toBeHidden();
  await expectRanking(page, []);
  await guess(page, "vulpix");
  await expectRanking(page, []);
  await guess(page, "vulpix-alola");
  const ranking = game.ranking(regionalId);
  await expect(page.getByRole("tab", { name: "유사도 순위" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#ranking-panel")).toBeVisible();
  await expect(page.locator("#history-panel")).toBeHidden();
  await expectRanking(page, ranking.slice(0, 20));
  await expect(
    page.locator(`#similarity-ranking [data-ranking="${regionalId}"]`),
  ).toContainText("정답");
  await page.locator("#more-ranking").click();
  await expectRanking(page, ranking.slice(0, 40));

  await page.getByRole("tab", { name: "내 추측", exact: true }).click();
  await expect(page.locator("#history-panel")).toBeVisible();
  await expect(page.locator("#guess-history tr")).toHaveCount(2);
  await expect(page.locator("#ranking-panel")).toBeHidden();
  await page.locator("#history-tab").press("ArrowLeft");
  await expect(page.locator("#ranking-tab")).toBeFocused();
  await expect(page.locator("#ranking-panel")).toBeVisible();
  await expectRanking(page, ranking.slice(0, 40));
  await page.locator("#ranking-tab").press("End");
  await expect(page.locator("#history-tab")).toBeFocused();
  await page.locator("#history-tab").press("Home");
  await expect(page.locator("#ranking-tab")).toBeFocused();

  const search = page.getByRole("searchbox", { name: "순위에서 포켓몬 검색" });
  await search.fill("식스테일");
  await expect(page.locator('[data-ranking="37"]')).toContainText("내 추측");
  await search.fill("리자몽");
  const matched = new Set(searchForms(data.pokemon, "리자몽").map((p) => p.id));
  await expectRanking(
    page,
    ranking.filter((row) => matched.has(row.id)),
  );
  await expect(page.locator("#more-ranking")).toBeHidden();
  await search.fill("없는포켓몬");
  await expectRanking(page, []);
  await expect(page.locator("#ranking-empty")).toBeVisible();
  await page.getByRole("button", { name: "순위 검색 지우기" }).click();
  await expect(search).toBeFocused();
  await expectRanking(page, ranking.slice(0, 20));
  await page.reload();
  await expect(page.locator("#ranking-panel")).toBeVisible();
  await expectRanking(page, ranking.slice(0, 20));
  await expect(page.locator("#attempts")).toHaveText("2");
});

test("giving up reveals the same rankings and preserves global ranks including ties", async ({
  page,
}) => {
  await page.goto(path);
  await page.getByRole("button", { name: "포기", exact: true }).click();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator("#result-tabs")).toBeHidden();
  await expectRanking(page, []);
  await page.getByRole("button", { name: "포기", exact: true }).click();
  await page.getByRole("button", { name: "정답 공개", exact: true }).click();
  await expect(page.locator("#ranking-panel")).toBeVisible();
  const ranking = game.ranking(regionalId);
  await expectRanking(page, ranking.slice(0, 20));
  const search = page.getByRole("searchbox", { name: "순위에서 포켓몬 검색" });
  const last = ranking.at(-1);
  await search.fill(game.byId.get(last.id).key);
  await expect(page.locator(`[data-ranking="${last.id}"] .pm-rank`)).toHaveText(
    `${last.rank.toLocaleString("ko-KR")}위`,
  );
  const tied = ranking.find(
    (row, i) => i > 0 && row.rank === ranking[i - 1].rank,
  );
  expect(tied).toBeTruthy();
  await search.fill(game.byId.get(tied.id).key);
  await expect(page.locator(`[data-ranking="${tied.id}"] .pm-rank`)).toHaveText(
    `${tied.rank.toLocaleString("ko-KR")}위`,
  );
  await page.getByRole("tab", { name: "내 추측", exact: true }).click();
  await expect(page.locator("#empty-history")).toBeVisible();
  await page.reload();
  await expect(page.locator("#ranking-panel")).toBeVisible();
  await expectRanking(page, ranking.slice(0, 20));
  await expect(page.locator("#attempts")).toHaveText("0");
});

test("revealed rankings fit mobile and desktop, render images, and clear for a new day", async ({
  page,
}) => {
  await page.goto(path);
  await guess(page, "tauros-paldea-aqua-breed");
  await guess(page, "urshifu-rapid-strike-gmax");
  await guess(page, "vulpix-alola");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1080 });
    for (const query of ["", "우라오스", "팔데아"]) {
      await page.locator("#ranking-search").fill(query);
      const fit = await page
        .locator("#ranking-panel")
        .evaluate(async (panel) => {
          const images = [...panel.querySelectorAll("img")];
          await Promise.all(images.map((img) => img.decode()));
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            images: images.every((img) => img.naturalWidth > 0),
            cells: [...panel.querySelectorAll("tbody td, tbody th")].every(
              (cell) => cell.scrollWidth <= cell.clientWidth + 1,
            ),
            names: [...panel.querySelectorAll(".pm-pokemon > span")].every(
              (name) => {
                const box = name.getBoundingClientRect();
                const cell = name.closest("th").getBoundingClientRect();
                return box.right <= cell.right && box.bottom <= cell.bottom;
              },
            ),
          };
        });
      expect(fit).toEqual({
        overflow: false,
        images: true,
        cells: true,
        names: true,
      });
      if (query !== "팔데아") {
        await page.screenshot({
          path: `.preview/pokemantle-ranking-${width}${query ? "-long" : ""}.png`,
          fullPage: true,
        });
      }
    }
  }
  await page.getByRole("button", { name: "오늘의 문제", exact: true }).click();
  await expect(page.locator("#result-tabs")).toBeHidden();
  await expect(page.locator("#ranking-panel")).toBeHidden();
  await expectRanking(page, []);
  await expect(page.locator("#history-panel")).toBeVisible();
  await expect(page.locator("#attempts")).toHaveText("0");
});

test("new weights rescore existing guesses without changing today's answer, and close guesses look close", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-10T03:00:00Z") });
  await page.setViewportSize({ width: 320, height: 844 });
  const legacy = {
    version: "pokemantle-v1",
    day: "2026-09-10",
    guesses: [
      { id: 381, hint: false },
      { id: 150, hint: true },
    ],
    gaveUp: false,
  };
  await page.addInitScript((round) => {
    if (!localStorage.getItem(`pokemantle:${round.version}:${round.day}`))
      localStorage.setItem(
        `pokemantle:${round.version}:${round.day}`,
        JSON.stringify(round),
      );
  }, legacy);
  await page.goto("./pokemantle.html");
  await expect(page.locator("#attempts")).toHaveText("2");
  await expect(page.locator("#hint-label")).toHaveText("힌트 1/3");
  const latios = page.locator('[data-result="381"]');
  await expect(latios.locator(".pm-score strong")).toHaveText(
    game.score(10316, 381).toFixed(2),
  );
  await expect(latios.locator(".pm-score")).toHaveClass(/hot/);
  await expect(latios.locator(".pm-proximity")).toHaveText("매우 가까움");
  await expect(page.locator("#answer-panel")).toBeHidden();
  await expect(page.locator("#ranking-panel")).toBeHidden();
  await page.getByRole("button", { name: "게임 규칙" }).click();
  for (const weight of [
    "타입 25%",
    "진화·폼 관계 20%",
    "전설·환상 분류 15%",
    "설정·모티브 10%",
    "종족값 10%",
    "도감 설명 5%",
  ])
    await expect(page.locator("#pm-dialog-body")).toContainText(weight);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1080 });
    const fits = await page
      .locator("#guess-history")
      .evaluate((body) =>
        [...body.querySelectorAll("td, th")].every(
          (cell) => cell.scrollWidth <= cell.clientWidth + 1,
        ),
      );
    expect(fits).toBe(true);
    await page.screenshot({
      path: `.preview/pokemantle-closeness-${width}.png`,
      fullPage: true,
    });
  }
  await guess(page, "necrozma-ultra");
  await expect(page.locator("#answer-title")).toHaveText(
    "네크로즈마 (울트라네크로즈마)",
  );
  await expect(page.locator('[data-ranking="381"] .pm-proximity')).toHaveText(
    "매우 가까움",
  );
  await page.reload();
  await expect(page.locator("#attempts")).toHaveText("3");
  await expect(page.locator("#answer-title")).toHaveText(
    "네크로즈마 (울트라네크로즈마)",
  );
});
