import { chooseLanguage } from "../../scripts/browser-language.mjs";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createHighLow,
  TOTAL_STAT,
  profileKey,
  lastPracticeKey,
  newRound,
  storageKey,
} from "../../web/src/highlow-engine.js";

import { englishName } from "../../web/src/pokemon-names.js";

const read = (name) =>
  JSON.parse(
    readFileSync(new URL(`../../web/public/${name}.json`, import.meta.url)),
  );
const catalog = read("pokemantle"),
  bundle = read("highlow");
const game = createHighLow(catalog, bundle);
const daily = { mode: "daily", day: "2026-09-11" };
const practice = { mode: "practice", seed: "cover7650" };
const path = "./highlow.html?mode=practice&seed=cover7650";
const choice = (page, side) => page.locator(`[data-choice="${side}"]`);
const other = (side) => (side === "left" ? "right" : "left");
async function expectPair(page, settings, index, revealed = false) {
  const q = game.question(settings, index);
  await expect(page.locator("#hl-arena")).toHaveAttribute(
    "data-stat",
    TOTAL_STAT.key,
  );
  for (const side of ["left", "right"]) {
    await expect(choice(page, side)).toHaveAttribute(
      "data-pokemon",
      String(q[side]),
    );
    await expect(choice(page, side).locator(".hl-value")).toHaveText(
      revealed ? String(game.byId.get(q[side]).bst) : "?",
    );
    if (revealed) {
      await expect(choice(page, side)).toBeDisabled();
      await expect(choice(page, side)).toHaveAttribute(
        "aria-label",
        new RegExp(String(game.byId.get(q[side]).bst)),
      );
    } else await expect(choice(page, side)).toBeEnabled();
  }
  return q;
}
async function win(page, settings, index) {
  const q = game.question(settings, index);
  await choice(page, q.winner).click();
  await expect(page.locator("#hl-streak")).toHaveText(String(index + 1));
}
async function lose(page, settings, index) {
  await choice(page, other(game.question(settings, index).winner)).click();
  await expect(page.locator("#hl-dialog")).toBeVisible();
  await expect(page.locator(".hl-result-summary > strong")).toHaveText(
    String(index),
  );
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-11T03:00:00Z"));
});

test("High Low is the fourth localized hub game and runs under a nested Pages path", async ({
  page,
}) => {
  const requests = [],
    errors = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.locator(".game-card")).toHaveCount(6);
  const card = page.getByRole("link", {
    name: "포케 하이로우 플레이",
    exact: true,
  });
  await expect(card).toHaveAttribute("href", "./highlow.html");
  const ko = await card.locator(".game-cover-background").getAttribute("src");
  await chooseLanguage(page, "en");
  const en = page.getByRole("link", {
    name: "Poke High Low Play",
    exact: true,
  });
  expect(await en.locator(".game-cover-background").getAttribute("src")).toBe(ko);
  await en.click();
  await expect(page).toHaveTitle("Poke High Low | Pokemon Quiz");
  await expectPair(page, daily, 0);
  expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(
    true,
  );
  expect(requests.some((url) => url.endsWith("/pokemon/highlow.json"))).toBe(
    true,
  );
  await page
    .getByRole("link", { name: "Pokemon Quiz home", exact: true })
    .click();
  await expect(page).toHaveURL("http://127.0.0.1:4173/pokemon/");
  expect(errors).toEqual([]);
});

