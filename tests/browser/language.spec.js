import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { englishName } from "../../web/src/pokemon-names.js";

const catalog = JSON.parse(
  readFileSync(new URL("../../web/public/catalog.json", import.meta.url)),
);

const language = (page, value) =>
  page.locator("[data-language-select]").selectOption(value);
const sudoku = "./sudoku.html?size=4&level=easy&seed=free:language";
const mantle = "./pokemantle.html?date=2026-09-10";

async function noKoreanUI(page) {
  const untranslated = await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const found = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (
        !node.parentElement.closest("select,script,style,noscript") &&
        /[가-힣]/.test(node.textContent)
      )
        found.push(node.textContent);
    }
    for (const el of document.querySelectorAll(
      "[aria-label],[title],[alt],[placeholder]",
    ))
      for (const attr of ["aria-label", "title", "alt", "placeholder"])
        if (/[가-힣]/.test(el.getAttribute(attr) || ""))
          found.push(`${attr}: ${el.getAttribute(attr)}`);
    return found;
  });
  expect(untranslated).toEqual([]);
}

async function savedSudoku(page) {
  return page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith("typedoku:game:"))
      .map(([key, value]) => {
        const { elapsedMs, ...state } = JSON.parse(value);
        return [key, state];
      }),
  );
}

test("language persists across the library, both games and reloads", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await language(page, "en");
  await expect(page).toHaveTitle("Pokemon Quiz");
  await expect(page.getByRole("heading", { name: "All games" })).toBeVisible();
  await noKoreanUI(page);
  await page.reload();
  await expect(page.locator("[data-language-select]")).toHaveValue("en");
  await page.getByRole("link", { name: "Typedoku Play", exact: true }).click();
  await expect(page.locator(".cell")).toHaveCount(36);
  await expect(page).toHaveTitle("Typedoku | Pokemon Quiz");
  await noKoreanUI(page);
  await page.getByRole("button", { name: "Rules", exact: true }).click();
  await expect(page.locator("#dialog-title")).toHaveText("Typedoku rules");
  await noKoreanUI(page);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "Pokemon Quiz home" }).click();
  await page
    .getByRole("link", { name: "Pokemantle Play", exact: true })
    .click();
  await expect(page.locator("#guess-input")).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveTitle("Pokemantle | Pokemon Quiz");
  await noKoreanUI(page);
  await page.getByRole("button", { name: "Rules", exact: true }).click();
  await expect(page.locator("#pm-dialog-title")).toHaveText("Pokemantle rules");
  await noKoreanUI(page);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await language(page, "ko");
  await page.getByRole("link", { name: "포켓몬 퀴즈 메인으로" }).click();
  await expect(page.getByRole("heading", { name: "전체 게임" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Typedoku switches in place without losing notes, undo, cheat state or search", async ({
  page,
}) => {
  await page.goto(sudoku);
  await expect(page.locator(".cell")).toHaveCount(16);
  const cell = page.locator(".cell:not(.given)").first();
  const index = await cell.getAttribute("data-cell");
  await cell.click();
  const note = page.locator("[data-note]").first();
  const type = await note.getAttribute("data-note");
  await note.check();
  await page.locator('[data-action="cheat"]').click();
  const id = Number(
    await page.locator(".pokemon-choice").first().getAttribute("data-pokemon"),
  );
  const pokemon = catalog.pokemon.find((p) => p.id === id);
  const name = englishName(pokemon);
  await page.locator("#search").fill(name);
  const before = await savedSudoku(page);
  for (const lang of ["en", "ko", "en"]) await language(page, lang);
  expect(await savedSudoku(page)).toEqual(before);
  await expect(page.locator(`[data-note="${type}"]`)).toBeChecked();
  await expect(page.locator(`[data-cell="${index}"]`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator('[data-action="cheat"]')).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.locator("#search")).toHaveValue(name);
  await expect(page.locator(`[data-pokemon="${id}"]`)).toContainText(name);
  await noKoreanUI(page);
  await page.locator("#search").fill(pokemon.name);
  await expect(page.locator(`[data-pokemon="${id}"]`)).toContainText(name);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(`[data-cell="${index}"] .note-dot`)).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(`[data-cell="${index}"] .note-dot`)).toHaveCount(1);
  await page.getByRole("button", { name: "Hint", exact: true }).click();
  const afterHint = await savedSudoku(page);
  expect(afterHint[0][1].hints).toBe(1);
  await language(page, "ko");
  expect(await savedSudoku(page)).toEqual(afterHint);
  await page.reload();
  await expect(page.locator(".cell")).toHaveCount(16);
  expect(await savedSudoku(page)).toEqual(afterHint);
  await language(page, "en");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await language(page, "ko");
  await expect(page.locator("#pause-cover")).toBeVisible();
  await language(page, "en");
  await expect(page.locator("#pause-cover")).toContainText("Take a break");
});

