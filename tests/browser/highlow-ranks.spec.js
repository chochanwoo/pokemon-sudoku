import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createHighLow,
  newRound,
  storageKey,
  profileKey,
  submitChoice,
  nextQuestion,
  challengeKey,
} from "../../web/src/highlow-engine.js";
import { HIGHLOW_STREAK_RANKS } from "../../web/src/trainer-ranks.js";
import {
  TRAINERS,
  trainerFor,
  trainerResultKey,
} from "../../web/src/trainers.js";

const read = (name) =>
  JSON.parse(
    readFileSync(new URL(`../../web/public/${name}.json`, import.meta.url)),
  );
const game = createHighLow(read("pokemantle"), read("highlow"));
const base = { mode: "practice", seed: "rank-test" };
const path = (difficulty) =>
  `./highlow.html?mode=practice&seed=${base.seed}&difficulty=${difficulty}`;
const other = (side) => (side === "left" ? "right" : "left");
function savedRound(settings, wins, ended = true) {
  const round = newRound(game, settings);
  for (let i = 0; i < wins; i++) {
    submitChoice(round, game, settings, game.question(settings, i).winner);
    nextQuestion(round, game, settings);
  }
  if (ended)
    submitChoice(
      round,
      game,
      settings,
      other(game.question(settings, wins).winner),
    );
  return round;
}
async function seed(page, settings, wins, ended = true) {
  const round = savedRound(settings, wins, ended);
  await page.evaluate(
    ({ key, recordKey, round, settings, wins, ended }) => {
      localStorage.setItem(key, JSON.stringify(round));
      localStorage.setItem(
        recordKey,
        JSON.stringify(
          ended
            ? [
                {
                  challenge: round.challenge,
                  mode: settings.mode,
                  day: "2026-09-11",
                  score: wins,
                },
              ]
            : [],
        ),
      );
    },
    {
      key: storageKey(game, settings),
      recordKey: `${profileKey(game, settings)}:records`,
      round,
      settings,
      wins,
      ended,
    },
  );
  await page.reload();
  await expect(page.locator("#hl-streak")).toHaveText(String(wins));
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-11T03:00:00Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
});

for (const difficulty of ["normal", "hard"]) {
  test(`${difficulty}: every streak tier renders the original sprite and localizes legacy records`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(path(difficulty));
    const settings = { ...base, difficulty };
    for (const [index, tier] of HIGHLOW_STREAK_RANKS[difficulty].entries()) {
      const trainer = trainerFor(
        tier.rank,
        trainerResultKey("highlow", challengeKey(settings), tier.min),
      );
      await seed(page, settings, tier.min);
      await expect(page.locator("#hl-dialog")).toBeHidden();
      for (const [language, name] of [
        ["ko", `${trainer.ko}급`],
        ["en", `${trainer.en} tier`],
      ]) {
        await page.locator("[data-language-select]").selectOption(language);
        await expect(page.locator("#hl-feedback .trainer-badge")).toContainText(
          name,
        );
        await page.locator("#hl-result").click();
        await expect(page.locator(".hl-result-summary")).toHaveAttribute(
          "data-trainer-rank",
          tier.rank,
        );
        await expect(page.locator(".hl-award-badge")).toContainText(name);
        await expect(page.locator(".hl-award-badge")).toHaveAttribute(
          "data-trainer-id",
          trainer.id,
        );
        if (tier.rank === "E")
          await expect(page.locator("#hl-dialog .trainer-taunt")).toHaveText(
            language === "ko"
              ? "꼬마야, 더 배우고 와~"
              : "Hey kid, come back after some more training~",
          );
        else
          await expect(page.locator("#hl-dialog .trainer-taunt")).toHaveCount(
            0,
          );
        const portrait = page.locator(".hl-award img[data-trainer]");
        const expected = readFileSync(
          new URL(
            `../../web/src/assets/trainers/${trainer.sprite}.png`,
            import.meta.url,
          ),
        ).toString("base64");
        expect(
          await portrait.evaluate(async (img) => {
            await img.decode();
            const bytes = new Uint8Array(
              await (await fetch(img.currentSrc)).arrayBuffer(),
            );
            return btoa(String.fromCharCode(...bytes));
          }),
        ).toBe(expected);
        const pixels = await portrait.evaluate((img) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 80;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, 80, 80);
          const data = ctx.getImageData(0, 0, 80, 80).data;
          const colors = new Set();
          let opaque = 0;
          for (let i = 0; i < data.length; i += 4)
            if (data[i + 3]) {
              opaque++;
              colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
            }
          return { opaque, colors: colors.size };
        });
        expect(pixels.opaque).toBeGreaterThan(100);
        expect(pixels.colors).toBeGreaterThan(8);
        for (const width of [320, 1440]) {
          await page.setViewportSize({
            width,
            height: width === 320 ? 844 : 1080,
          });
          const fit = await page.locator("#hl-dialog").evaluate((el) => {
            const popup = el.getBoundingClientRect(),
              award = el.querySelector(".hl-award").getBoundingClientRect(),
              score = el
                .querySelector(".hl-result-summary > strong")
                .getBoundingClientRect(),
              duel = el.querySelector(".hl-last-duel").getBoundingClientRect();
            return (
              popup.left >= 0 &&
              popup.right <= innerWidth &&
              el.scrollWidth <= el.clientWidth &&
              award.bottom <= score.top &&
              score.bottom <= duel.top
            );
          });
          expect(fit).toBe(true);
          if (index === 0 || index === 5)
            await page.screenshot({
              path: `.preview/highlow-rank-${difficulty}-${tier.rank}-${language}-${width}.png`,
            });
        }
        await page.keyboard.press("Escape");
        await expect(page.locator("#hl-result")).toBeFocused();
        await page.locator('[data-action="stats"]').click();
        await expect(
          page.locator(".hl-record-result .trainer-badge"),
        ).toContainText(name);
        await expect(
          page.locator(".hl-record-result > span:last-child"),
        ).toHaveText(
          language === "ko" ? `${tier.min}연속 정답` : `${tier.min} in a row`,
        );
        await page.keyboard.press("Escape");
      }
    }
    expect(errors).toEqual([]);
  });
}