test("a correct pick reveals both values once, restores on refresh and advances by keyboard", async ({
  page,
}) => {
  await page.goto(path);
  const q = await expectPair(page, practice, 0);
  const before = await choice(page, "left").boundingBox();
  await choice(page, q.winner).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#hl-streak")).toHaveText("1");
  await expectPair(page, practice, 0, true);
  const after = await choice(page, "left").boundingBox();
  expect(after).toEqual(before);
  await page.evaluate((side) => {
    const button = document.querySelector(`[data-choice="${side}"]`);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, q.winner);
  await expect(page.locator("#hl-streak")).toHaveText("1");
  await page.reload();
  await expectPair(page, practice, 0, true);
  await page.locator("#hl-next").focus();
  await page.keyboard.press("Enter");
  await expectPair(page, practice, 1);
  await expect(choice(page, "left")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(choice(page, "right")).toBeFocused();
  await page.reload();
  await expectPair(page, practice, 1);
  await expect(page.locator("#hl-history li")).toHaveCount(1);
});

test("a wrong pick ends the streak, opens results and persists records without reopening the popup", async ({
  page,
}) => {
  await page.goto(path);
  await win(page, practice, 0);
  await page.locator("#hl-next").click();
  await lose(page, practice, 1);
  await expect(page.locator("#hl-dialog-title")).toHaveText("도전 완료");
  await expect(page.locator(".hl-last-duel strong")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expectPair(page, practice, 1, true);
  await expect(page.locator("#hl-result")).toBeFocused();
  await expect(page.locator("#hl-next")).toBeHidden();
  await page.reload();
  await expectPair(page, practice, 1, true);
  await expect(page.locator("#hl-dialog")).toBeHidden();
  await page.locator('[data-action="stats"]').click();
  await expect(page.locator(".history-list > div")).toHaveCount(1);
  await expect(page.locator(".history-list")).toContainText("1연속 정답");
  await page.keyboard.press("Escape");
  await page.locator("#hl-result").click();
  await expect(page.locator(".hl-result-summary > strong")).toHaveText("1");
});

test("daily and practice isolate saves, resume on navigation and confirm replacing an active practice", async ({
  page,
}) => {
  await page.goto("./highlow.html");
  await win(page, daily, 0);
  await page.locator("#hl-next").click();
  await page.locator('.hl-mode [data-action="practice"]').click();
  const practiceURL = page.url();
  const seed = new URL(practiceURL).searchParams.get("seed");
  const current = { mode: "practice", seed };
  await win(page, current, 0);
  await page.locator('[data-action="new-practice"]').click();
  await expect(page.locator("#hl-dialog-title")).toHaveText(
    "새 연습을 시작할까요?",
  );
  await page.keyboard.press("Escape");
  await expectPair(page, current, 0, true);
  await page.locator('.hl-mode [data-action="daily"]').click();
  await expectPair(page, daily, 1);
  await page.goBack();
  await expectPair(page, current, 0, true);
  await page.locator('[data-action="new-practice"]').click();
  await page.locator('[data-action="start-practice"]').click();
  expect(page.url()).not.toBe(practiceURL);
  await expect(page.locator("#hl-streak")).toHaveText("0");
  await expect(page.locator("#hl-best")).toHaveText("1");
  await page.locator('.hl-mode [data-action="daily"]').click();
  await expectPair(page, daily, 1);
});

test("daily loss cannot be restarted by the mode selector or a refresh", async ({
  page,
}) => {
  await page.goto("./highlow.html");
  await lose(page, daily, 0);
  await page.keyboard.press("Escape");
  await page.locator('.hl-mode [data-action="daily"]').click();
  await expectPair(page, daily, 0, true);
  await page.reload();
  await expectPair(page, daily, 0, true);
  await page.locator('.hl-mode [data-action="practice"]').click();
  await expect(choice(page, "left")).toBeEnabled();
});

test("share includes the streak and reproducible URL, never Pokemon names or stat values", async ({
  page,
}) => {
  await page.goto(path);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.shared = text;
        },
      },
    });
  });
  await win(page, practice, 0);
  await page.locator("#hl-next").click();
  await lose(page, practice, 1);
  await page.locator('[data-action="share"]').click();
  await expect(page.locator("#hl-toast")).toContainText("복사했어요");
  const shared = await page.evaluate(() => window.shared);
  expect(shared.split("\n")).toHaveLength(3);
  expect(shared).toContain("1연속 정답");
  const url = new URL(shared.split("\n").at(-1));
  expect(url.pathname).toBe("/pokemon/highlow.html");
  expect(url.search).toBe("?mode=practice&seed=cover7650");
  expect(shared).not.toMatch(/하드|일반|difficulty/);
  await page.locator("#hl-result").click();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("blocked");
        },
      },
    }),
  );
  await page.locator('[data-action="share"]').click();
  await expect(page.locator(".share-text")).toHaveValue(shared);
});

