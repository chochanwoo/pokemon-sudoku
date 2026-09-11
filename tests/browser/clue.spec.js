import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createClueGame,
  comparePokemon,
  FIELDS,
  settingsFromSearch,
  storageKey,
} from "../../web/src/clue-engine.js";

const read = (file) =>
  JSON.parse(
    readFileSync(new URL(`../../web/public/${file}.json`, import.meta.url)),
  );
const catalog = read("pokemantle"),
  clues = read("pokeclue"),
  game = createClueGame(catalog, clues);
const byKey = new Map(game.pokemon.map((p) => [p.key, p]));
const p = (key) => byKey.get(key);
function dateFor(id) {
  const origin = Date.parse("2026-09-11");
  for (let i = 0; i < game.answers.length; i++) {
    const day = new Date(origin - i * 86400000).toISOString().slice(0, 10);
    if (game.targetFor({ mode: "daily", day }) === id) return day;
  }
  throw new Error("No answer date");
}
const pathFor = (key) => `./pokeclue.html?date=${dateFor(p(key).id)}`;
async function guess(page, key) {
  await page.locator("#cq-input").fill(key);
  await page.locator(`#cq-options [data-guess="${p(key).id}"]`).click();
}
async function reveal(page) {
  await page.locator('[data-action="give-up"]').click();
  await page.locator('[data-action="reveal"]').click();
}

test("the new hub card has real localized previews and both navigation directions preserve progress", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".game-card")).toHaveCount(3);
  await expect(page.locator(".hub-heading > span")).toHaveText("3개 게임");
  const card = page.getByRole("link", { name: "포케클루 플레이", exact: true });
  await expect(card).toHaveAttribute("href", "./pokeclue.html");
  await expect(card.locator(".game-formats")).toHaveText("데일리 · 연습");
  const koImage = await card.locator("img").getAttribute("src");
  for (const width of [320, 390, 800, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const fit = await card.evaluate(async (el) => {
      const img = el.querySelector("img");
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 64, 64);
      const pixels = ctx.getImageData(0, 0, 64, 64).data,
        colors = new Set();
      for (let i = 0; i < pixels.length; i += 4)
        colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return {
        width: img.naturalWidth,
        colors: colors.size,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(fit.width).toBeGreaterThan(300);
    expect(fit.colors).toBeGreaterThan(100);
    expect(fit.overflow).toBe(false);
  }
  await page.locator("[data-language-select]").selectOption("en");
  const english = page.getByRole("link", {
    name: "PokeClue Play",
    exact: true,
  });
  expect(await english.locator("img").getAttribute("src")).not.toBe(koImage);
  await english.click();
  await expect(page).toHaveTitle("PokeClue | Pokemon Quiz");
  await guess(page, "bulbasaur");
  await page
    .getByRole("link", { name: "Pokemon Quiz home", exact: true })
    .click();
  await page.getByRole("link", { name: "PokeClue Play", exact: true }).click();
  await expect(page.locator("#cq-count")).toHaveText("1");
  await page.locator("[data-language-select]").selectOption("ko");
  await expect(page.locator('[data-result="1"]')).toContainText("이상해씨");
});

test("clue comparisons, keyboard input, duplicate protection, language, saving and sharing work end to end", async ({
  page,
}) => {
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(pathFor("ivysaur"));
  await expect(page).toHaveTitle("포케클루 | 포켓몬 퀴즈");
  await expect(page.locator("#cq-answer")).toBeHidden();
  await page.locator("#cq-input").fill("이상해씨");
  await page.locator("#cq-input").press("ArrowDown");
  await page.locator("#cq-input").press("Enter");
  const row = page.locator('[data-result="1"]');
  await expect(page.locator("#cq-remaining")).toHaveText("7");
  const feedback = comparePokemon(p("bulbasaur"), p("ivysaur"));
  for (const field of FIELDS)
    await expect(row.locator(`[data-field="${field}"]`)).toHaveAttribute(
      "data-state",
      feedback[field].state,
    );
  await expect(row.locator('[data-field="evolution"]')).toHaveAttribute(
    "data-direction",
    "up",
  );
  await expect(row.locator('[data-field="evolution"]')).toContainText(
    "같은 계열",
  );
  await page.locator("#cq-input").fill("bulbasaur");
  await expect(page.locator('#cq-options [data-guess="1"]')).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.locator("#cq-input").press("Enter");
  await expect(page.locator("#cq-count")).toHaveText("1");
  await expect(page.locator("#cq-toast")).toHaveText(
    "이미 같은 단서의 모습을 추측했어요.",
  );
  await page.reload();
  await expect(page.locator("#cq-count")).toHaveText("1");
  await page.locator("[data-language-select]").selectOption("en");
  await expect(row).toContainText("Bulbasaur");
  await expect(row.locator('[data-field="evolution"]')).toContainText(
    "Same family",
  );
  await expect(row.locator('[data-field="abilities"]')).toContainText(
    "Overgrow",
  );
  await expect(row.locator('[data-field="eggGroups"]')).toContainText(
    "Monster",
  );
  await guess(page, "ivysaur");
  await expect(page.locator("#cq-answer-title")).toHaveText("Ivysaur");
  await expect(page.locator("#cq-input")).toBeHidden();
  await expect(page.locator("#cq-answer .cq-answer-facts > div")).toHaveCount(
    6,
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.clueShare = text;
        },
      },
    }),
  );
  await page.locator('[data-action="share"]').click();
  const text = await page.evaluate(() => window.clueShare);
  expect(text).toContain("PokeClue");
  expect(text).toContain("2/8");
  expect(text).toContain("O O O O O O");
  expect(text).not.toContain("Ivysaur");
  expect(text).not.toContain("Bulbasaur");
  expect(text).toContain("pokeclue.html?date=");
  await page.reload();
  await expect(page.locator("#cq-count")).toHaveText("2");
  await expect(page.locator("#cq-answer-title")).toHaveText("Ivysaur");
  await page.locator('[data-action="stats"]').click();
  await expect(page.locator("#cq-dialog-body")).toContainText("Solved in 2");
  expect(errors).toEqual([]);
  expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(
    true,
  );
  expect(requests.some((url) => url.includes("pokemantle-scores.bin"))).toBe(
    false,
  );
});

