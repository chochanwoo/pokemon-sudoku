import { chooseLanguage } from "../../scripts/browser-language.mjs";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createScratch,
  area,
  potentialScore,
  newRound,
  erase,
  guess,
  advance,
  current,
  serializeRound,
  storageKey,
} from "../../web/src/scratch-engine.js";

const read = (file) =>
  JSON.parse(
    readFileSync(new URL(`../../web/public/${file}.json`, import.meta.url)),
  );
const catalog = read("pokemantle"),
  data = read("scratch"),
  game = createScratch(catalog, data);
const daily = { mode: "daily", day: "2026-09-15" },
  practice = { mode: "practice", seed: "preview214" };
const path = "./scratch.html?mode=practice&seed=preview214";
const act = (page, action) => page.locator(`[data-action="${action}"]`);
const saved = (page, settings = practice) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    storageKey(game, settings),
  );
async function ready(page) {
  await expect(page.locator("#sc-input")).toBeEnabled();
}
async function inputGuess(page, id) {
  await ready(page);
  const p = game.byId.get(id);
  await page.locator("#sc-input").fill(p.english);
  await expect(page.locator(`#sc-options [data-guess="${id}"]`)).toBeVisible();
  await page.locator(`#sc-options [data-guess="${id}"]`).click();
}
async function pixels(page, id = "sc-mask") {
  return page.locator(`#${id}`).evaluate((el) => {
    const d = el.getContext("2d").getImageData(0, 0, 256, 256).data;
    let opaque = 0,
      color = 0,
      checksum = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]) {
        opaque++;
        if (Math.abs(d[i] - d[i + 1]) > 10 || Math.abs(d[i] - d[i + 2]) > 10)
          color++;
      }
      checksum = (checksum + (i + 1) * d[i + 3]) % 1000000007;
    }
    return { opaque, color, checksum };
  });
}
async function stroke(page, from = [100, 100], to = [165, 150]) {
  const r = await page.locator("#sc-mask").boundingBox();
  const point = ([x, y]) => [
    r.x + (x / 256) * r.width,
    r.y + (y / 256) * r.height,
  ];
  await page.mouse.move(...point(from));
  await page.mouse.down();
  await page.mouse.move(...point(to), { steps: 8 });
  await page.mouse.up();
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-15T03:00:00Z"));
});

test("hover erasing works without a click and never intercepts search or menu keys", async ({
  page,
}) => {
  await page.goto(path);
  await ready(page);
  const canvas = page.locator("#sc-mask");
  await canvas.hover({ position: { x: 70, y: 70 } });
  expect(
    await page.evaluate(() => document.activeElement === document.body),
  ).toBe(true);
  const before = await pixels(page);
  await page.keyboard.press("Space");
  const first = await pixels(page);
  expect(first.opaque).toBeLessThan(before.opaque);
  await canvas.hover({ position: { x: 150, y: 150 } });
  await page.keyboard.press("Enter");
  expect((await pixels(page)).opaque).toBeLessThan(first.opaque);
  await page.locator("#sc-input").focus();
  await canvas.hover({ position: { x: 100, y: 100 } });
  const editing = await pixels(page);
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  expect(await pixels(page)).toEqual(editing);
  await expect(page.locator("#sc-input")).toHaveValue(" ");
  await page.locator("[data-language-trigger]").click();
  await canvas.hover({ position: { x: 120, y: 120 } });
  await page.keyboard.press("Enter");
  expect(await pixels(page)).toEqual(editing);
  await page.reload();
  await ready(page);
  expect(await pixels(page)).toEqual(editing);
});