test("English rules, stat names and results are localized without losing the current round", async ({
  page,
}) => {
  await page.goto(path);
  await win(page, practice, 0);
  await chooseLanguage(page, "en");
  await expectPair(page, practice, 0, true);
  await expect(page.locator("h1")).toHaveText("Poke High Low");
  await expect(choice(page, "left").locator(".hl-name")).toHaveText(
    englishName(game.byId.get(game.question(practice, 0).left)),
  );
  await expect(page.locator("#hl-question")).toHaveText(
    "Which has higher Base stat total?",
  );
  await page.locator('[data-action="help"]').click();
  await expect(page.locator("#hl-dialog-title")).toHaveText(
    "Poke High Low rules",
  );
  expect(await page.locator("#hl-dialog-body").innerText()).not.toMatch(
    /[가-힣]/,
  );
  await page.keyboard.press("Escape");
  await page.locator("#hl-next").click();
  await lose(page, practice, 1);
  await expect(page.locator("#hl-dialog-title")).toHaveText(
    "Challenge complete",
  );
  expect(await page.locator("#hl-dialog-body").innerText()).not.toMatch(
    /[가-힣]/,
  );
  await page.keyboard.press("Escape");
  await chooseLanguage(page, "ko");
  await expectPair(page, practice, 1, true);
  await expect(page.locator("#hl-streak")).toHaveText("1");
});

test("Korean midnight offers the new daily without silently changing an active question", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-09-11T14:59:59Z"));
  await page.goto("./highlow.html");
  await win(page, daily, 0);
  await page.clock.setFixedTime(new Date("2026-09-11T15:00:01Z"));
  await expect(page.locator("#hl-new-day")).toBeVisible();
  await expectPair(page, daily, 0, true);
  await page.locator('#hl-new-day [data-action="daily"]').click();
  await expectPair(page, { mode: "daily", day: "2026-09-12" }, 0);
  await expect(page.locator("#hl-new-day")).toBeHidden();
  await expect(page.locator("#hl-streak")).toHaveText("0");
});

test("corrupt progress is ignored and unrelated game storage is untouched", async ({
  page,
}) => {
  const round = newRound(game, practice);
  round.choices = [other(game.question(practice, 0).winner), "left"];
  round.revealed = true;
  await page.addInitScript(
    ({ key, round }) => {
      localStorage.setItem(key, JSON.stringify(round));
      localStorage.setItem("pokemantle:test-sentinel", "unchanged");
    },
    { key: storageKey(game, practice), round },
  );
  await page.goto(path);
  await expectPair(page, practice, 0);
  await win(page, practice, 0);
  expect(
    await page.evaluate(() => localStorage.getItem("pokemantle:test-sentinel")),
  ).toBe("unchanged");
});

test("unavailable storage and broken images fail gracefully while play continues", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
  });
  await page.goto(path);
  await expect(page.locator("#hl-save-warning")).toBeVisible();
  const card = choice(page, "left");
  const before = await card.boundingBox();
  await card.locator(".hl-sprite img").evaluate((img) => {
    img.src = "data:image/png;base64,invalid";
  });
  await expect(card.locator(".hl-image-fallback")).toBeVisible();
  expect(await card.boundingBox()).toEqual(before);
  await win(page, practice, 0);
  await expectPair(page, practice, 0, true);
});

test("an incompatible data bundle shows a recoverable error instead of a broken game", async ({
  page,
}) => {
  await page.route("**/highlow.json", (route) =>
    route.fulfill({ json: { ...bundle, catalogVersion: "stale" } }),
  );
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "게임을 불러오지 못했어요" }),
  ).toBeVisible();
  await expect(page.locator(".hl-choice")).toHaveCount(0);
  await page.unroute("**/highlow.json");
  await page.locator("#hl-retry").click();
  await expectPair(page, practice, 0);
});

