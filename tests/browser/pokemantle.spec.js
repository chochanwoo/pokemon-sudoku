import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  dailyTarget,
  createSimilarity,
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
    const history = await page.locator(".pm-history").boundingBox();
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