test("all middle-tier candidates appear across challenges and retain their identity in popups, shares, reloads and records", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tier of HIGHLOW_STREAK_RANKS.hard.filter((p) =>
    ["A", "B", "C", "D"].includes(p.rank),
  )) {
    const seen = new Set();
    for (let i = 0; i < 100 && seen.size < TRAINERS[tier.rank].length; i++) {
      const settings = {
        difficulty: "hard",
        mode: "practice",
        seed: `trainer-pool-${i}`,
      };
      const trainer = trainerFor(
        tier.rank,
        trainerResultKey("highlow", challengeKey(settings), tier.min),
      );
      if (seen.has(trainer.id)) continue;
      seen.add(trainer.id);
      await page.goto(
        `./highlow.html?mode=practice&difficulty=hard&seed=${settings.seed}`,
      );
      await seed(page, settings, tier.min);
      await page.locator("[data-language-select]").selectOption("ko");
      await page.locator("#hl-result").click();
      await expect(page.locator(".hl-award-badge")).toHaveAttribute(
        "data-trainer-id",
        trainer.id,
      );
      await expect(page.locator(".hl-award-badge")).toHaveText(
        `${trainer.ko}급`,
      );
      await expect(page.locator("#hl-dialog .trainer-taunt")).toHaveCount(0);
      const pixels = await page
        .locator(".hl-award img")
        .evaluate(async (img) => {
          await img.decode();
          const c = document.createElement("canvas");
          c.width = c.height = 80;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          return [...ctx.getImageData(0, 0, 80, 80).data].filter(
            (v, i) => i % 4 === 3 && v,
          ).length;
        });
      expect(pixels).toBeGreaterThan(250);
      await page.screenshot({
        path: `.preview/trainer-pool-${trainer.id}.png`,
      });
      await page.locator("[data-language-select]").evaluate((el) => {
        el.value = "en";
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await expect(page.locator(".hl-award-badge")).toHaveText(
        `${trainer.en} tier`,
      );
      await expect(page.locator(".hl-award-badge")).toHaveAttribute(
        "data-trainer-id",
        trainer.id,
      );
      await page.evaluate(() => {
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: undefined,
        });
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.poolShare = text;
            },
          },
        });
      });
      await page.locator('#hl-dialog [data-action="share"]').click();
      expect(await page.evaluate(() => window.poolShare)).toContain(
        `${trainer.en} tier`,
      );
      await page.keyboard.press("Escape");
      await page.reload();
      await expect(page.locator("#hl-feedback .trainer-badge")).toHaveAttribute(
        "data-trainer-id",
        trainer.id,
      );
      await page.locator("#hl-result").click();
      await expect(page.locator(".hl-award-badge")).toHaveText(
        `${trainer.en} tier`,
      );
      await page.keyboard.press("Escape");
      await page.locator('[data-action="stats"]').click();
      await expect(
        page.locator(".hl-record-result .trainer-badge"),
      ).toHaveAttribute("data-trainer-id", trainer.id);
      await page.keyboard.press("Escape");
    }
    expect([...seen].sort()).toEqual(
      TRAINERS[tier.rank].map((p) => p.id).sort(),
    );
  }
});

