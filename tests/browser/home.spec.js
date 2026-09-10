import { test, expect } from "@playwright/test";

test("game library is responsive, uses a real local preview and does not start Sudoku", async ({
  page,
}) => {
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("./");
  await expect(page).toHaveTitle("포켓몬 게임");
  await expect(page.getByRole("heading", { name: "전체 게임" })).toBeVisible();
  const game = page.getByRole("link", { name: "타입도쿠 플레이", exact: true });
  await expect(game).toHaveAttribute("href", "./sudoku.html");
  const pokemantle = page.getByRole("link", {
    name: "포케맨틀 플레이",
    exact: true,
  });
  await expect(pokemantle).toHaveAttribute("href", "./pokemantle.html");
  await expect(pokemantle.locator(".game-formats")).toHaveText("데일리");
  await expect(page.locator(".game-library")).not.toContainText(/1,?579/);
  await expect(page.locator("#board")).toHaveCount(0);
  expect(requests.some((url) => /catalog\.json|puzzles\.json/.test(url))).toBe(
    false,
  );
  expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(
    true,
  );
  for (const width of [320, 390, 800, 1440]) {
    await page.setViewportSize({ width, height: width < 800 ? 844 : 1080 });
    const bounds = await game.evaluate(async (card) => {
      const image = card.querySelector("img");
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, 64, 64);
      const colors = new Set();
      const pixels = context.getImageData(0, 0, 64, 64).data;
      for (let i = 0; i < pixels.length; i += 4)
        colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      const cover = card.querySelector(".game-cover").getBoundingClientRect();
      const content = card
        .querySelector(".game-card-content")
        .getBoundingClientRect();
      const imageBounds = image.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        colors: colors.size,
        imageWidth: image.naturalWidth,
        coverBottom: cover.bottom,
        imageBottom: imageBounds.bottom,
        contentTop: content.top,
        titleVisible:
          card.querySelector("h2").getBoundingClientRect().bottom < innerHeight,
      };
    });
    expect(bounds.overflow).toBe(false);
    expect(bounds.colors).toBeGreaterThan(100);
    expect(bounds.imageWidth).toBeGreaterThan(300);
    expect(bounds.imageBottom).toBeLessThanOrEqual(bounds.coverBottom);
    expect(bounds.coverBottom).toBeLessThanOrEqual(bounds.contentTop);
    expect(bounds.titleVisible).toBe(true);
    await page.screenshot({
      path: `.preview/home-${width}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("home, game, browser history and direct refresh preserve saved moves and notes", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await page
    .getByRole("link", { name: "타입도쿠 플레이", exact: true })
    .click();
  await expect(page).toHaveURL(/\/pokemon\/sudoku\.html$/);
  await expect(page.locator(".cell")).toHaveCount(36);
  const blank = page.locator(".cell:not(.given)").first();
  const index = await blank.getAttribute("data-cell");
  await blank.click();
  const type = await page
    .locator("[data-note]")
    .first()
    .getAttribute("data-note");
  await page.locator(`[data-note="${type}"]`).check();
  await page.getByRole("link", { name: "게임 목록으로" }).click();
  await expect(page).toHaveURL(/\/pokemon\/$/);
  await expect(page.locator("#board")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "전체 게임" })).toBeVisible();
  await page
    .getByRole("link", { name: "타입도쿠 플레이", exact: true })
    .click();
  await expect(page.locator(`[data-cell="${index}"] .note-dot`)).toHaveCount(1);
  await page.locator(`[data-cell="${index}"]`).click();
  await expect(page.locator(`[data-note="${type}"]`)).toBeChecked();
  await page.getByRole("button", { name: "힌트", exact: true }).click();
  const savedPokemon = await page
    .locator(`[data-cell="${index}"]`)
    .getAttribute("aria-label");
  await page.getByRole("link", { name: "게임 목록으로" }).click();
  await page.goBack();
  await expect(page.locator(`[data-cell="${index}"]`)).toHaveAttribute(
    "aria-label",
    savedPokemon,
  );
  await page.goForward();
  await expect(page.getByRole("heading", { name: "전체 게임" })).toBeVisible();
  await page
    .getByRole("link", { name: "타입도쿠 플레이", exact: true })
    .click();
  await page.reload();
  await expect(page.locator(`[data-cell="${index}"]`)).toHaveAttribute(
    "aria-label",
    savedPokemon,
  );
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.locator(`[data-cell="${index}"] .note-dot`)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("legacy shared links open Sudoku and new links never point to the library", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./?size=4&level=easy&seed=free:oldlink");
  await expect(page).toHaveURL(
    /\/pokemon\/sudoku\.html\?size=4&level=easy&seed=free:oldlink$/,
  );
  await expect(page.locator(".cell")).toHaveCount(16);
  await page.reload();
  await expect(page.locator(".cell")).toHaveCount(16);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => {
          window.sharedResult = text;
        },
      },
      configurable: true,
    });
  });
  for (let i = 0; i < 16; i++) {
    if (await page.locator("#dialog").isVisible()) break;
    await page.getByRole("button", { name: "힌트", exact: true }).click();
  }
  await expect(page.locator("#dialog-title")).toHaveText("퍼즐 완성!");
  await page.locator('#dialog [data-action="share"]').click();
  const shared = await page.evaluate(() => window.sharedResult);
  const url = new URL(shared.split("\n").at(-1));
  expect(url.pathname).toBe("/pokemon/sudoku.html");
  expect(url.searchParams.get("seed")).toBe("free:oldlink");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("link", { name: "게임 목록으로" }).click();
  await expect(page.getByRole("heading", { name: "전체 게임" })).toBeVisible();
  await page
    .getByRole("link", { name: "타입도쿠 플레이", exact: true })
    .click();
  await expect(page.locator("#completion-banner")).toBeVisible();
  await page.getByRole("button", { name: "오늘의 퍼즐", exact: true }).click();
  await expect(page).toHaveURL(/\/pokemon\/sudoku\.html$/);
  await page.getByRole("button", { name: "새 퍼즐", exact: true }).click();
  await page
    .getByRole("button", { name: "새 자유 퍼즐 시작", exact: true })
    .click();
  await expect(page).toHaveURL(/\/pokemon\/sudoku\.html$/);
  await expect(page.locator(".cell")).toHaveCount(16);
});