test("scratch is the sixth bilingual hub game, with real previews and only local assets", async ({
  page,
}) => {
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("./");
  await expect(page.locator(".game-card")).toHaveCount(6);
  const card = page.getByRole("link", {
    name: "포케 스크래치 플레이",
    exact: true,
  });
  const ko = await card.locator("img").getAttribute("src");
  await expect
    .poll(() => card.locator("img").evaluate((img) => img.naturalWidth))
    .toBeGreaterThan(300);
  await chooseLanguage(page, "en");
  const en = page.getByRole("link", { name: "Poke Scratch Play", exact: true });
  expect(await en.locator("img").getAttribute("src")).not.toBe(ko);
  await en.click();
  await ready(page);
  await expect(page).toHaveTitle("Poke Scratch | Pokemon Quiz");
  await expect(page.locator("#sc-input")).not.toHaveAttribute("placeholder");
  await expect(
    page.getByRole("combobox", {
      name: "Pokemon name or Pokedex number",
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.locator(".sc-main").innerText()).not.toMatch(/[가-힣]/);
  expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(
    true,
  );
  expect(requests.some((url) => url.endsWith("/pokemon/scratch.json"))).toBe(
    true,
  );
  await act(page, "help").click();
  expect(await page.locator("#sc-dialog").innerText()).not.toMatch(/[가-힣]/);
  await expect(page.locator(".trainer-rank-guide")).toHaveCount(0);
  await act(page, "close-dialog").click();
  await page
    .getByRole("link", { name: "Pokemon Quiz home", exact: true })
    .click();
  await expect(page).toHaveURL("http://127.0.0.1:4173/pokemon/");
  expect(errors).toEqual([]);
});

test("the cover is opaque, real pixels render, and unique erased area survives refresh and language changes", async ({
  page,
}) => {
  await page.goto(path);
  await ready(page);
  const target = game.byId.get(game.targets(practice)[0]);
  expect((await pixels(page)).opaque).toBe(area(target));
  expect((await pixels(page, "sc-picture")).color).toBeGreaterThan(1000);
  await expect(page.locator("#sc-points")).toHaveText("100");
  await stroke(page, [0, 0], [0, 0]);
  await expect(page.locator("#sc-points")).toHaveText("100");
  await stroke(page);
  const first = await saved(page),
    mask = await pixels(page),
    points = await page.locator("#sc-points").innerText();
  expect(Number(points)).toBe(
    potentialScore(first.items[0].erased, area(target), 0),
  );
  expect(Number(points)).toBeLessThan(
    Math.round(100 - (100 * first.items[0].erased) / area(target)),
  );
  await expect(page.locator("#sc-input")).not.toHaveAttribute("placeholder");
  expect(first.items[0].erased).toBeGreaterThan(1000);
  expect(mask.opaque).toBe(area(target) - first.items[0].erased);
  await stroke(page);
  expect((await saved(page)).items[0].erased).toBe(first.items[0].erased);
  await page.reload();
  await ready(page);
  expect(await pixels(page)).toEqual(mask);
  await expect(page.locator("#sc-points")).toHaveText(points);
  await chooseLanguage(page, "en");
  await ready(page);
  expect(await pixels(page)).toEqual(mask);
  expect(await saved(page)).toEqual(first);
  await page.locator('.segmented [data-action="daily"]').click();
  await ready(page);
  await expect(page.locator("#sc-points")).toHaveText("100");
  await act(page, "practice").click();
  await ready(page);
  expect(await pixels(page)).toEqual(mask);
  await page.goBack();
  await ready(page);
  expect((await saved(page, daily)).items[0].erased).toBe(0);
});

test("text-only bilingual search, IME handling, wrong guesses and duplicates preserve the mask", async ({
  page,
}) => {
  await page.goto(path);
  await ready(page);
  await stroke(page);
  const mask = await pixels(page),
    score = Number(await page.locator("#sc-points").innerText());
  const input = page.locator("#sc-input");
  await input.fill("메가 리자몽");
  await expect(page.locator("#sc-options [data-guess]")).toHaveCount(2);
  await expect(page.locator("#sc-options img")).toHaveCount(0);
  await input.fill("growlithe");
  await expect(page.locator("#sc-options")).toContainText("히스이");
  await input.fill("1");
  await input.dispatchEvent("compositionstart");
  await input.press("Enter");
  expect((await saved(page)).items[0].guesses).toHaveLength(0);
  await input.dispatchEvent("compositionend");
  await input.fill("Bulbasaur");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page.locator("#sc-mistakes")).toHaveText("1");
  await expect(page.locator("#sc-points")).toHaveText(String(score - 5));
  expect(await pixels(page)).toEqual(mask);
  await inputGuess(page, 1);
  await expect(page.locator("#sc-feedback")).toHaveText(
    "이미 추측한 포켓몬이에요.",
  );
  await expect(page.locator("#sc-mistakes")).toHaveText("1");
  await expect(page.locator("#sc-points")).toHaveText(String(score - 5));
  await inputGuess(page, game.targets(practice)[0]);
  await expect(page.locator("#sc-question")).toHaveText(
    game.byId.get(game.targets(practice)[0]).name,
  );
  expect((await pixels(page)).opaque).toBe(0);
  await expect(page.locator("#sc-input")).toBeDisabled();
  await page.reload();
  await expect(page.locator("#sc-next")).toBeVisible();
  await expect(page.locator("#sc-points")).toHaveText(String(score - 5));
  await act(page, "next").click();
  await ready(page);
  await expect(page.locator("#sc-points")).toHaveText("100");
});

test("five solved pictures award Red, share no answers and store a single completed record", async ({
  page,
}) => {
  await page.goto(path);
  for (let i = 0; i < 5; i++) {
    await inputGuess(page, game.targets(practice)[i]);
    await expect(page.locator("#sc-total")).toHaveText(String((i + 1) * 100));
    if (i < 4) await act(page, "next").click();
  }
  await expect(page.locator("#sc-dialog")).toBeVisible();
  await expect(page.locator(".sc-award .trainer-badge")).toHaveAttribute(
    "data-trainer-id",
    "red",
  );
  await expect
    .poll(() =>
      page.locator(".sc-award img").evaluate((img) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.sharedResult = text;
        },
      },
    });
  });
  await act(page, "share").click();
  const shared = await page.evaluate(() => window.sharedResult);
  expect(shared).toContain("500/500");
  for (const id of game.targets(practice))
    expect(shared).not.toContain(game.byId.get(id).name);
  expect(new URL(shared.split("\n").at(-1)).searchParams.get("seed")).toBe(
    practice.seed,
  );
  await page.screenshot({ path: ".preview/scratch-red.png" });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 700 });
    expect(
      await page
        .locator("#sc-dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await expect(act(page, "share")).toBeInViewport();
    await page.screenshot({ path: `.preview/scratch-red-${width}.png` });
  }
  await page.reload();
  await expect(page.locator("#sc-dialog")).not.toBeVisible();
  await expect(page.locator(".sc-results li")).toHaveCount(5);
  await expect(page.locator("#sc-total")).toHaveText("500");
  await act(page, "stats").click();
  await expect(page.locator(".sc-records > div")).toHaveCount(1);
});

