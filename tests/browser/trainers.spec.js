import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createClueGame,
  newRound as clueRound,
  storageKey,
} from "../../web/src/clue-engine.js";
import {
  dailyTarget,
  newRound as mantleRound,
} from "../../web/src/similarity-engine.js";
import { isPlayableForm } from "../../web/src/form-policy.js";

const read = (name) =>
  JSON.parse(
    readFileSync(new URL(`../../web/public/${name}.json`, import.meta.url)),
  );
const catalog = read("pokemantle");
const clue = createClueGame(catalog, read("pokeclue"));
const day = "2026-09-10";
const setups = [
  {
    name: "pokemantle",
    tierAttempts: [5, 10, 20, 30, 40, 41],
    sixthGuessRank: "난천급",
    dialog: "#pm-dialog",
    input: "#guess-input",
    options: "#guess-options",
    answer: "#answer-title",
    rank: ".pm-result-rank .trainer-badge",
    record: ".pm-record-result",
    round: mantleRound(catalog, day),
    key: `pokemantle:${catalog.version}:${day}`,
    records: "pokemantle:records",
    wrong: catalog.pokemon
      .filter((p) => isPlayableForm(p) && p.id !== dailyTarget(catalog, day))
      .slice(0, 45)
      .map((p) => p.id),
    guesses: (ids) => ids.map((id, i) => ({ id, hint: i === 0 })),
  },
  {
    name: "pokeclue",
    tierAttempts: [3, 5, 8, 11, 15, 16],
    sixthGuessRank: "전진급",
    dialog: "#cq-dialog",
    input: "#cq-input",
    options: "#cq-options",
    answer: "#cq-answer-title",
    rank: ".cq-result-rank .trainer-badge",
    record: ".cq-record-result",
    round: clueRound(clue, { mode: "daily", day }),
    key: storageKey(clue, { mode: "daily", day }),
    records: "pokeclue:records",
    wrong: clue.answers
      .filter((p) => p.id !== clue.targetFor({ mode: "daily", day }))
      .slice(0, 45)
      .map((p) => p.id),
    guesses: (ids) => ids,
  },
];
const tiers = [
  ["S", "레드급", "Red tier", "red"],
  ["A", "난천급", "Cynthia tier", "cynthia-gen4"],
  ["B", "전진급", "Volkner tier", "volkner"],
  ["C", "버틀러급", "Felix tier", "acetrainer-gen4dp"],
  ["D", "모미급", "Cheryl tier", "cheryl"],
  ["E", "오성급", "Joey tier", "youngster-gen4"],
];

async function seed(page, setup, ids, gaveUp = false, record = false) {
  const round = { ...setup.round, guesses: setup.guesses(ids), gaveUp };
  await page.evaluate(
    ({ key, recordKey, round, record }) => {
      localStorage.setItem(key, JSON.stringify(round));
      if (record)
        localStorage.setItem(
          recordKey,
          JSON.stringify([
            {
              version: round.version,
              day: "2026-09-10",
              won: !round.gaveUp,
              attempts: round.guesses.length,
              hints: 1,
            },
          ]),
        );
    },
    { key: setup.key, recordKey: setup.records, round, record },
  );
  await page.reload();
  await expect(
    page.locator(
      gaveUp || ids.includes(setup.round.target) ? setup.answer : setup.input,
    ),
  ).toBeVisible();
}

async function realGuess(page, setup, id) {
  const p = catalog.pokemon.find((p) => p.id === id);
  await page.locator(setup.input).fill(p.key);
  await page.locator(`${setup.options} [data-guess="${id}"]`).click();
}