test("desktop and small mobile views have rendered sprites, stable choices and non-overlapping text", async ({
  page,
}) => {
  await page.goto(path);
  for (const lang of ["ko", "en"]) {
    await chooseLanguage(page, lang);
    for (const width of [320, 390, 800, 1440]) {
      await page.setViewportSize({ width, height: width < 800 ? 844 : 1080 });
      const fit = await page
        .locator(".hl-choice")
        .evaluateAll(async (cards) => {
          const details = [];
          for (const card of cards) {
            const img = card.querySelector(".hl-sprite img");
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 64;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, 64, 64);
            const pixels = ctx.getImageData(0, 0, 64, 64).data;
            const colors = new Set();
            let visible = 0;
            for (let i = 0; i < pixels.length; i += 4)
              if (pixels[i + 3]) {
                visible++;
                colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
              }
            const box = card.getBoundingClientRect();
            const children = [...card.children].map((el) =>
              el.getBoundingClientRect(),
            );
            details.push({
              colors: colors.size,
              visible,
              contained: children.every(
                (r) =>
                  r.left >= box.left &&
                  r.right <= box.right &&
                  r.top >= box.top &&
                  r.bottom <= box.bottom,
              ),
              ordered: children.every(
                (r, i) => !i || r.top >= children[i - 1].bottom - 1,
              ),
            });
          }
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            details,
          };
        });
      expect(fit.overflow).toBe(false);
      const controlsFit = await page.locator(".hl-mode").evaluate((el) => {
        const group = el.getBoundingClientRect();
        const buttons = [...el.children].map((button) =>
          button.getBoundingClientRect(),
        );
        return (
          group.left >= 0 &&
          group.right <= innerWidth &&
          buttons[0].right <= buttons[1].left &&
          buttons.every((r) => r.left >= group.left && r.right <= group.right)
        );
      });
      expect(controlsFit).toBe(true);
      for (const item of fit.details) {
        expect(item.colors).toBeGreaterThan(10);
        expect(item.visible).toBeGreaterThan(100);
        expect(item.contained).toBe(true);
        expect(item.ordered).toBe(true);
      }
      await page.screenshot({
        path: `.preview/highlow-${lang}-${width}.png`,
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await lose(page, practice, 0);
  await page.locator('[data-action="start-practice"]').scrollIntoViewIfNeeded();
  const bounds = await page.locator("#hl-dialog").evaluate((el) => ({
    overflow: el.scrollWidth > el.clientWidth,
    viewport: el.getBoundingClientRect().width <= innerWidth,
  }));
  expect(bounds).toEqual({ overflow: false, viewport: true });
  await page.screenshot({ path: ".preview/highlow-result-mobile.png" });
  await page.locator('[data-action="start-practice"]').click();
  await expect(choice(page, "left")).toBeEnabled();
});

test("old links cannot enable retired individual-stat play", async ({
  page,
}) => {
  for (const query of [
    "?difficulty=hard",
    "?difficulty=normal",
    "?date=2026-09-11",
  ]) {
    await page.goto("./highlow.html" + query);
    await expectPair(page, daily, 0);
    await expect(page.locator("[data-difficulty]")).toHaveCount(0);
    await expect(page.locator("#hl-question")).toHaveText(
      "종족값 합계, 어느 쪽이 더 높을까?",
    );
  }
  await win(page, daily, 0);
  await page.locator("#hl-next").click();
  await page.goto("./highlow.html?difficulty=hard");
  await expectPair(page, daily, 1);
  await lose(page, daily, 1);
  await expect(page.locator(".hl-result-mode")).toHaveText("데일리");
});

test("old normal saves and records survive while retired records stay isolated", async ({
  page,
}) => {
  const prefix = `highlow:${game.version}`;
  const round = {
    ...newRound(game, daily),
    choices: ["right", "right"],
    revealed: false,
  };
  await page.addInitScript(
    ({ prefix, round, practice, practiceRound }) => {
      if (localStorage.getItem("hl-fixture")) return;
      localStorage.setItem("hl-fixture", "yes");
      localStorage.setItem(
        prefix + ":normal:daily:2026-09-11",
        JSON.stringify(round),
      );
      localStorage.setItem(prefix + ":normal:best", "6");
      localStorage.setItem(
        prefix + ":normal:records",
        JSON.stringify([
          {
            challenge: "normal:daily:2026-09-10",
            mode: "daily",
            day: "2026-09-10",
            score: 6,
          },
        ]),
      );
      localStorage.setItem(
        prefix + ":daily:2026-09-11",
        JSON.stringify({
          ...round,
          challenge: "daily:2026-09-11",
          choices: ["right"],
        }),
      );
      localStorage.setItem(prefix + ":best", "99");
      localStorage.setItem(
        prefix + ":records",
        JSON.stringify([
          {
            challenge: "daily:2026-09-10",
            mode: "daily",
            day: "2026-09-10",
            score: 99,
          },
        ]),
      );
      localStorage.setItem("highlow:last-practice", JSON.stringify("retired"));
      localStorage.setItem(
        "highlow:normal:last-practice",
        JSON.stringify(practice.seed),
      );
      localStorage.setItem(
        prefix + ":" + practiceRound.challenge,
        JSON.stringify(practiceRound),
      );
    },
    {
      prefix,
      round,
      practice,
      practiceRound: {
        ...newRound(game, practice),
        choices: [game.question(practice, 0).winner],
        revealed: true,
      },
    },
  );
  await page.goto("./highlow.html?difficulty=hard");
  await expectPair(page, daily, 2);
  await expect(page.locator("#hl-best")).toHaveText("6");
  await expect(page.locator("#hl-streak")).toHaveText("2");
  await page.locator('[data-action="stats"]').click();
  await expect(page.locator(".history-list")).toContainText("6연속 정답");
  await expect(page.locator(".history-list")).not.toContainText("99");
  await page.keyboard.press("Escape");
  await page.locator('.hl-mode [data-action="practice"]').click();
  await expectPair(page, practice, 0, true);
  expect(new URL(page.url()).searchParams.has("difficulty")).toBe(false);
  await page.reload();
  await expectPair(page, practice, 0, true);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), prefix + ":best"),
  ).toBe("99");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), lastPracticeKey()),
  ).toBe(JSON.stringify(practice.seed));
  expect(profileKey(game)).toBe(prefix + ":normal");
});

