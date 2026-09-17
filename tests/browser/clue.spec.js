import { chooseLanguage } from "../../scripts/browser-language.mjs";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createClueGame,
  comparePokemon,
  FIELDS,
  settingsFromSearch,
  storageKey,
  newRound,
} from "../../web/src/clue-engine.js";
import { trainerFor, trainerResultKey } from "../../web/src/trainers.js";

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
const earnedTrainer = (rank, day, attempts) =>
  trainerFor(rank, trainerResultKey("pokeclue", `daily:${day}`, attempts));
async function guess(page, key) {
  await page.locator("#cq-input").fill(key);
  await page.locator(`#cq-options [data-guess="${p(key).id}"]`).click();
  if (await page.locator("#cq-dialog.trainer-dialog[open]").count())
    await page.keyboard.press("Escape");
}
async function reveal(page) {
  await page.locator('[data-action="give-up"]').click();
  await page.locator('[data-action="reveal"]').click();
}

test("the hub card has shared artwork with localized labels and navigation preserves progress", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".game-card")).toHaveCount(6);
  await expect(page.locator(".hub-heading > span")).toHaveCount(0);
  const card = page.getByRole("link", { name: "포케클루 플레이", exact: true });
  await expect(card).toHaveAttribute("href", "./pokeclue.html");
  await expect(card.locator(".game-formats")).toHaveCount(0);
  const koImage = await card.locator(".game-cover-background").getAttribute("src");
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
  await chooseLanguage(page, "en");
  const english = page.getByRole("link", {
    name: "PokeClue Play",
    exact: true,
  });
  expect(await english.locator(".game-cover-background").getAttribute("src")).toBe(koImage);
  await english.click();
  await expect(page).toHaveTitle("PokeClue | Pokemon Quiz");
  await guess(page, "bulbasaur");
  await page
    .getByRole("link", { name: "Pokemon Quiz home", exact: true })
    .click();
  await page.getByRole("link", { name: "PokeClue Play", exact: true }).click();
  await expect(page.locator("#cq-count")).toHaveText("1");
  await chooseLanguage(page, "ko");
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
  await expect(page.locator("#cq-used")).toHaveText("1");
  await expect(page.locator("#cq-grade")).toHaveText("-");
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
  await chooseLanguage(page, "en");
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
  await expect(page.locator("#cq-grade")).toHaveText("Alola Champion");
  await expect(page.locator(".cq-result-rank .cq-rank")).toHaveText("Alola Champion");
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
  expect(text).toContain("Alola Champion · Solved in 2 guesses");
  expect(text).not.toContain("/8");
  expect(text).toContain("O O O O O O");
  expect(text).not.toContain("Ivysaur");
  expect(text).not.toContain("Bulbasaur");
  expect(text).toContain("pokeclue.html?date=");
  await page.reload();
  await expect(page.locator("#cq-count")).toHaveText("2");
  await expect(page.locator("#cq-answer-title")).toHaveText("Ivysaur");
  await page.locator('[data-action="stats"]').click();
  await expect(page.locator("#cq-dialog-body")).toContainText("Solved in 2");
  await expect(page.locator(".cq-record-result .cq-rank")).toHaveText(
    "Alola Champion",
  );
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page
      .locator(".history-list")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: ".preview/pokeclue-rank-stats-en-320.png" });
  expect(errors).toEqual([]);
  expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(
    true,
  );
  expect(requests.some((url) => url.includes("pokemantle-scores.bin"))).toBe(
    false,
  );
});

test("eight failed guesses stay playable and a later win receives its earned rank", async ({
  page,
}) => {
  const title = `${earnedTrainer("C", dateFor(p("mew").id), 11).ko}`;
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
  await expect(page.locator("#cq-used")).toHaveText("8");
  await expect(page.locator("#cq-count")).toHaveText("8");
  await expect(page.locator("#cq-answer")).toBeHidden();
  await expect(page.locator("#cq-grade")).toHaveText("-");
  await expect(page.locator("#cq-input")).toBeVisible();
  await expect(page.locator('[data-action="give-up"]')).toBeEnabled();
  await page.reload();
  await expect(page.locator("#cq-used")).toHaveText("8");
  await expect(page.locator("#cq-input")).toBeVisible();
  for (const key of ["blastoise", "caterpie", "mew"]) await guess(page, key);
  await expect(page.locator("#cq-answer .cq-answer-state")).toHaveText("정답!");
  await expect(page.locator("#cq-count")).toHaveText("11");
  await expect(page.locator("#cq-grade")).toHaveText(title);
  await expect(page.locator(".cq-result-rank")).toContainText("11번 만에 정답");
  await page.reload();
  await expect(page.locator("#cq-answer .cq-answer-state")).toHaveText("정답!");
  await expect(page.locator("#cq-grade")).toHaveText(title);
  await page.locator('[data-action="stats"]').click();
  await expect(page.locator(".cq-record-result")).toContainText("11회 정답");
  await expect(page.locator(".cq-record-result .cq-rank")).toHaveText(title);
});

