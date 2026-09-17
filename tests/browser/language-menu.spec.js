import { test, expect } from "@playwright/test";
import { chooseLanguage } from "../../scripts/browser-language.mjs";

test("custom language menu shows the active language and closes without remounting on reselection", async ({
  page,
}) => {
  await page.goto("./");
  const trigger = page.locator("[data-language-trigger]");
  const menu = page.getByRole("menu");
  await expect(page.locator(".language-picker select")).toHaveCount(0);
  await expect(trigger).toContainText("KO");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(
    page.getByRole("menuitemradio", { name: "한국어" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("menuitemradio", { name: "English" }),
  ).toHaveAttribute("aria-checked", "false");
  await expect(page.locator('[data-language-option="ko"] svg')).toBeVisible();
  await expect(page.locator('[data-language-option="en"] svg')).toBeHidden();
  await page.locator("main").evaluate((el) => (el.dataset.retained = "yes"));
  await page.getByRole("menuitemradio", { name: "한국어" }).click();
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("data-retained", "yes");
  await chooseLanguage(page, "en");
  await expect(trigger).toContainText("EN");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(trigger).toContainText("EN");
  await trigger.click();
  await expect(
    page.getByRole("menuitemradio", { name: "English" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("keyboard navigation, escape, outside clicks and tab leave a predictable focus position", async ({
  page,
}) => {
  await page.goto("./");
  await page.evaluate(() => {
    window.gameEscapes = 0;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") window.gameEscapes++;
    });
  });
  const trigger = page.locator("[data-language-trigger]");
  const menu = page.getByRole("menu");
  const korean = page.getByRole("menuitemradio", { name: "한국어" });
  const english = page.getByRole("menuitemradio", { name: "English" });
  await trigger.focus();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.gameEscapes)).toBe(1);
  await page.keyboard.press("ArrowDown");
  await expect(korean).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(english).toBeFocused();
  await page.keyboard.press("Home");
  await expect(korean).toBeFocused();
  await page.keyboard.press("End");
  await expect(english).toBeFocused();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.gameEscapes)).toBe(1);
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(english).toBeFocused();
  await page.keyboard.press("Space");
  await expect(trigger).toContainText("EN");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(english).toBeFocused();
  await page.keyboard.press("k");
  await expect(korean).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu).toBeHidden();
  await expect(page.locator(".game-card").first()).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Shift+Tab");
  await expect(menu).toBeHidden();
  await expect(page.locator(".brand")).toBeFocused();
  await trigger.click();
  await page.locator(".hub-intro h1").click();
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.locator(".game-card").first().focus();
  await expect(menu).toBeHidden();
});

test("menu keys never move a Sudoku cell or toggle pencil notes", async ({
  page,
}) => {
  await page.goto("./sudoku.html?size=4&level=easy&seed=free:language-menu");
  const cell = page.locator(".cell:not(.given)").first();
  await cell.click();
  const selected = await cell.getAttribute("data-cell");
  await page.locator("[data-language-trigger]").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("n");
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.locator('[data-action="pencil"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator(`.cell[data-cell="${selected}"]`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(page.locator("[data-language-trigger]")).toBeFocused();
});

test("popup is readable, on-screen and above the resort artwork at desktop and mobile sizes", async ({
  page,
}) => {
  await page.goto("./");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    for (const language of ["ko", "en"]) {
      await chooseLanguage(page, language);
      const trigger = page.locator("[data-language-trigger]");
      const before = await trigger.boundingBox();
      await trigger.click();
      expect(await trigger.boundingBox()).toEqual(before);
      const layout = await page.locator(".language-menu").evaluate((menu) => {
        const rect = menu.getBoundingClientRect();
        const items = [...menu.querySelectorAll("button")];
        const point = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          onScreen:
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight,
          aboveScene: menu.contains(point),
          fits: items.every(
            (item) =>
              item.scrollWidth <= item.clientWidth &&
              item.scrollHeight <= item.clientHeight,
          ),
          rows: items.length,
        };
      });
      expect(layout).toEqual({
        onScreen: true,
        aboveScene: true,
        fits: true,
        rows: 2,
      });
      await page.screenshot({
        path: `.preview/language-menu-${width}-${language}.png`,
        clip: {
          x: Math.max(0, width - 420),
          y: 0,
          width: Math.min(width, 420),
          height: 240,
        },
      });
      await page.keyboard.press("Escape");
    }
  }
});

test("touch opens, switches and dismisses the menu on a small phone", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto("./");
    const trigger = page.locator("[data-language-trigger]");
    await trigger.tap();
    await page.getByRole("menuitemradio", { name: "English" }).tap();
    await expect(trigger).toContainText("EN");
    await expect(page.getByRole("menu")).toBeHidden();
    await trigger.tap();
    await page.locator(".hub-intro h1").tap();
    await expect(page.getByRole("menu")).toBeHidden();
    await trigger.tap();
    await trigger.tap();
    await expect(page.getByRole("menu")).toBeHidden();
  } finally {
    await context.close();
  }
});