test("revealing needs confirmation, gives zero, and Joey's result includes the taunt", async ({
  page,
}) => {
  await page.goto(path);
  await ready(page);
  await act(page, "give-up").click();
  await act(page, "close-dialog").last().click();
  await expect(page.locator("#sc-points")).toHaveText("100");
  for (let i = 0; i < 5; i++) {
    await act(page, "give-up").click();
    await act(page, "reveal").click();
    await expect(page.locator("#sc-points")).toHaveText("0");
    if (i < 4) await act(page, "next").click();
  }
  await expect(page.locator(".sc-award .trainer-badge")).toHaveAttribute(
    "data-trainer-id",
    "joey",
  );
  await expect(page.locator(".trainer-taunt")).toHaveText(
    "꼬마야, 더 배우고 와~",
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("blocked");
        },
      },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
  });
  await act(page, "share").click();
  await expect(page.locator(".share-text")).toHaveValue(/0\/500/);
  await page.reload();
  await expect(page.locator("#sc-total")).toHaveText("0");
  await expect(page.locator(".sc-results li")).toHaveCount(5);
});

test("keyboard erasing and pointer cancellation flush progress; brush and practice are preserved", async ({
  page,
}) => {
  await page.goto(path);
  await ready(page);
  const canvas = page.locator("#sc-mask");
  await canvas.focus();
  await canvas.press("Space");
  const first = await saved(page);
  expect(first.items[0].erased).toBeGreaterThan(0);
  await canvas.press("Space");
  expect((await saved(page)).items[0].erased).toBe(first.items[0].erased);
  await canvas.press("ArrowRight");
  await canvas.press("Enter");
  expect((await saved(page)).items[0].erased).toBeGreaterThan(
    first.items[0].erased,
  );
  await page.locator("#sc-brush").fill("32");
  const r = await canvas.boundingBox();
  await page.mouse.move(r.x + 30, r.y + 30);
  await page.mouse.down();
  await page.mouse.move(r.x + 120, r.y + 60);
  await canvas.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  const interrupted = await saved(page);
  await act(page, "new-practice").click();
  await expect(page.locator("#sc-dialog-title")).toHaveText(
    "새 연습을 시작할까요?",
  );
  await act(page, "close-dialog").last().click();
  await page.reload();
  await ready(page);
  expect(await saved(page)).toEqual(interrupted);
  await expect(page.locator("#sc-brush")).toHaveValue("32");
});

