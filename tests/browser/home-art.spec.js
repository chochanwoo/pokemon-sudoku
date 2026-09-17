import { test, expect } from "@playwright/test";
import { chooseLanguage } from "../../scripts/browser-language.mjs";

test("six resort covers use local nonblank artwork, localized labels and stable responsive framing", async ({ page }) => {
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("./");
  const covers = page.locator(".game-cover");
  const backgrounds = page.locator(".game-cover-background");
  await expect(covers).toHaveCount(6);
  expect(await covers.evaluateAll((elements) => elements.map((el) =>
    el.querySelectorAll(".cover-character").length,
  ))).toEqual([3, 1, 1, 2, 0, 1]);
  const sources = await backgrounds.evaluateAll((images) => images.map((img) => img.src));
  expect(new Set(sources).size).toBe(6);
  for (const language of ["ko", "en"]) {
    await chooseLanguage(page, language);
    expect(await backgrounds.evaluateAll((images) => images.map((img) => img.src))).toEqual(sources);
    for (const cover of await covers.all()) {
      await expect(cover).toHaveAttribute("role", "img");
      const label = await cover.getAttribute("aria-label");
      expect(label.length).toBeGreaterThan(15);
      expect(/[가-힣]/.test(label)).toBe(language === "ko");
    }
    for (const width of [320, 390, 800, 1440]) {
      await page.setViewportSize({ width, height: 1080 });
      await page.mouse.move(0, 0);
      for (const cover of await covers.all()) {
        const state = await cover.evaluate(async (el) => {
          const box = el.getBoundingClientRect();
          const images = [];
          for (const img of el.querySelectorAll("img")) {
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 48;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, 48, 48);
            const pixels = ctx.getImageData(0, 0, 48, 48).data;
            const colors = new Set();
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i + 3]) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
            }
            const rect = img.getBoundingClientRect();
            images.push({
              width: img.naturalWidth,
              colors: colors.size,
              fits: rect.left >= box.left - 1 && rect.right <= box.right + 1 &&
                rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1,
            });
          }
          return { images, width: box.width, height: box.height };
        });
        expect(state.width / state.height).toBeCloseTo(16 / 9, 1);
        expect(state.images[0].width).toBe(800);
        expect(state.images[0].colors).toBeGreaterThan(100);
        for (const image of state.images) {
          expect(image.fits).toBe(true);
          expect(image.colors).toBeGreaterThan(5);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: `.preview/home-art-${language}-${width}.png`, fullPage: true });
    }
  }
  expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(true);
  expect(requests.some((url) => /\.(json|bin)(\?|$)/.test(url))).toBe(false);
  expect(errors).toEqual([]);
});

test("cover decoration adds no controls, preserves card navigation and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await expect(page.locator(".cover-scene[aria-hidden=true]")).toHaveCount(6);
  await expect(page.locator(".cover-scene button, .cover-scene a, .cover-scene [tabindex]")).toHaveCount(0);
  const card = page.locator(".game-card").first();
  await card.focus();
  expect(await card.locator(".cover-scene").evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  await card.press("Enter");
  await expect(page).toHaveURL(/\/pokemon\/pokemantle\.html$/);
});

test("the decorative type puzzle uses a valid 4 by 4 solution with three blanks", async ({ page }) => {
  await page.goto("./");
  const cells = await page.locator(".cover-tile img").evaluateAll((images) => images.map((img) => img.src));
  expect(cells).toHaveLength(16);
  for (let n = 0; n < 4; n++) {
    expect(new Set(cells.slice(n * 4, n * 4 + 4)).size).toBe(4);
    expect(new Set([0, 1, 2, 3].map((r) => cells[r * 4 + n])).size).toBe(4);
    const start = Math.floor(n / 2) * 8 + (n % 2) * 2;
    expect(new Set([0, 1, 4, 5].map((i) => cells[start + i])).size).toBe(4);
  }
  await expect(page.locator(".cover-tile.is-empty")).toHaveCount(3);
});