test("legacy automatic losses resume without stale loss records or changes to explicit give-ups", async ({
  page,
}) => {
  const settings = { mode: "daily", day: dateFor(p("mew").id) };
  const round = newRound(game, settings);
  round.guesses = game.answers
    .filter((p) => p.id !== round.target)
    .slice(0, 8)
    .map((p) => p.id);
  const loss = {
    version: game.version,
    day: settings.day,
    won: false,
    attempts: 8,
  };
  const other = { ...loss, day: "2020-01-01", won: true, attempts: 2 };
  await page.goto(pathFor("mew"));
  await page.evaluate(
    ({ key, round, loss, other }) => {
      localStorage.setItem(key, JSON.stringify(round));
      localStorage.setItem("pokeclue:records", JSON.stringify([loss, other]));
    },
    { key: storageKey(game, settings), round, loss, other },
  );
  await page.reload();
  await expect(page.locator("#cq-used")).toHaveText("8");
  await expect(page.locator("#cq-answer")).toBeHidden();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("pokeclue:records")),
    ),
  ).toEqual([other]);
  await guess(page, "mew");
  const title = `${earnedTrainer("C", settings.day, 9).ko}`;
  await expect(page.locator("#cq-grade")).toHaveText(title);
  await page.locator('[data-action="stats"]').click();
  await expect(page.locator(".cq-record-result .cq-rank")).toHaveText([
    title,
    "알로라 챔피언",
  ]);
  await page.evaluate(
    ({ key, round, loss, other }) => {
      localStorage.setItem(key, JSON.stringify({ ...round, gaveUp: true }));
      localStorage.setItem("pokeclue:records", JSON.stringify([loss, other]));
    },
    { key: storageKey(game, settings), round, loss, other },
  );
  await page.reload();
  await expect(page.locator("#cq-answer .cq-answer-state")).toHaveText(
    "정답 공개",
  );
  await expect(page.locator("#cq-grade")).toHaveText("-");
  await expect(page.locator(".cq-result-rank")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("pokeclue:records")),
    ),
  ).toEqual([loss, other]);
});

test("long practice rounds persist, receive Tourist rank, and render all six named tiers in both languages on mobile and desktop", async ({
  page,
}) => {
  const settings = { mode: "practice", seed: "rank-check" };
  const round = newRound(game, settings);
  round.guesses = game.answers
    .filter((p) => p.id !== round.target)
    .slice(0, 40)
    .map((p) => p.id);
  await page.goto("./pokeclue.html?mode=practice&seed=rank-check");
  await page.evaluate(
    ({ key, round }) => localStorage.setItem(key, JSON.stringify(round)),
    { key: storageKey(game, settings), round },
  );
  await page.reload();
  await expect(page.locator("#cq-used")).toHaveText("40");
  await expect(page.locator("#cq-input")).toBeVisible();
  await guess(page, game.byId.get(round.target).key);
  await expect(page.locator("#cq-used")).toHaveText("41");
  await expect(page.locator("#cq-grade")).toHaveText("알로라 관광객");
  await page.reload();
  await expect(page.locator("#cq-grade")).toHaveText("알로라 관광객");
  expect(
    await page.evaluate(() => localStorage.getItem("pokeclue:records")),
  ).toBeNull();
  for (const language of ["ko", "en"]) {
    await chooseLanguage(page, language);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page
          .locator(".cq-progress, .cq-result-rank")
          .evaluateAll((els) =>
            els.every((el) => el.scrollWidth <= el.clientWidth),
          ),
      ).toBe(true);
      await page.screenshot({
        path: `.preview/pokeclue-rank-${language}-${width}.png`,
      });
      await page.locator('[data-action="help"]').click();
      await expect(page.locator(".trainer-rank-guide")).toHaveCount(0);
      expect(
        await page
          .locator("#cq-dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: `.preview/pokeclue-ranks-help-${language}-${width}.png`,
      });
      await page.locator('[data-action="close-dialog"]').click();
    }
  }
});

