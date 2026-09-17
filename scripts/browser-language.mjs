export async function chooseLanguage(page, value) {
  const trigger = page.locator("[data-language-trigger]");
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  await page.locator(`[data-language-option="${value}"]`).click();
}
