import { chooseLanguage } from "./browser-language.mjs";
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { dailyTarget } from "../web/src/similarity-engine.js";
import { createClueGame } from "../web/src/clue-engine.js";

const base = process.env.ALOLA_PREVIEW_URL || "http://127.0.0.1:5173/";
const catalog = JSON.parse(
  readFileSync(new URL("../web/public/pokemantle.json", import.meta.url)),
);
const id = (key) => catalog.pokemon.find((p) => p.key === key).id;
const clueGame = createClueGame(
  catalog,
  JSON.parse(
    readFileSync(new URL("../web/public/pokeclue.json", import.meta.url)),
  ),
);
function dateFor(target, draw) {
  const start = Date.parse("2026-09-01T00:00:00Z");
  for (let i = 0; i < catalog.pokemon.length; i++) {
    const day = new Date(start - i * 86400000).toISOString().slice(0, 10);
    if (draw(day) === id(target)) return day;
  }
  throw new Error(`No preview date for ${target}`);
}
const mantleDate = dateFor("vulpix-alola", (day) => dailyTarget(catalog, day));
const clueDate = dateFor("ivysaur", (day) =>
  clueGame.targetFor({ mode: "daily", day }),
);
const browser = await chromium.launch();
const errors = [];
const previews = [];
async function imagesReady(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) => img.decode().catch(() => {})),
    );
  });
}
try {
  for (const game of [
    {
      id: "typedoku",
      url: "sudoku.html?size=4&level=easy&seed=free:brand",
      selector: "#board",
      ready: ".cell",
      prepare: async (page) => {
        for (let n = 0; n < 3; n++)
          await page.locator('[data-action="hint"]').click();
        await page.mouse.click(8, 8);
      },
    },
    {
      id: "pokemantle",
      url: `pokemantle.html?date=${mantleDate}`,
      selector: ".pm-history",
      ready: "#guess-input",
      prepare: async (page) => {
        for (const key of ["vulpix", "glaceon", "ninetales-alola"]) {
          await page.locator("#guess-input").fill(key);
          await page
            .locator(`#guess-options [data-guess="${id(key)}"]`)
            .click();
        }
      },
    },
    {
      id: "pokeclue",
      url: `pokeclue.html?date=${clueDate}`,
      selector: "#cq-history",
      ready: "#cq-input",
      prepare: async (page) => {
        for (const key of ["charizard", "bulbasaur"]) {
          await page.locator("#cq-input").fill(key);
          await page.locator(`#cq-options [data-guess="${id(key)}"]`).click();
        }
      },
    },
    {
      id: "highlow",
      url: "highlow.html?mode=practice&seed=cover94095",
      selector: "#hl-arena",
      ready: ".hl-choice",
    },
    {
      id: "pokinator",
      url: "pokinator.html",
      selector: "#pn-stage",
      ready: "#pn-prompt",
    },
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 1080 },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${game.id}: ${e.message}`));
    await page.goto(`${base}${game.url}`);
    await page.locator(game.ready).first().waitFor();
    if (game.prepare) await game.prepare(page);
    for (const language of ["ko", "en"]) {
      await chooseLanguage(page, language);
      await imagesReady(page);
      await page.setViewportSize({
        width: game.id === "typedoku" ? 1200 : 640,
        height: 1080,
      });
      const preview = await page.locator(game.selector).first().screenshot();
      previews.push([
        `web/src/assets/${game.id}-preview${language === "en" ? "-en" : ""}.png`,
        preview,
      ]);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        console.log(`Captured ${game.id}: ${language}, ${width}px`);
        await page.screenshot({
          path: `.preview/alola-${game.id}-${width}-${language}.png`,
          fullPage: true,
        });
      }
    }
    await context.close();
  }
  // Batch asset writes after game captures so Vite's reloads cannot interrupt them.
  for (const [path, preview] of previews) writeFileSync(path, preview);
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(`home: ${e.message}`));
  await page.goto(base);
  await page.locator(".game-card").first().waitFor();
  for (const language of ["ko", "en"]) {
    await chooseLanguage(page, language);
    await imagesReady(page);
    for (const width of [320, 390, 800, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 1000 });
      await page.screenshot({
        path: `.preview/alola-home-${width}-${language}.png`,
        fullPage: true,
      });
    }
  }
  console.log(JSON.stringify({ errors }));
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
