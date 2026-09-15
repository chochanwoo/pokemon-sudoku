import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createScratch,
  newRound,
  erase,
  serializeRound,
  storageKey,
} from "../web/src/scratch-engine.js";

const read = (name) =>
  JSON.parse(
    readFileSync(new URL(`../web/public/${name}.json`, import.meta.url)),
  );
const game = createScratch(read("pokemantle"), read("scratch"));
let settings;
for (let i = 0; i < 20000; i++) {
  const candidate = { mode: "practice", seed: `preview${i}` };
  if (game.byId.get(game.targets(candidate)[0]).key === "pikachu") {
    settings = candidate;
    break;
  }
}
if (!settings) throw new Error("Preview target missing");
const round = newRound(game, settings);
erase(round, game, [102, 102], [160, 114], 14);
erase(round, game, [130, 106], [128, 154], 14);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: storageKey(game, settings), value: serializeRound(round) },
  );
  const base = process.env.SCRATCH_PREVIEW_URL || "http://127.0.0.1:5173/";
  await page.goto(`${base}scratch.html?mode=practice&seed=${settings.seed}`);
  await page.locator("#sc-input").waitFor();
  await page.waitForFunction(
    () => !document.querySelector("#sc-input").disabled,
  );
  for (const language of ["ko", "en"]) {
    await page.locator("[data-language-select]").selectOption(language);
    await page.waitForFunction(
      () => !document.querySelector("#sc-input").disabled,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: `.preview/scratch-desktop-${language}.png`,
      fullPage: true,
    });
    await page
      .locator(".sc-play")
      .screenshot({
        path: `web/src/assets/scratch-preview${language === "en" ? "-en" : ""}.png`,
      });
    for (const [width, height] of [
      [390, 844],
      [320, 568],
    ]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({
        path: `.preview/scratch-mobile-${width}-${language}.png`,
        fullPage: true,
      });
    }
  }
  console.log(
    JSON.stringify({
      seed: settings.seed,
      erased: round.items[0].erased,
      errors,
    }),
  );
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
