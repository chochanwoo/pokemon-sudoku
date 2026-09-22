import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { chooseLanguage } from "../../scripts/browser-language.mjs";
import {
  createHighLow, HARD_MAX_GAP, settingsFromSearch, storageKey,
  profileKey, lastPracticeKey, challengeKey,
} from "../../web/src/highlow-engine.js";

const read = (name) => JSON.parse(readFileSync(
  new URL(`../../web/public/${name}.json`, import.meta.url),
));
const game = createHighLow(read("pokemantle"), read("highlow"));
const normal = { mode: "daily", day: "2026-09-22" };
const hard = { ...normal, difficulty: "hard" };
const hardPath = "./highlow.html?difficulty=hard";
const choice = (page, side) => page.locator(`[data-choice="${side}"]`);
const difficulty = (page, value) => page.locator(`[data-difficulty="${value}"]`);
const urlSettings = (page) => settingsFromSearch(new URL(page.url()).search, normal.day);

async function pair(page, settings, index, revealed = false) {
  const q = game.question(settings, index);
  const a = game.byId.get(q.left), b = game.byId.get(q.right);
  if (settings.difficulty === "hard") {
    expect(Math.abs(a.bst - b.bst)).toBeLessThanOrEqual(HARD_MAX_GAP);
    expect(a.bst).not.toBe(b.bst);
    expect(a.speciesId).not.toBe(b.speciesId);
  }
  await expect(page.locator("#hl-arena")).toHaveAttribute("data-stat", "bst");
  for (const side of ["left", "right"]) {
    await expect(choice(page, side)).toHaveAttribute("data-pokemon", String(q[side]));
    await expect(choice(page, side).locator(".hl-value")).toHaveText(
      revealed ? String(game.byId.get(q[side]).bst) : "?",
    );
  }
  return q;
}
async function win(page, settings, index) {
  const q = await pair(page, settings, index);
  await choice(page, q.winner).click();
  await expect(page.locator("#hl-streak")).toHaveText(String(index + 1));
  await pair(page, settings, index, true);
}
async function lose(page, settings, index) {
  const q = await pair(page, settings, index);
  await choice(page, q.winner === "left" ? "right" : "left").click();
  await expect(page.locator("#hl-dialog")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-22T03:00:00Z"));
});

test("difficulty switches preserve both daily runs, bests, reload and language", async ({ page }) => {
  await page.goto("./highlow.html");
  await win(page, normal, 0);
  await page.locator("#hl-next").click();
  await difficulty(page, "hard").click();
  expect(new URL(page.url()).searchParams.get("difficulty")).toBe("hard");
  await expect(difficulty(page, "hard")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#hl-best")).toHaveText("0");
  await win(page, hard, 0);
  await page.locator("#hl-next").click();
  await win(page, hard, 1);
  await difficulty(page, "normal").click();
  await pair(page, normal, 1);
  await expect(page.locator("#hl-streak")).toHaveText("1");
  await expect(page.locator("#hl-best")).toHaveText("1");
  await page.goBack();
  await pair(page, hard, 1, true);
  await expect(page.locator("#hl-streak")).toHaveText("2");
  await page.reload();
  await pair(page, hard, 1, true);
  await chooseLanguage(page, "en");
  await expect(difficulty(page, "hard")).toHaveText("Hard");
  await pair(page, hard, 1, true);
  await page.locator('[data-action="stats"]').click();
  await expect(page.locator(".hl-record-mode")).toHaveText("Hard");
  await expect(page.locator(".stats-row > div").first().locator("strong")).toHaveText("2");
  const saves = await page.evaluate((keys) => keys.map((key) => JSON.parse(localStorage.getItem(key))),
    [storageKey(game, normal), storageKey(game, hard)]);
  expect(saves.map((round) => round.choices.length)).toEqual([1, 2]);
});

test("each difficulty resumes its own practice seed across daily, history and new-practice confirmation", async ({ page }) => {
  const practice = { mode: "practice", seed: "normal-resume" };
  await page.goto("./highlow.html?mode=practice&seed=normal-resume");
  await win(page, practice, 0);
  await page.locator("#hl-next").click();
  await difficulty(page, "hard").click();
  const hp = urlSettings(page);
  expect(hp.difficulty).toBe("hard");
  expect(hp.seed).not.toBe(practice.seed);
  await win(page, hp, 0);
  await difficulty(page, "normal").click();
  expect(urlSettings(page)).toEqual(practice);
  await pair(page, practice, 1);
  await page.goBack();
  await pair(page, hp, 0, true);
  await page.locator('.hl-mode [data-action="daily"]').click();
  await pair(page, hard, 0);
  await page.locator('.hl-mode [data-action="practice"]').click();
  expect(urlSettings(page)).toEqual(hp);
  await pair(page, hp, 0, true);
  await page.locator('[data-action="new-practice"]').click();
  await expect(page.locator("#hl-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(urlSettings(page)).toEqual(hp);
  await page.locator('[data-action="new-practice"]').click();
  await page.locator('[data-action="start-practice"]').click();
  const fresh = urlSettings(page);
  expect(fresh.difficulty).toBe("hard");
  expect(fresh.seed).not.toBe(hp.seed);
  await pair(page, fresh, 0);
  await difficulty(page, "normal").click();
  await pair(page, practice, 1);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)),
    lastPracticeKey(hard))).toBe(fresh.seed);
});

