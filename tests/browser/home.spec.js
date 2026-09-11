import { test, expect } from "@playwright/test";

test("every page shares the same home brand and game logos return to the library", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let reference;
  for (const [name, path, title] of [
    ["home", "./", "포켓몬 퀴즈"],
    [
      "sudoku",
      "./sudoku.html?size=4&level=easy&seed=free:brand",
      "타입도쿠 | 포켓몬 퀴즈",
    ],
    ["pokemantle", "./pokemantle.html?date=2026-09-10", "포맨틀 | 포켓몬 퀴즈"],
    ["pokeclue", "./pokeclue.html?date=2026-09-10", "포케클루 | 포켓몬 퀴즈"],
    [
      "highlow",
      "./highlow.html?date=2026-09-10",
      "포케 하이로우 | 포켓몬 퀴즈",
    ],
  ]) {
    await page.goto(path);
    const brand = page.getByRole("link", {
      name: "포켓몬 퀴즈 메인으로",
      exact: true,
    });
    await expect(brand).toBeVisible();
    await expect(page).toHaveTitle(title);
    await expect(brand).toHaveAttribute("href", "./");
    await expect(brand.locator("svg.lucide-gamepad-2")).toHaveCount(1);
    await expect(brand.locator(".brand-caption")).toHaveText("POKÉMON QUIZ");
    reference ??= await brand.innerHTML();
    expect(await brand.innerHTML()).toBe(reference);
    if (name !== "home") {
      await expect(page.locator(".header-actions > a")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "내 기록", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "게임 규칙", exact: true }),
      ).toBeVisible();
    }
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await brand.evaluate((el) => {
        const box = el.getBoundingClientRect(),
          header = el.parentElement.getBoundingClientRect(),
          next = el.nextElementSibling.getBoundingClientRect();
        return {
          fits:
            box.left >= header.left &&
            box.right <= (next.width ? next.left : header.right) &&
            box.top >= header.top &&
            box.bottom <= header.bottom &&
            el.scrollWidth <= el.clientWidth,
          color: getComputedStyle(el.querySelector(".brand-mark"))
            .backgroundColor,
          icon: el.querySelector("svg").getBoundingClientRect().width,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(layout.fits).toBe(true);
      expect(layout.color).toBe("rgb(223, 71, 72)");
      expect(layout.icon).toBeGreaterThan(20);
      expect(layout.overflow).toBe(false);
      if (width !== 320)
        await page
          .locator(".site-header")
          .screenshot({ path: `.preview/brand-${name}-${width}.png` });
    }
    if (name === "sudoku") {
      await brand.focus();
      await brand.press("Enter");
    } else {
      await page.setViewportSize({ width: 390, height: 900 });
      await brand.locator(".brand-mark").click();
    }
    await expect(page).toHaveURL("http://127.0.0.1:4173/pokemon/");
    await expect(
      page.getByRole("heading", { name: "전체 게임" }),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("game library is responsive, uses a real local preview and does not start Sudoku", async ({
  page,
}) => {
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("./");
  await expect(page).toHaveTitle("포켓몬 퀴즈");
  await expect(page.getByRole("heading", { name: "전체 게임" })).toBeVisible();
  const game = page.getByRole("link", { name: "타입도쿠 플레이", exact: true });
  await expect(game).toHaveAttribute("href", "./sudoku.html");
  const pokemantle = page.getByRole("link", {
    name: "포맨틀 플레이",
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
  await page.getByRole("link", { name: "포켓몬 퀴즈 메인으로" }).click();
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
  await page.getByRole("link", { name: "포켓몬 퀴즈 메인으로" }).click();
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
  await page.getByRole("link", { name: "포켓몬 퀴즈 메인으로" }).click();
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