test("mobile touch reveals pixels without scrolling, and layouts fit Korean and English at 320-1440px", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:4173/pokemon/${path.slice(2)}`);
    await ready(page);
    const r = await page.locator("#sc-mask").boundingBox(),
      before = await page.evaluate(() => scrollY);
    const session = await context.newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: r.x + r.width * 0.7, y: r.y + r.height * 0.7 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    expect((await saved(page)).items[0].erased).toBeGreaterThan(1000);
    expect(await page.evaluate(() => scrollY)).toBe(before);
    const mask = await pixels(page);
    for (const language of ["ko", "en"]) {
      await chooseLanguage(page, language);
      await ready(page);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({
          width,
          height: width === 320 ? 568 : 900,
        });
        expect(await pixels(page)).toEqual(mask);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const layout = await page.evaluate(() => {
          const board = document
            .querySelector("#sc-surface")
            .getBoundingClientRect();
          const score = document
            .querySelector(".sc-scoreboard")
            .getBoundingClientRect();
          const input = document
            .querySelector("#sc-input")
            .getBoundingClientRect();
          return {
            square: Math.abs(board.width - board.height) < 1,
            noOverlap: input.top >= board.bottom || input.left > board.right,
            scoreAbove: score.bottom <= board.top,
          };
        });
        expect(layout.square).toBe(true);
        expect(layout.noOverlap).toBe(true);
        if (width <= 640) expect(layout.scoreAbove).toBe(true);
        await page.screenshot({
          path: `.preview/scratch-test-${width}-${language}.png`,
          fullPage: true,
        });
      }
    }
  } finally {
    await context.close();
  }
});

test("Korean midnight opens a banner without resetting today's erased area", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-15T14:59:59Z") });
  await page.goto("./scratch.html");
  await ready(page);
  await stroke(page);
  const first = await saved(page, daily);
  await page.clock.fastForward(2000);
  await expect(page.locator("#sc-new-day")).toBeVisible();
  expect(await saved(page, daily)).toEqual(first);
  await page.locator('#sc-new-day [data-action="daily"]').click();
  await ready(page);
  await expect(page.locator("#sc-erased")).toHaveText("0.0%");
  await expect(page.locator(".eyebrow")).toHaveText("2026.09.16");
});

test("bad saves restart safely, quota failure warns, and unavailable data has a retry state", async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, '{"bad":true}'),
    storageKey(game, practice),
  );
  await page.goto(path);
  await ready(page);
  await expect(page.locator("#sc-points")).toHaveText("100");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await stroke(page);
  await expect(page.locator("#sc-save-warning")).toBeVisible();
  await page.route("**/scratch.json", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.reload();
  await expect(page.locator("#sc-retry")).toBeVisible();
  await page.unroute("**/scratch.json");
  await page.locator("#sc-retry").click();
  await ready(page);
});

test("a broken image stays covered, disables guesses and supports retry", async ({
  page,
}) => {
  const target = game.byId.get(game.targets(practice)[0]);
  const broken = structuredClone(catalog);
  broken.images[target.image] = "data:image/png;base64,broken";
  await page.route("**/pokemantle.json", (route) =>
    route.fulfill({ json: broken }),
  );
  await page.goto(path);
  await expect(page.locator("#sc-art-error")).toBeVisible();
  await expect(page.locator("#sc-input")).toBeDisabled();
  await expect(page.locator("#sc-brush")).toBeDisabled();
  await act(page, "retry-image").click();
  await expect(page.locator("#sc-art-error")).toBeVisible();
  await page.unroute("**/pokemantle.json");
  await page.reload();
  await ready(page);
});

test("partially completed rounds restore the current picture and full saved score", async ({
  page,
}) => {
  const round = newRound(game, practice);
  for (let i = 0; i < 3; i++) {
    erase(round, game, [100, 100], [160, 140], 12);
    guess(round, game, current(round).id);
    advance(round);
  }
  erase(round, game, [100, 100], [160, 140], 12);
  const value = serializeRound(round);
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: storageKey(game, practice), value },
  );
  await page.goto(path);
  await ready(page);
  await expect(page.locator(".sc-question-line")).toContainText("4 / 5");
  expect(JSON.stringify(await saved(page))).toBe(value);
  await inputGuess(page, current(round).id);
  await expect(page.locator("#sc-next")).toBeVisible();
});

for (const completed of [2, 5]) {
  test(`legacy scoring migration preserves ${completed} earned scores and resumes without resetting`, async ({
    page,
  }) => {
    const round = newRound(game, practice);
    for (let i = 0; i < completed; i++) {
      erase(round, game, [100, 100], [160, 140], 12);
      guess(round, game, current(round).id);
      if (i < 4) advance(round);
    }
    if (completed < 5) erase(round, game, [100, 100], [160, 140], 12);
    const legacy = JSON.parse(serializeRound(round));
    for (const item of legacy.items) {
      delete item.scoreVersion;
      if (item.outcome === "solved")
        item.points = Math.max(
          10,
          Math.round(
            100 -
              (100 * item.erased) / area(game.byId.get(item.id)) -
              5 * (item.guesses.length - 1),
          ),
        );
    }
    const total = legacy.items.reduce((sum, item) => sum + item.points, 0);
    await page.addInitScript(
      ({ key, value }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, value);
      },
      { key: storageKey(game, practice), value: JSON.stringify(legacy) },
    );
    await page.goto(path);
    await expect(page.locator("#sc-total")).toHaveText(String(total));
    const migrated = await saved(page);
    expect(migrated.index).toBe(legacy.index);
    for (let i = 0; i < completed; i++) {
      expect(migrated.items[i].points).toBe(legacy.items[i].points);
      expect(migrated.items[i].scoreVersion).toBe(1);
    }
    if (completed < 5) {
      await ready(page);
      const item = migrated.items[migrated.index];
      expect(item.mask).toBe(legacy.items[legacy.index].mask);
      expect(item.scoreVersion).toBe(2);
      const points = potentialScore(
        item.erased,
        area(game.byId.get(item.id)),
        0,
      );
      await expect(page.locator("#sc-points")).toHaveText(String(points));
      await inputGuess(page, item.id);
      await expect(page.locator("#sc-total")).toHaveText(
        String(total + points),
      );
    } else {
      await expect(page.locator(".sc-results li")).toHaveCount(5);
      await expect(page.locator("#sc-dialog")).not.toBeVisible();
      await act(page, "stats").click();
      await expect(page.locator(".sc-records > div > strong")).toHaveText(
        String(total),
      );
    }
    const finished = await saved(page);
    await page.reload();
    await expect(page.locator("#sc-next")).toBeVisible();
    expect(await saved(page)).toEqual(finished);
  });
}
