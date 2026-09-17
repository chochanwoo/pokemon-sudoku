import { test, expect } from "@playwright/test";
import { chooseLanguage } from "../../scripts/browser-language.mjs";

const games = ["sudoku", "pokemantle", "pokeclue", "highlow", "pokinator", "scratch"];

for (const width of [1440, 375]) {
  for (const game of games) {
    test(`${game} has a compact resort heading at ${width}px in both languages`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 1080 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`./${game}.html`);
      const heading = page.locator(".resort-heading");
      await expect(heading.locator("h1")).toBeVisible();
      for (const language of ["ko", "en"]) {
        if (language === "en") await chooseLanguage(page, "en");
        const layout = await heading.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const title = el.querySelector("h1").getBoundingClientRect();
          const controls = el.lastElementChild.getBoundingClientRect();
          return {
            height: r.height,
            scrollWidth: document.documentElement.scrollWidth,
            viewport: document.documentElement.clientWidth,
            titleFits: title.left >= r.left && title.right <= r.right + 1,
            controlsFit: controls.left >= r.left && controls.right <= r.right + 1,
            noOverlap: title.bottom <= controls.top || title.right <= controls.left,
            scene: getComputedStyle(el, "::before").backgroundImage,
            corner: getComputedStyle(el, "::after").backgroundImage,
            margin: getComputedStyle(document.body, "::before").display,
            pointerEvents: getComputedStyle(el, "::after").pointerEvents,
          };
        });
        expect(layout.height).toBeLessThan(210);
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport + 1);
        expect(layout.titleFits).toBe(true);
        expect(layout.controlsFit).toBe(true);
        expect(layout.noOverlap).toBe(true);
        expect(layout.scene).toContain("alola-resort");
        expect(layout.corner).toContain("resort-foliage");
        expect(layout.pointerEvents).toBe("none");
        expect(layout.margin === "none").toBe(width === 375);
      }
      expect(errors).toEqual([]);
    });
  }
}

test("resort assets decode locally and the homepage stays outside the game theme", async ({ page }) => {
  await page.goto("./scratch.html?mode=practice&seed=preview214");
  await expect(page.locator("#sc-input")).toBeEnabled();
  const assets = await page.locator(".resort-heading").evaluate(async (el) => {
    const urls = ["::before", "::after"].flatMap((pseudo) =>
      [...getComputedStyle(el, pseudo).backgroundImage.matchAll(/url\("?([^"\)]+)"?\)/g)].map((match) => match[1]),
    );
    const result = [];
    for (const url of urls) {
      const img = new Image();
      img.src = url;
      await img.decode();
      result.push({ local: new URL(url).origin === location.origin, width: img.naturalWidth });
    }
    return result;
  });
  expect(assets).toHaveLength(2);
  for (const asset of assets) {
    expect(asset.local).toBe(true);
    expect(asset.width).toBeGreaterThan(500);
  }
  await page.goto("./");
  await expect(page.locator(".game-card")).toHaveCount(6);
  await expect(page.locator(".resort-main, .resort-heading")).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.body, "::before").content)).toBe("none");
});