test("a fresh finish awards only correct picks, shares the rank and never repeats the popup on reload", async ({
  page,
}) => {
  const settings = { ...base, difficulty: "hard" };
  await page.goto(path("hard"));
  await seed(page, settings, 11, false);
  await expect(page.locator("#hl-feedback .trainer-badge")).toHaveCount(0);
  await expect(page.locator("#hl-result")).toBeHidden();
  await page
    .locator(`[data-choice="${game.question(settings, 11).winner}"]`)
    .click();
  await expect(page.locator("#hl-streak")).toHaveText("12");
  await expect(page.locator("#hl-dialog")).toBeHidden();
  await page.locator("#hl-next").click();
  await page
    .locator(`[data-choice="${other(game.question(settings, 12).winner)}"]`)
    .click();
  await expect(page.locator("#hl-dialog")).toBeVisible();
  await expect(page.locator(".hl-award-badge")).toContainText("레드급");
  await expect(page.locator(".hl-result-summary > strong")).toHaveText("12");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.sharedRank = text;
        },
      },
    }),
  );
  await page.locator('[data-action="share"]').click();
  const shared = await page.evaluate(() => window.sharedRank);
  expect(shared.split("\n")[1]).toBe("레드급 · 12연속 정답");
  expect(
    new URL(shared.split("\n").at(-1)).searchParams.get("difficulty"),
  ).toBe("hard");
  await page.reload();
  await expect(page.locator("#hl-dialog")).toBeHidden();
  await expect(page.locator("#hl-feedback .trainer-badge")).toContainText(
    "레드급",
  );
  await page.locator("[data-language-select]").selectOption("en");
  await page.locator("#hl-result").click();
  await expect(page.locator(".hl-award-badge")).toContainText("Red tier");
  await page.keyboard.press("Escape");
  await page.locator('[data-difficulty="normal"]').click();
  await expect(page.locator("#hl-feedback .trainer-badge")).toHaveCount(0);
});

test("rank guides use streak ranges for the selected difficulty and fit in both languages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(path("normal"));
  for (const difficulty of ["normal", "hard"]) {
    await page.locator(`[data-difficulty="${difficulty}"]`).click();
    for (const language of ["ko", "en"]) {
      await page.locator("[data-language-select]").selectOption(language);
      await page.locator('[data-action="help"]').click();
      await expect(page.locator(".trainer-rank-guide > div")).toHaveCount(6);
      const ranks = HIGHLOW_STREAK_RANKS[difficulty];
      for (const [index, tier] of ranks.entries()) {
        const row = page.locator(".trainer-rank-guide > div").nth(index);
        const range = index
          ? `${tier.min}${language === "ko" ? "~" : "-"}${ranks[index - 1].min - 1}${language === "ko" ? "연속 정답" : " in a row"}`
          : `${tier.min}${language === "ko" ? "연속 정답 이상" : "+ in a row"}`;
        await expect(row.locator("dd")).toHaveText(range);
        expect(
          await row.evaluate((el) => {
            const dt = el.querySelector("dt").getBoundingClientRect(),
              dd = el.querySelector("dd").getBoundingClientRect();
            return dt.right <= dd.left && el.scrollWidth <= el.clientWidth;
          }),
        ).toBe(true);
      }
      if (language === "en")
        expect(await page.locator("#hl-dialog-body").innerText()).not.toMatch(
          /[가-힣]/,
        );
      await page.keyboard.press("Escape");
    }
  }
});

test("missing trainer artwork has a stable fallback and the result stays usable on a short screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(path("normal"));
  await seed(page, { ...base, difficulty: "normal" }, 0);
  await page.locator("#hl-result").click();
  await expect(page.locator(".hl-award-badge")).toContainText("오성급");
  const portrait = page.locator(".hl-award .trainer-portrait");
  const before = await portrait.boundingBox();
  await portrait.locator("img").evaluate((img) => {
    img.src = "data:image/png;base64,invalid";
  });
  await expect(portrait.locator(".trainer-image-fallback")).toBeVisible();
  expect(await portrait.boundingBox()).toEqual(before);
  expect(
    await portrait.evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.locator('[data-action="start-practice"]').scrollIntoViewIfNeeded();
  expect(
    await page
      .locator("#hl-dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: ".preview/highlow-trainer-short.png" });
  await page.locator('[data-action="start-practice"]').click();
  await expect(page.locator("#hl-dialog")).toBeHidden();
  await expect(page.locator("#hl-feedback .trainer-badge")).toHaveCount(0);
  await expect(page.locator('[data-choice="left"]')).toBeEnabled();
});