test("all eight failed guesses reveal the answer and a correct eighth guess wins", async ({
  page,
}) => {
  await page.goto(pathFor("mew"));
  for (const key of [
    "bulbasaur",
    "ivysaur",
    "venusaur",
    "charmander",
    "charmeleon",
    "charizard",
    "squirtle",
    "wartortle",
  ])
    await guess(page, key);
  await expect(page.locator("#cq-remaining")).toHaveText("0");
  await expect(page.locator("#cq-count")).toHaveText("8");
  await expect(page.locator("#cq-answer-title")).toHaveText("뮤");
  await expect(page.locator("#cq-answer .cq-answer-state")).toHaveText(
    "정답 공개",
  );
  await expect(page.locator('[data-action="give-up"]')).toBeDisabled();
  await page.reload();
  await expect(page.locator("#cq-answer-title")).toHaveText("뮤");
  await page.goto(pathFor("charizard-mega-x"));
  for (const key of [
    "bulbasaur",
    "ivysaur",
    "venusaur",
    "charmander",
    "charmeleon",
    "charizard",
    "squirtle",
    "charizard-mega-x",
  ])
    await guess(page, key);
  await expect(page.locator("#cq-answer .cq-answer-state")).toHaveText("정답!");
  await expect(page.locator("#cq-count")).toHaveText("8");
  await page.reload();
  await expect(page.locator("#cq-answer .cq-answer-state")).toHaveText("정답!");
});

test("practice, daily, new practice confirmation and browser history preserve isolated rounds", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-11T03:00:00Z") });
  await page.goto("./pokeclue.html");
  await guess(page, "bulbasaur");
  await page.locator('.cq-mode [data-action="practice"]').click();
  await expect(page).toHaveURL(/mode=practice&seed=/);
  const practiceUrl = page.url();
  await expect(page.locator("#cq-count")).toHaveText("0");
  const settings = settingsFromSearch(new URL(practiceUrl).search);
  const nonAnswer = game.answers.find((p) => p.id !== game.targetFor(settings));
  await guess(page, nonAnswer.key);
  await page.reload();
  await expect(page.locator("#cq-count")).toHaveText("1");
  await page.locator('.cq-mode [data-action="daily"]').click();
  await expect(page.locator("#cq-count")).toHaveText("1");
  await page.locator('.cq-mode [data-action="practice"]').click();
  await expect(page).toHaveURL(practiceUrl);
  await expect(page.locator("#cq-count")).toHaveText("1");
  await page.locator('[data-action="new-practice"]').click();
  await page.locator('[data-action="close-dialog"]').click();
  await expect(page).toHaveURL(practiceUrl);
  await page.locator('[data-action="new-practice"]').click();
  await page.locator('[data-action="confirm-practice"]').click();
  expect(page.url()).not.toBe(practiceUrl);
  await expect(page.locator("#cq-count")).toHaveText("0");
  await page.goBack();
  await expect(page).toHaveURL(practiceUrl);
  await expect(page.locator("#cq-count")).toHaveText("1");
  await reveal(page);
  await expect(page.locator("#cq-answer")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("pokeclue:records")),
  ).toBeNull();
});