test("all six Alola ranks replace old titles in saved results, records and bilingual shares", async ({
  page,
}) => {
  const settings = { mode: "daily", day: dateFor(p("mew").id) };
  const round = newRound(game, settings);
  const wrong = game.answers
    .filter((p) => p.id !== round.target)
    .slice(0, 40)
    .map((p) => p.id);
  await page.goto(pathFor("mew"));
  for (const [attempts, rank] of [
    [3, "S"],
    [5, "A"],
    [8, "B"],
    [11, "C"],
    [15, "D"],
    [16, "E"],
  ]) {
    const trainer = earnedTrainer(rank, settings.day, attempts);
    const ko = `${trainer.ko}`,
      en = `${trainer.en}`;
    await page.evaluate(
      ({ key, round, attempts, wrong, day }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            ...round,
            guesses: [...wrong.slice(0, attempts - 1), round.target],
          }),
        );
        localStorage.setItem(
          "pokeclue:records",
          JSON.stringify([
            { version: round.version, day, won: true, attempts },
          ]),
        );
      },
      {
        key: storageKey(game, settings),
        round,
        attempts,
        wrong,
        day: settings.day,
      },
    );
    await page.reload();
    await page.locator("#cq-answer-title").waitFor();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.clueShare = text;
          },
        },
      });
    });
    for (const [language, title] of [
      ["ko", ko],
      ["en", en],
    ]) {
      await chooseLanguage(page, language);
      await expect(page.locator("#cq-grade")).toHaveText(title);
      await expect(page.locator(".cq-result-rank .cq-rank")).toHaveText(title);
      await page.locator('[data-action="share"]').click();
      expect(await page.evaluate(() => window.clueShare)).toContain(
        `${title} · `,
      );
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page
            .locator(".cq-progress > div, #cq-grade, .cq-result-rank .cq-rank")
            .evaluateAll((els) =>
              els.every((el) => el.scrollWidth <= el.clientWidth + 1),
            ),
        ).toBe(true);
        await page.screenshot({
          path: `.preview/pokeclue-trainer-${attempts}-${language}-${width}.png`,
        });
        await page.locator('[data-action="stats"]').click();
        await expect(page.locator(".cq-record-result .cq-rank")).toHaveText(
          title,
        );
        expect(
          await page.locator(".history-list > div > span").evaluate((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return range.getClientRects().length;
          }),
        ).toBe(1);
        expect(
          await page
            .locator(".history-list > div, .cq-record-result .cq-rank")
            .evaluateAll((els) =>
              els.every((el) => el.scrollWidth <= el.clientWidth + 1),
            ),
        ).toBe(true);
        await page.screenshot({
          path: `.preview/pokeclue-trainer-stats-${attempts}-${language}-${width}.png`,
        });
        await page.locator('[data-action="close-dialog"]').click();
      }
    }
  }
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
    await chooseLanguage(page, language);
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
    await expect(page.locator("#cq-dialog-body li")).toHaveCount(4);
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

test("form generation clues and arrows are corrected in existing rounds, both languages and revealed answers", async ({
  page,
}) => {
  const settings = { mode: "daily", day: dateFor(p("growlithe-hisui").id) };
  const oldRound = {
    ...newRound(game, settings),
    guesses: [p("growlithe").id],
  };
  delete oldRound.rulesVersion;
  await page.goto(pathFor("growlithe-hisui"));
  await page.evaluate(
    ({ key, round }) => localStorage.setItem(key, JSON.stringify(round)),
    { key: storageKey(game, settings), round: oldRound },
  );
  await page.reload();
  const original = page.locator(
    `[data-result="${p("growlithe").id}"] [data-field="generation"]`,
  );
  await expect(original).toContainText("1세대");
  await expect(original).toHaveAttribute("data-state", "miss");
  await expect(original).toHaveAttribute("data-direction", "up");
  for (const [key, generation, state, direction] of [
    ["vulpix-alola", 7, "miss", "up"],
    ["meowth-galar", 8, "match", null],
    ["wooper-paldea", 9, "miss", "down"],
    ["charizard-mega-x", 1, "miss", "up"],
    ["charizard-gmax", 1, "miss", "up"],
  ]) {
    await guess(page, key);
    const clue = page.locator(
      `[data-result="${p(key).id}"] [data-field="generation"]`,
    );
    await expect(clue).toContainText(`${generation}세대`);
    await expect(clue).toHaveAttribute("data-state", state);
    if (direction)
      await expect(clue).toHaveAttribute("data-direction", direction);
  }
  await page.reload();
  await expect(page.locator("#cq-count")).toHaveText("6");
  await chooseLanguage(page, "en");
  await expect(original).toContainText("Gen 1");
  await guess(page, "growlithe-hisui");
  await expect(page.locator("#cq-answer-title")).toHaveText(
    "Hisuian Growlithe",
  );
  await expect(page.locator(".cq-answer-facts")).toContainText("Gen 8");
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width === 320) {
      const title = await page.locator("#cq-answer-title").boundingBox();
      const share = await page
        .locator('#cq-answer [data-action="share"]')
        .boundingBox();
      expect(title.width).toBeGreaterThan(200);
      expect(share.y).toBeGreaterThanOrEqual(title.y + title.height);
    }
    expect(
      await page
        .locator("#cq-answer")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `.preview/pokeclue-form-generation-${width}.png`,
    });
  }
});