for (const setup of setups) {
  test(`${setup.name}: a new win opens the trainer popup once, counts hints, shares without the answer and restores focus`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`./${setup.name}.html?date=${day}`);
    await seed(page, setup, setup.wrong.slice(0, 5));
    await expect(page.locator(`${setup.dialog}[open]`)).toHaveCount(0);
    await realGuess(page, setup, setup.round.target);
    const popup = page.locator(`${setup.dialog}.trainer-dialog`);
    await expect(popup).toBeVisible();
    await expect(popup.locator(".trainer-award-title")).toHaveText(
      setup.sixthGuessRank,
    );
    await expect(popup.locator(".trainer-attempts")).toHaveText(
      "6번 만에 정답",
    );
    if (setup.name === "pokemantle")
      await expect(popup.locator(".trainer-hints")).toHaveText("힌트 1회");
    await expect(page.locator(setup.input)).toBeHidden();
    expect(
      await popup.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await page.keyboard.press("Tab");
    expect(
      await popup.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.trainerShare = text;
          },
        },
      }),
    );
    await popup.locator('[data-action="share-award"]').click();
    const shared = await page.evaluate(() => window.trainerShare);
    expect(shared).toContain(`${setup.sixthGuessRank} · 6번 만에 정답`);
    expect(shared).not.toContain(
      catalog.pokemon.find((p) => p.id === setup.round.target).name,
    );
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(page.locator('[data-action="trainer-result"]')).toBeFocused();
    await page.locator('[data-action="trainer-result"]').click();
    await expect(popup).toBeVisible();
    await popup.getByRole("button", { name: "계속 보기", exact: true }).click();
    await page.reload();
    await expect(page.locator(setup.rank)).toContainText(setup.sixthGuessRank);
    await expect(page.locator(`${setup.dialog}[open]`)).toHaveCount(0);
    await page.locator('[data-action="stats"]').click();
    await expect(page.locator(setup.record)).toContainText(
      setup.sixthGuessRank,
    );
    expect(errors).toEqual([]);
  });

  test(`${setup.name}: all six sprites and ranks render from old wins in Korean and English at mobile and desktop sizes`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`./${setup.name}.html?date=${day}`);
    const pixels = [];
    for (const [index, [rank, ko, en, sprite]] of tiers.entries()) {
      const attempts = setup.tierAttempts[index];
      await seed(
        page,
        setup,
        [...setup.wrong.slice(0, attempts - 1), setup.round.target],
        false,
        true,
      );
      for (const [language, name] of [
        ["ko", ko],
        ["en", en],
      ]) {
        await page.locator("[data-language-select]").selectOption(language);
        await expect(page.locator(setup.rank)).toContainText(name);
        await page.locator('[data-action="trainer-result"]').click();
        const popup = page.locator(`${setup.dialog}.trainer-dialog`);
        await expect(popup.locator(".trainer-award-title")).toHaveText(name);
        await expect(popup.locator("[data-trainer-rank]")).toHaveAttribute(
          "data-trainer-rank",
          rank,
        );
        const img = popup.locator(".trainer-stage img");
        await expect(img).toHaveJSProperty("complete", true);
        expect(await img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
        const expected = readFileSync(
          new URL(
            `../../web/src/assets/trainers/${sprite}.png`,
            import.meta.url,
          ),
        ).toString("base64");
        expect(
          await img.evaluate(async (el) => {
            const bytes = new Uint8Array(
              await (await fetch(el.currentSrc)).arrayBuffer(),
            );
            return btoa(String.fromCharCode(...bytes));
          }),
        ).toBe(expected);
        const pixelCheck = await img.evaluate((el) => {
          const c = document.createElement("canvas");
          c.width = el.naturalWidth;
          c.height = el.naturalHeight;
          const ctx = c.getContext("2d");
          ctx.drawImage(el, 0, 0);
          const bytes = ctx.getImageData(0, 0, c.width, c.height).data;
          return {
            visible: bytes.filter((_, i) => i % 4 === 3 && bytes[i] > 0).length,
            fingerprint: Array.from(bytes).reduce(
              (a, b) => (Math.imul(a, 31) + b) | 0,
              0,
            ),
          };
        });
        expect(pixelCheck.visible).toBeGreaterThan(250);
        if (language === "ko") pixels.push(pixelCheck.fingerprint);
        for (const width of [320, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          expect(
            await popup.evaluate((el) => el.scrollWidth <= el.clientWidth),
          ).toBe(true);
          expect(
            await popup
              .locator(
                ".trainer-award-title, .trainer-answer strong, .trainer-attempts, button",
              )
              .evaluateAll((els) =>
                els.every((el) => el.scrollWidth <= el.clientWidth + 1),
              ),
          ).toBe(true);
          await page.screenshot({
            path: `.preview/${setup.name}-award-${rank}-${language}-${width}.png`,
          });
        }
        await page.keyboard.press("Escape");
        await page.locator('[data-action="stats"]').click();
        await expect(
          page.locator(`${setup.record} .trainer-badge`),
        ).toContainText(name);
        await page.keyboard.press("Escape");
      }
    }
    expect(new Set(pixels).size).toBe(6);
  });

  test(`${setup.name}: the popup stays usable on a short viewport, preserves language changes and provides clipboard fallback`, async ({
    page,
  }) => {
    await page.goto(`./${setup.name}.html?date=${day}`);
    await seed(page, setup, [setup.round.target]);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.locator('[data-action="trainer-result"]').click();
    const popup = page.locator(`${setup.dialog}.trainer-dialog`);
    expect(
      await popup.evaluate(
        (el) =>
          el.getBoundingClientRect().height <= innerHeight - 30 &&
          el.scrollWidth <= el.clientWidth,
      ),
    ).toBe(true);
    await page.locator("[data-language-select]").evaluate((el) => {
      el.value = "en";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(popup).toBeVisible();
    await expect(popup.locator(".trainer-award-title")).toHaveText("Red tier");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("Unavailable");
          },
        },
      });
    });
    await popup.locator('[data-action="share-award"]').click();
    await expect(page.locator(`${setup.dialog} .share-text`)).toContainText(
      "Red tier",
    );
    await expect(page.locator(setup.dialog)).not.toHaveClass(/trainer-dialog/);
    await page.keyboard.press("Escape");
    await page.locator('[data-action="trainer-result"]').click();
    await popup.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(popup).toBeHidden();
  });

  test(`${setup.name}: unfinished and given-up rounds earn no trainer rank; missing trainer images have a usable fallback`, async ({
    page,
  }) => {
    await page.goto(`./${setup.name}.html?date=${day}`);
    await seed(page, setup, setup.wrong.slice(0, 2));
    await expect(page.locator('[data-action="trainer-result"]')).toHaveCount(0);
    await seed(page, setup, setup.wrong.slice(0, 2), true, true);
    await expect(page.locator('[data-action="trainer-result"]')).toHaveCount(0);
    await expect(page.locator(`${setup.dialog}[open]`)).toHaveCount(0);
    await page.locator('[data-action="stats"]').click();
    await expect(page.locator(`${setup.record} .trainer-badge`)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await seed(page, setup, [setup.round.target]);
    await page.locator('[data-action="trainer-result"]').click();
    const portrait = page.locator(
      `${setup.dialog} .trainer-stage .trainer-portrait`,
    );
    await portrait.locator("img").evaluate((el) => {
      el.src = "data:image/png;base64,invalid";
    });
    await expect(portrait).toHaveClass(/is-missing/);
    await expect(portrait.locator(".trainer-image-fallback")).toBeVisible();
    await expect(
      page.locator(`${setup.dialog} .trainer-award-title`),
    ).toHaveText("레드급");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-action="trainer-result"]')).toBeFocused();
  });
}