test("Pokemantle keeps guesses, ranking, queries and form distinctions across languages", async ({
  page,
}) => {
  await page.goto(mantle);
  await expect(page.locator("#guess-input")).toBeVisible({ timeout: 10000 });
  await page.locator("#guess-input").fill("라티오스");
  await page.locator('#guess-options [data-guess="381"]').click();
  const score = await page
    .locator('[data-result="381"] .pm-score strong')
    .textContent();
  const key = "pokemantle:pokemantle-v1:2026-09-10";
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator("#guess-input").fill("알로라식스테일");
  await page.locator("#guess-sort").selectOption("recent");
  for (const lang of ["en", "ko", "en"]) await language(page, lang);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
  await expect(page.locator("#guess-input")).toHaveValue("알로라식스테일");
  await expect(page.locator("#guess-options")).toContainText("Alolan Vulpix");
  await expect(page.locator("#guess-sort")).toHaveValue("recent");
  await expect(page.locator('[data-result="381"] .pm-score strong')).toHaveText(
    score,
  );
  await expect(page.locator("#pm-date")).toContainText("2026.09.10");
  await noKoreanUI(page);
  await page.locator("#guess-input").fill("Alolan Vulpix");
  await page.locator('#guess-options [data-guess="10205"]').click();
  await expect(page.locator("#attempts")).toHaveText("2");
  await page.locator('[data-action="hint"]').click();
  await expect(page.locator("#attempts")).toHaveText("3");
  await expect(page.locator("#hint-label")).toHaveText("Hints 1/3");
  await page.getByRole("button", { name: "Give up", exact: true }).click();
  await noKoreanUI(page);
  await page
    .getByRole("button", { name: "Reveal answer", exact: true })
    .click();
  await expect(page.locator("#answer-title")).toHaveText("Ultra Necrozma");
  await page.locator("#ranking-search").fill("necrozma");
  const rankingIds = await page
    .locator("[data-ranking]")
    .evaluateAll((rows) => rows.map((row) => row.dataset.ranking));
  await language(page, "ko");
  await expect(page.locator("#answer-title")).toContainText("네크로즈마");
  await expect(page.locator("#ranking-panel")).toBeVisible();
  await expect(page.locator("#ranking-search")).toHaveValue("necrozma");
  expect(
    await page
      .locator("[data-ranking]")
      .evaluateAll((rows) => rows.map((row) => row.dataset.ranking)),
  ).toEqual(rankingIds);
  await language(page, "en");
  await noKoreanUI(page);
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
  await page.getByRole("button", { name: "Share result", exact: true }).click();
  const shared = await page.evaluate(() => window.sharedResult);
  expect(shared).toContain("Pokemantle 2026-09-10");
  expect(shared).not.toMatch(/Necrozma|네크로즈마/);
  await page.reload();
  await expect(page.locator("#answer-title")).toHaveText("Ultra Necrozma", {
    timeout: 10000,
  });
  await expect(page.locator("#attempts")).toHaveText("3");
  await page.getByRole("button", { name: "My stats", exact: true }).click();
  await noKoreanUI(page);
});

test("language works in memory with blocked storage", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    }),
  );
  await page.goto(sudoku);
  await expect(page.locator(".cell")).toHaveCount(16);
  await language(page, "en");
  await expect(page).toHaveTitle("Typedoku | Pokemon Quiz");
  await page.getByRole("button", { name: "Hint", exact: true }).click();
  await language(page, "ko");
  await expect(page).toHaveTitle("타입도쿠 | 포켓몬 퀴즈");
});

test("English layouts fit mobile and desktop with real game images", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.addInitScript(() =>
    localStorage.setItem("pokemon-quiz:language", "en"),
  );
  for (const [name, path] of [
    ["home", "./"],
    ["sudoku", sudoku],
    ["pokemantle", mantle],
  ]) {
    await page.goto(path);
    await expect(page.locator(".brand")).toBeVisible({ timeout: 10000 });
    if (name === "pokemantle") {
      await page.locator("#guess-input").fill("tauros-paldea-aqua-breed");
      await page.locator("#guess-options [role=option]").first().click();
      await page
        .locator("#guess-input")
        .fill("alcremie vanilla cream strawberry sweet");
      await page.locator("#guess-options [role=option]").first().click();
    }
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const brand = document.querySelector(".brand").getBoundingClientRect();
        const nav = document
          .querySelector(".header-actions")
          .getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          overlap: brand.right > nav.left,
        };
      });
      expect(layout).toEqual({ overflow: false, overlap: false });
      await noKoreanUI(page);
      await page.screenshot({
        path: `.preview/english-${name}-${width}.png`,
        fullPage: true,
      });
    }
    if (name === "sudoku") {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.locator(".cell:not(.given)").first().click();
      await page.locator('[data-action="cheat"]').click();
      await noKoreanUI(page);
      await page.screenshot({
        path: ".preview/english-picker-390.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "Close picker" }).click();
      await page.getByRole("button", { name: "9 by 9", exact: true }).click();
      await expect(page.locator(".cell")).toHaveCount(81);
      await page.setViewportSize({ width: 320, height: 900 });
      await page.screenshot({
        path: ".preview/english-board9-320.png",
        fullPage: true,
      });
    }
  }
});