test("mobile and desktop comparisons, answer facts and rules remain readable in both languages", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathFor("mew"));
  for (const key of [
    "urshifu-rapid-strike-gmax",
    "calyrex-ice",
    "darkrai-mega",
  ])
    await guess(page, key);
  await expect(
    page.locator(
      `[data-result="${p("darkrai-mega").id}"] [data-field="abilities"]`,
    ),
  ).toHaveAttribute("data-state", "unknown");
  for (const language of ["ko", "en"]) {
    await page.locator("[data-language-select]").selectOption(language);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const fit = await page.locator("#cq-history").evaluate(async (el) => {
        await Promise.all(
          [...el.querySelectorAll("img")].map((img) => img.decode()),
        );
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          images: [...el.querySelectorAll("img")].every(
            (img) => img.naturalWidth > 0,
          ),
          cells: [...el.querySelectorAll(".cq-clue, .cq-pokemon")].every(
            (cell) => cell.scrollWidth <= cell.clientWidth + 1,
          ),
          values: [...el.querySelectorAll(".cq-values")].every((el) => {
            const box = el.getBoundingClientRect(),
              cell = el.closest(".cq-clue").getBoundingClientRect();
            return (
              box.left >= cell.left &&
              box.right <= cell.right &&
              box.bottom <= cell.bottom
            );
          }),
        };
      });
      expect(fit).toEqual({
        overflow: false,
        images: true,
        cells: true,
        values: true,
      });
      await page.screenshot({
        path: `.preview/pokeclue-${language}-${width}.png`,
        fullPage: true,
      });
    }
    await page.locator('[data-action="help"]').click();
    await expect(page.locator("#cq-dialog-body li")).toHaveCount(6);
    await page.setViewportSize({ width: 320, height: 844 });
    const dialog = await page.locator("#cq-dialog").boundingBox();
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(320);
    await page.locator('[data-action="close-dialog"]').click();
  }
  await reveal(page);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page
        .locator("#cq-answer")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `.preview/pokeclue-answer-${width}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("cosmetic equivalents count as answers, but regional and Mega forms remain distinct and special forms stay excluded", async ({
  page,
}) => {
  await page.goto(pathFor("unown-a"));
  await guess(page, "unown-b");
  await expect(page.locator("#cq-answer .cq-answer-state")).toHaveText("정답!");
  await page.goto(pathFor("vulpix-alola"));
  await guess(page, "vulpix");
  await expect(page.locator("#cq-answer")).toBeHidden();
  await page.locator("#cq-input").fill("아르세우스");
  await expect(page.locator("#cq-options [role=option]")).toHaveCount(18);
  for (const query of [
    "arceus unknown",
    "pichu spiky eared",
    "pikachu partner cap",
  ]) {
    await page.locator("#cq-input").fill(query);
    await expect(page.locator("#cq-options [role=option]")).toHaveCount(0);
  }
  await guess(page, "vulpix-alola");
  await expect(page.locator("#cq-answer .cq-answer-state")).toHaveText("정답!");
});

test("Korean midnight offers today's challenge without discarding the previous board", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-10T14:59:00Z") });
  await page.goto("./pokeclue.html");
  await guess(page, "bulbasaur");
  await expect(page.locator("#cq-new-day")).toBeHidden();
  await page.clock.fastForward(61000);
  await expect(page.locator("#cq-new-day")).toBeVisible();
  await expect(page.locator("#cq-count")).toHaveText("1");
  await page.locator('#cq-new-day [data-action="daily"]').click();
  await expect(page.locator("#cq-date")).toContainText("2026.09.11");
  await expect(page.locator("#cq-count")).toHaveText("0");
  await page.goBack();
  // The original URL had no date; the old day's explicit link still restores its board.
  await page.goto("./pokeclue.html?date=2026-09-10");
  await expect(page.locator("#cq-count")).toHaveText("1");
});

test("bad bundles, corrupt saves and blocked storage fail safely without touching other games", async ({
  page,
}) => {
  await page.route("**/pokeclue.json", (route) =>
    route.fulfill({ json: { ...clues, catalogVersion: "bad" } }),
  );
  await page.goto("./pokeclue.html");
  await expect(
    page.getByRole("heading", { name: "게임을 불러오지 못했어요" }),
  ).toBeVisible();
  await page.unroute("**/pokeclue.json");
  await page.locator("#cq-retry").click();
  await expect(page.locator("#cq-input")).toBeVisible();
  const key = storageKey(game, settingsFromSearch(""));
  await page.evaluate((key) => {
    localStorage.setItem(key, "{bad");
    localStorage.setItem("pokemantle:records", "untouched");
    localStorage.setItem("typedoku:settings", "untouched");
  }, key);
  await page.reload();
  await expect(page.locator("#cq-count")).toHaveText("0");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "QuotaExceededError");
    };
  });
  await guess(page, "bulbasaur");
  await expect(page.locator("#cq-count")).toHaveText("1");
  await expect(page.locator("#cq-save-warning")).toBeVisible();
  await page.locator("[data-language-select]").selectOption("en");
  await expect(page.locator("#cq-count")).toHaveText("1");
  expect(
    await page.evaluate(() => [
      localStorage.getItem("pokemantle:records"),
      localStorage.getItem("typedoku:settings"),
    ]),
  ).toEqual(["untouched", "untouched"]);
});