for (const mode of ["daily", "practice"]) {
  test(`${mode}: hard results, ranks, records and English shares reproduce the same challenge`, async ({ page }) => {
    const settings = mode === "daily" ? hard : { mode, seed: "share-hard", difficulty: "hard" };
    await page.goto(hardPath + (mode === "practice" ? "&mode=practice&seed=share-hard" : ""));
    await chooseLanguage(page, "en");
    for (let i = 0; i < 3; i++) {
      await win(page, settings, i);
      await page.locator("#hl-next").click();
    }
    await lose(page, settings, 3);
    await expect(page.locator(".hl-result-mode")).toHaveText(`${mode === "daily" ? "Daily" : "Practice"} · Hard`);
    await expect(page.locator(".hl-result-summary")).toHaveAttribute("data-trainer-rank", "D");
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { writeText: async (text) => { window.shared = text; } },
    }));
    await page.locator('[data-action="share"]').click();
    const shared = await page.evaluate(() => window.shared);
    expect(shared).toContain("Poke High Low · Hard");
    const url = new URL(shared.split("\n").at(-1));
    expect(url.searchParams.get("difficulty")).toBe("hard");
    expect(settingsFromSearch(url.search, normal.day)).toEqual(settings);
    await page.goto(url.href);
    await pair(page, settings, 3, true);
    await expect(page.locator("#hl-dialog")).not.toBeVisible();
    await page.locator('[data-action="stats"]').click();
    await expect(page.locator(".history-list > div")).toHaveCount(1);
    await expect(page.locator(".history-list")).toContainText("3 in a row");
    await page.keyboard.press("Escape");
    await difficulty(page, "normal").click();
    await expect(page.locator("#hl-best")).toHaveText("0");
    await page.locator('[data-action="stats"]').click();
    await expect(page.locator(".hl-record-mode")).toHaveText("Normal");
    await expect(page.locator(".history-list > div")).toHaveCount(0);
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)),
      `${profileKey(game, hard)}:records`);
    expect(saved).toHaveLength(1);
    expect(saved[0].challenge).toBe(challengeKey(settings));
  });
}

test("retired hard-mode saves and records are left untouched and never loaded", async ({ page }) => {
  const prefix = `highlow:${game.version}`;
  await page.addInitScript(({ prefix, version }) => {
    for (const difficulty of ["hard:", ""]) {
      localStorage.setItem(`${prefix}:${difficulty}daily:2026-09-22`, JSON.stringify({
        version, challenge: `${difficulty}daily:2026-09-22`, choices: ["left"], revealed: true,
      }));
      localStorage.setItem(`${prefix}:${difficulty}best`, "999");
      localStorage.setItem(`${prefix}:${difficulty}records`, JSON.stringify([
        { challenge: `${difficulty}daily:2026-09-22`, mode: "daily", day: "2026-09-22", score: 999 },
      ]));
    }
    localStorage.setItem("highlow:hard:last-practice", JSON.stringify("retired"));
  }, { prefix, version: game.version });
  await page.goto(hardPath);
  await pair(page, hard, 0);
  await expect(page.locator("#hl-best")).toHaveText("0");
  await expect(page.locator("#hl-streak")).toHaveText("0");
  await page.locator('[data-action="stats"]').click();
  await expect(page.locator(".history-list > div")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator('.hl-mode [data-action="practice"]').click();
  expect(urlSettings(page).seed).not.toBe("retired");
  expect(await page.evaluate((key) => localStorage.getItem(key), `${prefix}:hard:best`)).toBe("999");
});

test("midnight changes the hard daily only when requested", async ({ page }) => {
  await page.goto(hardPath);
  await win(page, hard, 0);
  await page.clock.setFixedTime(new Date("2026-09-22T15:00:01Z"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator("#hl-new-day")).toBeVisible();
  await pair(page, hard, 0, true);
  await page.locator('#hl-new-day [data-action="daily"]').click();
  await pair(page, { ...hard, day: "2026-09-23" }, 0);
  await expect(difficulty(page, "hard")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#hl-streak")).toHaveText("0");
  expect(new URL(page.url()).searchParams.get("difficulty")).toBe("hard");
});

test("bilingual hard controls and real sprites fit mobile and desktop; rules state the gap", async ({ page }) => {
  await page.goto(hardPath);
  for (const language of ["ko", "en"]) {
    await chooseLanguage(page, language);
    for (const width of [320, 390, 800, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 1080 });
      await pair(page, hard, 0);
      const fits = await page.locator(".hl-controls").evaluate((el) => {
        const boxes = [...el.children].map((c) => c.getBoundingClientRect());
        return document.documentElement.scrollWidth <= innerWidth &&
          boxes.every((b) => b.left >= 0 && b.right <= innerWidth) &&
          (boxes[0].right <= boxes[1].left || boxes[0].bottom <= boxes[1].top) &&
          [...el.querySelectorAll("button")].every((b) => b.scrollWidth <= b.clientWidth);
      });
      expect(fits).toBe(true);
      for (const img of await page.locator(".hl-choice .hl-sprite img").all()) {
        expect(await img.evaluate(async (el) => {
          await el.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 48;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(el, 0, 0, 48, 48);
          return ctx.getImageData(0, 0, 48, 48).data.some((v, i) => i % 4 === 3 && v > 0);
        })).toBe(true);
      }
      await page.screenshot({ path: `.preview/highlow-hard-${language}-${width}.png`, fullPage: true });
    }
    await page.locator('[data-action="help"]').click();
    await expect(page.locator("#hl-dialog-body")).toContainText(
      language === "ko" ? "종족값 합계 차이가 50 이하" : "base stat totals differ by no more than 50",
    );
    await page.keyboard.press("Escape");
  }
});