test("legacy equivalent-form wins retain their rank but cannot win new rounds with a different debut generation", async ({
  page,
}) => {
  const settings = { mode: "daily", day: dateFor(p("unown-a").id) };
  const oldRound = {
    ...newRound(game, settings),
    guesses: [p("unown-exclamation").id],
  };
  delete oldRound.rulesVersion;
  await page.goto(pathFor("unown-a"));
  await page.evaluate(
    ({ key, round, day }) => {
      localStorage.setItem(key, JSON.stringify(round));
      localStorage.setItem(
        "pokeclue:records",
        JSON.stringify([
          { version: round.version, day, won: true, attempts: 1 },
        ]),
      );
    },
    { key: storageKey(game, settings), round: oldRound, day: settings.day },
  );
  await page.reload();
  await expect(page.locator("#cq-grade")).toHaveText("알로라 챔피언");
  await expect(page.locator("#cq-answer .cq-warning")).toContainText(
    "이전 세대 기준",
  );
  await expect(page.locator("#cq-input")).toBeHidden();
  await page.reload();
  await expect(page.locator("#cq-grade")).toHaveText("알로라 챔피언");
  await chooseLanguage(page, "en");
  await expect(page.locator("#cq-answer .cq-warning")).toContainText(
    "Your win is preserved",
  );
  await page.locator('[data-action="stats"]').click();
  await expect(page.locator(".cq-record-result")).toContainText("Solved in 1");
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    storageKey(game, settings),
  );
  await page.reload();
  await guess(page, "unown-exclamation");
  await expect(page.locator("#cq-answer")).toBeHidden();
  await page.reload();
  await expect(page.locator("#cq-answer")).toBeHidden();
  await expect(page.locator("#cq-input")).toBeVisible();
  await guess(page, "unown-a");
  await expect(page.locator("#cq-answer-title")).toContainText("Unown");
  await expect(page.locator("#cq-answer .cq-warning")).toHaveCount(0);
});

test("Mega and Gmax use species generation in clues, answers and bilingual rules, while old rounds retain guesses", async ({
  page,
}) => {
  await page.goto(pathFor("charizard-mega-x"));
  await guess(page, "charizard-mega-x");
  await expect(page.locator(".cq-answer-facts")).toContainText("1세대");
  await page.locator('[data-action="help"]').click();
  await expect(page.locator("#cq-dialog-body")).toContainText("최초 출현 세대");
  await page.locator('#cq-dialog [data-action="close-dialog"]').click();
  await chooseLanguage(page, "en");
  await page.locator('[data-action="help"]').click();
  await expect(page.locator("#cq-dialog-body")).toContainText(
    "debut generation",
  );
  await page.locator('#cq-dialog [data-action="close-dialog"]').click();
  await page.goto(pathFor("charizard"));
  const settings = { mode: "daily", day: dateFor(p("charizard").id) };
  const old = {
    ...newRound(game, settings),
    rulesVersion: "form-debut",
    guesses: [p("charizard-gmax").id, p("bulbasaur").id, p("charizard").id],
  };
  await page.evaluate(
    ({ key, round }) => localStorage.setItem(key, JSON.stringify(round)),
    { key: storageKey(game, settings), round: old },
  );
  await page.reload();
  await expect(page.locator("#cq-answer-title")).toHaveText("Charizard");
  await expect(page.locator("#cq-count")).toHaveText("3");
  await expect(page.locator(".cq-answer-facts")).toContainText("Gen 1");
  const gmax = page.locator(
    `[data-result="${p("charizard-gmax").id}"] [data-field="generation"]`,
  );
  await expect(gmax).toContainText("Gen 1");
  await expect(gmax).toHaveAttribute("data-state", "match");
  await page.reload();
  await expect(page.locator("#cq-count")).toHaveText("3");
  await page.locator('[data-action="stats"]').click();
  await expect(
    page.locator(".cq-record-result").filter({ hasText: "Solved in 3" }),
  ).toHaveCount(1);
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
  await chooseLanguage(page, "en");
  await expect(page.locator("#cq-count")).toHaveText("1");
  expect(
    await page.evaluate(() => [
      localStorage.getItem("pokemantle:records"),
      localStorage.getItem("typedoku:settings"),
    ]),
  ).toEqual(["untouched", "untouched"]);
});
