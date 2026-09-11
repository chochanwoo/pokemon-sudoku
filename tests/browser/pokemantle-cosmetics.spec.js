import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("../../web/public/pokemantle.json", import.meta.url)));
const day = "2026-09-12";
const path = `./pokemantle.html?date=${day}`;
const storageKey = `pokemantle:${data.version}:${day}`;

for (const width of [390, 1440])
  test(`cosmetic searches show one entry and today's Spewpa can be solved in either language at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path);
    const input = page.locator("#guess-input");
    const options = page.locator("#guess-options [role=option]");
    for (const [query, count] of [
      ["분이벌레", 1], ["분떠도리", 1], ["비비용", 1], ["안농", 1],
      ["트리미앙", 1], ["플라베베", 1], ["마휘핑", 2], ["메테노", 2],
      ["플라엣테", 3], ["아르세우스", 18],
    ]) {
      await input.fill(query);
      await expect(options).toHaveCount(count);
    }
    for (const language of ["ko", "en"]) {
      await page.locator("[data-language-select]").selectOption(language);
      for (const query of ["분떠도리", "Spewpa", "spewpa meadow", "spewpa polar", "665"]) {
        await input.fill(query);
        const choice = page.locator('#guess-options [data-guess="665"]');
        await expect(choice).toBeVisible();
        await expect(choice.locator(".pm-option-name")).toHaveText(
          `${language === "ko" ? "분떠도리" : "Spewpa"}#0665`,
        );
        if (query !== "665") await expect(options).toHaveCount(1);
      }
    }
    await page.locator("[data-language-select]").selectOption(width === 390 ? "ko" : "en");
    await input.fill("spewpa meadow");
    await input.press("Enter");
    await expect(page.locator("#answer-title")).toHaveText(width === 390 ? "분떠도리" : "Spewpa");
    await expect(page.locator("#best-score")).toHaveText("100.00");
    await expect(page.locator("#attempts")).toHaveText("1");
    await page.keyboard.press("Escape");
    await page.locator("#ranking-search").fill("spewpa");
    await expect(page.locator("#similarity-ranking tr")).toHaveCount(1);
    await expect(page.locator('[data-ranking="665"] .pm-score strong')).toHaveText("100.00");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `.preview/pokemantle-merged-spewpa-${width}.png`, fullPage: true });
    await page.reload();
    await expect(page.locator("#best-score")).toHaveText("100.00");
    await expect(page.locator("#attempts")).toHaveText("1");
    expect(errors).toEqual([]);
  });

test("different cosmetic search aliases cannot add duplicate guesses", async ({ page }) => {
  await page.goto("./pokemantle.html?date=2026-09-10");
  const input = page.locator("#guess-input");
  await input.fill("spewpa meadow");
  await input.press("Enter");
  await expect(page.locator("#attempts")).toHaveText("1");
  await input.fill("spewpa polar");
  await expect(page.locator('#guess-options [data-guess="665"]')).toHaveAttribute("data-guessed", "true");
  await input.press("Enter");
  await expect(page.locator("#attempts")).toHaveText("1");
  await expect(page.locator("#pm-toast")).toHaveText("이미 추측한 모습이에요.");
  await page.reload();
  await expect(page.locator("#guess-history tr")).toHaveCount(1);
  await expect(page.locator('[data-result="665"]')).toContainText("분떠도리");
});

test("a saved give-up with another Spewpa pattern becomes a persisted win and updates the record", async ({ page }) => {
  const legacy = {
    version: data.version, day,
    target: data.pokemon.find((p) => p.key === "spewpa-meadow").id,
    guesses: [
      { id: 25, hint: false },
      { id: data.pokemon.find((p) => p.key === "spewpa-polar").id, hint: false },
      { id: 381, hint: true },
    ],
    gaveUp: true,
  };
  await page.addInitScript(({ storageKey, legacy }) => {
    if (!localStorage.getItem(storageKey)) {
      localStorage.setItem(storageKey, JSON.stringify(legacy));
      localStorage.setItem("pokemantle:records", JSON.stringify([{
        version: legacy.version, day: legacy.day, won: false, attempts: 3, hints: 1,
      }]));
    }
  }, { storageKey, legacy });
  await page.goto(path);
  await expect(page.locator("#answer-title")).toHaveText("분떠도리");
  await expect(page.locator("#best-score")).toHaveText("100.00");
  await expect(page.locator("#attempts")).toHaveText("2");
  await expect(page.locator("#hint-label")).toHaveText("힌트 0/3");
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved).toEqual({
    version: data.version, day, target: 665, gaveUp: false,
    guesses: [{ id: 25, hint: false }, { id: 665, hint: false }],
  });
  await page.reload();
  await expect(page.locator("#attempts")).toHaveText("2");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("pokemantle:records")))).toEqual([{
    version: data.version, day, won: true, attempts: 2, hints: 0,
  }]);
});
