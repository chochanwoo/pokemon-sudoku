import { test, expect } from "@playwright/test";

test("desktop: nested Pages path, real sprites, notes, hints, history, save and pause", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.locator(".cell")).toHaveCount(36);
  await expect(page.locator("h1")).toHaveText("오늘의 타입 퍼즐");
  const blank = page.locator(".cell:not(.given)").first();
  const index = await blank.getAttribute("data-cell");
  await blank.click();
  await page.getByRole("button", { name: "타입 메모", exact: true }).click();
  await page.locator("[data-note]").first().click();
  await expect(page.locator(`[data-cell="${index}"] .note-dot`)).toHaveCount(1);
  await page.getByRole("button", { name: "타입 메모", exact: true }).click();
  await page.getByRole("button", { name: "힌트", exact: true }).click();
  await expect(page.locator(`[data-cell="${index}"] img`)).toHaveCount(1);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.locator(`[data-cell="${index}"] .note-dot`)).toHaveCount(1);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await page.reload();
  await expect(page.locator(`[data-cell="${index}"] img`)).toHaveCount(1);
  await page.getByRole("button", { name: "일시 정지", exact: true }).click();
  await expect(page.locator("#pause-cover")).toBeVisible();
  await page
    .locator("#pause-cover")
    .getByRole("button", { name: "계속하기" })
    .click();
  await expect(page.locator("#pause-cover")).toBeHidden();
  await expect(page.locator(".cell img").first()).toBeVisible();
  const images = await page
    .locator(".cell img")
    .evaluateAll((imgs) =>
      imgs.every((img) => img.complete && img.naturalWidth > 0),
    );
  expect(images).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: ".preview/desktop.png", fullPage: true });
});

test("mobile: size changes, search sheet, selection and completion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expect(page.locator(".cell")).toHaveCount(36);
  await page.getByRole("button", { name: "4 곱하기 4" }).click();
  await expect(page.locator(".cell")).toHaveCount(16);
  await page.screenshot({ path: ".preview/mobile.png", fullPage: true });
  await page.locator(".cell:not(.given)").first().click();
  await expect(page.locator(".picker.sheet-open")).toBeVisible();
  await page.getByRole("searchbox", { name: "포켓몬 검색" }).fill("없는포켓몬");
  await expect(page.locator(".empty-results")).toBeVisible();
  await page.getByRole("button", { name: "검색 초기화", exact: true }).click();
  await page.locator("#legal-only").check();
  await page.screenshot({ path: ".preview/mobile-picker.png", fullPage: true });
  await page.locator(".pokemon-choice").first().click();
  await expect(page.locator(".picker")).toBeHidden();
  for (let i = 0; i < 16; i++) {
    if (await page.locator("#dialog").isVisible()) break;
    await page.getByRole("button", { name: "힌트", exact: true }).click();
  }
  await expect(page.locator("#dialog-title")).toHaveText("퍼즐 완성!");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator("#completion-banner")).toBeVisible();
  await page.reload();
  await expect(page.locator("#completion-banner")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("9x9, reset confirmation, free puzzle, shared seed and malformed storage", async ({
  page,
}) => {
  await page.goto("./?size=9&level=hard&seed=free:reproducible");
  await expect(page.locator(".cell")).toHaveCount(81);
  const original = await page
    .locator(".cell")
    .evaluateAll((cells) => cells.map((c) => c.getAttribute("aria-label")));
  await page.reload();
  await expect(page.locator(".cell")).toHaveCount(81);
  expect(
    await page
      .locator(".cell")
      .evaluateAll((cells) => cells.map((c) => c.getAttribute("aria-label"))),
  ).toEqual(original);
  await page.getByRole("button", { name: "힌트", exact: true }).click();
  await page.getByRole("button", { name: "처음부터", exact: true }).click();
  await page
    .getByRole("button", { name: "처음부터 시작", exact: true })
    .click();
  expect(
    await page
      .locator(".cell")
      .evaluateAll((cells) => cells.map((c) => c.getAttribute("aria-label"))),
  ).toEqual(original);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: ".preview/mobile-nine.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith("typedoku:game:"))
        localStorage.setItem(key, "{invalid");
  });
  await page.reload();
  await expect(page.locator(".cell")).toHaveCount(81);
});