test("English shares use total stats without a difficulty label", async ({
  page,
}) => {
  await page.goto(path + "&difficulty=normal");
  await chooseLanguage(page, "en");
  await win(page, practice, 0);
  await page.locator("#hl-next").click();
  await lose(page, practice, 1);
  await expect(page.locator(".hl-result-mode")).toHaveText("Practice");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.shared = text;
        },
      },
    }),
  );
  await page.locator('[data-action="share"]').click();
  const shared = await page.evaluate(() => window.shared);
  expect(shared).toContain("Poke High Low · Practice");
  expect(shared).not.toMatch(/Normal|Hard|difficulty/);
  await page.goto(shared.split("\n").at(-1));
  await expectPair(page, practice, 1, true);
});

test("long Mega, regional and alternate form names fit in both languages on narrow screens", async ({
  page,
}) => {
  const target = game.pokemon.filter(
    (p) =>
      p.key.includes("tauros-paldea") ||
      p.key.includes("charizard-mega") ||
      p.key.includes("necrozma-dusk"),
  );
  const ids = new Set(target.map((p) => p.id));
  const seeds = [];
  for (let i = 0; i < 20000 && seeds.length < 3; i++) {
    const settings = { mode: "practice", seed: `long${i}` },
      q = game.question(settings, 0);
    if (ids.has(q.left)) {
      seeds.push(settings.seed);
      ids.delete(q.left);
    }
  }
  expect(seeds).toHaveLength(3);
  await page.setViewportSize({ width: 320, height: 844 });
  for (const seed of seeds) {
    await page.goto(`./highlow.html?mode=practice&seed=${seed}`);
    for (const lang of ["en", "ko"]) {
      await chooseLanguage(page, lang);
      const fit = await choice(page, "left").evaluate((card) => {
        const name = card.querySelector(".hl-name"),
          box = card.getBoundingClientRect(),
          label = card.querySelector(".hl-stat-label").getBoundingClientRect(),
          sprite = card.querySelector(".hl-sprite").getBoundingClientRect(),
          rect = name.getBoundingClientRect();
        return (
          name.scrollWidth <= name.clientWidth &&
          rect.top >= sprite.bottom &&
          rect.bottom <= label.top &&
          rect.right <= box.right &&
          document.documentElement.scrollWidth <= innerWidth
        );
      });
      expect(fit).toBe(true);
    }
  }
});
