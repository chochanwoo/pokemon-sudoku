import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createPokinator,
  newRound,
  viewRound,
  answerQuestion,
  rejectGuess,
  STORAGE_KEY,
} from "../../web/src/pokinator-engine.js";

const read = (file) =>
  JSON.parse(
    readFileSync(new URL(`../../web/public/${file}.json`, import.meta.url)),
  );
const data = read("pokinator"),
  game = createPokinator(read("pokemantle"), data);
const candidate = (key) => game.pokemon.find((p) => p.key === key);
function prepare(key) {
  const r = newRound(game, "audit"),
    p = candidate(key),
    index = game.pokemon.indexOf(p);
  for (let i = 0; i < 35; i++) {
    const v = viewRound(game, r);
    if (v.kind === "question")
      answerQuestion(
        game,
        r,
        v.question.values[index] === -1
          ? "unknown"
          : v.question.values[index]
            ? "yes"
            : "no",
      );
    else if (v.kind === "guess" && v.guess.id !== p.id) rejectGuess(game, r);
    else return r;
  }
  throw new Error("Did not converge");
}
async function seed(page, round) {
  await page.evaluate(
    ({ key, round }) => localStorage.setItem(key, JSON.stringify(round)),
    { key: STORAGE_KEY, round },
  );
  await page.reload();
  await expect(page.locator("#pn-prompt")).toBeVisible();
}
async function thinkOf(page, key) {
  const target = candidate(key),
    index = game.pokemon.indexOf(target);
  for (let i = 0; i < 35; i++) {
    if (await page.locator(".pn-guess").count()) {
      const text = await page.locator(".pn-character").innerText();
      if (text.includes(target.name)) return;
      await page.locator('[data-action="reject"]').click();
    } else if (await page.locator(".pn-question").count()) {
      const q = game.questionById.get(
        await page.locator("#pn-prompt").getAttribute("data-question"),
      );
      const v = q.values[index];
      await page
        .locator(`[data-answer="${v === -1 ? "unknown" : v ? "yes" : "no"}"]`)
        .click();
    } else break;
  }
  throw new Error(`Could not guess ${key}`);
}
async function clipboard(page, fail = false) {
  await page.evaluate((fail) => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          if (fail) throw new Error("unavailable");
          window.pnShared = text;
        },
      },
    });
  }, fail);
}
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("the fifth hub game has real bilingual previews and the shared brand returns home", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".game-card")).toHaveCount(5);
  const card = page.locator('.game-card[href="./pokinator.html"]');
  await expect(card.locator("h2")).toHaveText("포키네이터");
  const ko = await card.locator("img").getAttribute("src");
  await page.locator("[data-language-select]").selectOption("en");
  await expect(card.locator("h2")).toHaveText("Pokinator");
  expect(await card.locator("img").getAttribute("src")).not.toBe(ko);
  expect(
    await card.locator("img").evaluate(async (img) => {
      await img.decode();
      return img.naturalWidth;
    }),
  ).toBeGreaterThan(300);
  await card.click();
  await expect(page).toHaveURL(/\/pokemon\/pokinator.html$/);
  await expect(page.locator("#pn-prompt")).toBeVisible();
  await expect(page.locator('[data-answer="unknown"]')).toHaveText(
    "I don't know",
  );
  await page.locator(".brand").click();
  await expect(page).toHaveURL(/\/pokemon\/$/);
});

for (const key of ["mew", "charizard-mega-x", "growlithe-hisui"]) {
  test(`real play guesses ${key}, confirms, saves, shares and localizes without external requests`, async ({
    page,
  }) => {
    const errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => requests.push(r.url()));
    await page.goto("./pokinator.html");
    await expect(page.locator("#pn-prompt")).toBeVisible();
    await seed(page, newRound(game, "audit"));
    await page.evaluate(() => localStorage.setItem("other-game", "untouched"));
    await thinkOf(page, key);
    await expect(page.locator("#pn-prompt")).toContainText(candidate(key).name);
    await page.reload();
    await expect(page.locator(".pn-guess")).toBeVisible();
    await page.locator('[data-action="confirm"]').click();
    await expect(page.locator("#pn-prompt")).toHaveText("맞혔어요!");
    await clipboard(page);
    await page.locator('[data-action="share"]').click();
    expect(await page.evaluate(() => window.pnShared)).toContain(
      candidate(key).name,
    );
    const saved = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_KEY,
    );
    await page.locator("[data-language-select]").selectOption("en");
    await expect(page.locator("#pn-prompt")).toHaveText("Got it!");
    await expect(page.locator(".pn-character")).toContainText(
      candidate(key).english,
    );
    expect(
      await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
    ).toBe(saved);
    await page.reload();
    await expect(page.locator(".pn-complete")).toBeVisible();
    await page.locator('[data-action="stats"]').click();
    await expect(page.locator(".pn-records > div")).toHaveCount(1);
    await expect(page.locator(".pn-records")).toContainText(
      candidate(key).english,
    );
    expect(await page.evaluate(() => localStorage.getItem("other-game"))).toBe(
      "untouched",
    );
    expect(errors).toEqual([]);
    expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(
      true,
    );
    expect(
      requests.some((url) =>
        /scores\.bin|highlow\.json|pokeclue\.json/.test(url),
      ),
    ).toBe(false);
  });
}

test("unknown answers, keyboard input, history edits and navigation preserve the intended round", async ({
  page,
}) => {
  await page.goto("./pokinator.html");
  await expect(page.locator("#pn-prompt")).toBeVisible();
  const first = await page.locator("#pn-prompt").getAttribute("data-question");
  await page.locator('[data-answer="unknown"]').focus();
  await page.keyboard.press("Enter");
  const second = await page.locator("#pn-prompt").getAttribute("data-question");
  expect(first).not.toBe(second);
  await page.locator('[data-answer="no"]').click();
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator("#pn-prompt")).toHaveAttribute(
    "data-question",
    second,
  );
  await page.locator('[data-answer="yes"]').click();
  await page.locator("#pn-history summary").click();
  await page.setViewportSize({ width: 390, height: 568 });
  await page.locator('[data-rewind="0"]').click();
  await expect(page.locator("#pn-prompt")).toBeInViewport();
  await expect(page.locator("#pn-prompt")).toHaveAttribute(
    "data-question",
    first,
  );
  await expect(page.locator(".pn-counter strong")).toHaveText("0");
  await page.locator('[data-answer="unknown"]').click();
  await page.locator(".brand").click();
  await page.locator('.game-card[href="./pokinator.html"]').click();
  await expect(page.locator("#pn-prompt")).toHaveAttribute(
    "data-question",
    second,
  );
  await page.locator('[data-action="help"]').click();
  await page.locator("[data-language-select]").evaluate((el) => {
    el.value = "en";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("#pn-dialog")).toBeVisible();
  await expect(page.locator("#pn-dialog-body")).toContainText(
    "regional forms and Mega Evolutions",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#pn-prompt")).toBeFocused();
  await expect(page.locator("#pn-prompt")).toHaveAttribute(
    "data-question",
    second,
  );
});

test("wrong guesses can be rejected, reversed or followed by more questions", async ({
  page,
}) => {
  await page.goto("./pokinator.html");
  await seed(page, prepare("mew"));
  await page.locator('[data-action="continue"]').click();
  await expect(page.locator(".pn-question")).toBeVisible();
  await page.reload();
  await expect(page.locator(".pn-question")).toBeVisible();
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator(".pn-guess")).toBeVisible();
  await page.locator('[data-action="reject"]').click();
  await expect(page.locator(".pn-question")).toBeVisible();
  await page.reload();
  await page.locator("#pn-history summary").click();
  await expect(page.locator(".pn-rejected")).toContainText("뮤");
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator(".pn-guess")).toBeVisible();
});

test("a yes to Red/Green ends debut questions through undo, reload and language changes", async ({
  page,
}) => {
  const r = newRound(game, "audit"),
    target = candidate("mew"),
    index = game.pokemon.indexOf(target);
  for (let i = 0; i < 25; i++) {
    const v = viewRound(game, r);
    expect(v.kind).toBe("question");
    if (v.question.id === "debut-red-green-japan") break;
    const value = v.question.values[index];
    answerQuestion(game, r, value === -1 ? "unknown" : value ? "yes" : "no");
  }
  expect(viewRound(game, r).question.id).toBe("debut-red-green-japan");
  await page.goto("./pokinator.html");
  await seed(page, r);
  await page.locator('[data-answer="yes"]').click();
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator("#pn-prompt")).toHaveAttribute(
    "data-question",
    "debut-red-green-japan",
  );
  await page.locator('[data-answer="yes"]').click();
  await page.reload();
  await page.locator("[data-language-select]").selectOption("en");
  let found = false;
  for (let i = 0; i < 30; i++) {
    if (await page.locator(".pn-question").count()) {
      const id = await page.locator("#pn-prompt").getAttribute("data-question");
      expect(id.startsWith("debut-")).toBe(false);
      const value = game.questionById.get(id).values[index];
      await page
        .locator(
          `[data-answer="${value === -1 ? "unknown" : value ? "yes" : "no"}"]`,
        )
        .click();
    } else if (await page.locator(".pn-guess").count()) {
      if (
        (await page.locator(".pn-character").innerText()).includes(
          target.english,
        )
      ) {
        await page.locator('[data-action="confirm"]').click();
        found = true;
        break;
      }
      await page.locator('[data-action="reject"]').click();
    } else break;
  }
  expect(found).toBe(true);
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    STORAGE_KEY,
  );
  expect(saved.id).toBe(r.id);
  expect(
    saved.events
      .filter((e) => e.kind === "answer" && e.question.startsWith("debut-"))
      .at(-1),
  ).toEqual({
    kind: "answer",
    question: "debut-red-green-japan",
    value: "yes",
  });
});

test("25 unknowns end without a fake guess; canonical search can reveal the answer with clipboard fallback", async ({
  page,
}) => {
  await page.goto("./pokinator.html");
  await expect(page.locator("#pn-prompt")).toBeVisible();
  for (let i = 0; i < 25; i++)
    await page.locator('[data-answer="unknown"]').click();
  await expect(page.locator(".pn-shortlist")).toBeVisible();
  await expect(page.locator("#pn-prompt")).toHaveText(
    "아직 확신하기 어려워요.",
  );
  await page.locator("#pn-search").fill("지가르데");
  await expect(page.locator("#pn-candidates")).not.toContainText(
    /10%|50%|퍼펙트/,
  );
  await page
    .locator(`#pn-candidates [data-pick="${candidate("zygarde").id}"]`)
    .click();
  await expect(page.locator("#pn-prompt")).toHaveText("이번에는 놓쳤네요.");
  await clipboard(page, true);
  await page.locator('[data-action="share"]').click();
  await expect(page.locator(".share-text")).toContainText("지가르데");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".pn-complete")).toBeVisible();
  await page.locator('[data-action="stats"]').click();
  await expect(page.locator(".pn-records b")).toHaveText("놓침");
});

test("old single-Psychic memory survives migration and avoids implied questions with trivia unknowns", async ({
  page,
}) => {
  const target = candidate("mr-mime"),
    index = game.pokemon.indexOf(target);
  const r = newRound(game, "human-audit-0");
  r.dataVersion = "dd9a765f728dfe67";
  r.events = [
    { kind: "answer", question: "dual-type", value: "no" },
    { kind: "answer", question: "type-14", value: "yes" },
    { kind: "answer", question: "regional", value: "no" },
    { kind: "answer", question: "debut-red-green-japan", value: "yes" },
  ];
  await page.goto("./pokinator.html");
  await seed(page, r);
  await expect(page.locator("#pn-updated")).toHaveCount(0);
  await expect(page.locator(".pn-counter strong")).toHaveText("4");
  await page.locator("[data-language-select]").selectOption("en");
  let found = false;
  for (let step = 0; step < 30; step++) {
    if (await page.locator(".pn-question").count()) {
      const q = game.questionById.get(
        await page.locator("#pn-prompt").getAttribute("data-question"),
      );
      expect(q.group).not.toBe("generation");
      expect(q.group).not.toBe("type");
      expect(q.id.startsWith("region-")).toBe(false);
      const value =
        ["stats", "abilities", "size", "eggs", "biology"].includes(q.group) ||
        q.values[index] === -1
          ? "unknown"
          : q.values[index]
            ? "yes"
            : "no";
      await page.locator(`[data-answer="${value}"]`).click();
    } else if (await page.locator(".pn-guess").count()) {
      if (
        (await page.locator(".pn-character").innerText()).includes(
          target.english,
        )
      ) {
        await page.locator('[data-action="confirm"]').click();
        found = true;
        break;
      }
      await page.locator('[data-action="reject"]').click();
    } else break;
    if (step === 3) {
      await page.reload();
      await expect(page.locator("#pn-prompt")).toBeVisible();
    }
  }
  expect(found).toBe(true);
  await page.reload();
  await expect(page.locator(".pn-complete")).toBeVisible();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    STORAGE_KEY,
  );
  expect(saved.id).toBe(r.id);
  expect(saved.dataVersion).toBe(game.dataVersion);
  expect(saved.events.slice(0, 4)).toEqual(r.events);
});

test("new-round confirmation preserves or replaces only this game's progress", async ({
  page,
}) => {
  await page.goto("./pokinator.html");
  await page.locator('[data-answer="yes"]').click();
  const saved = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  await page.locator('[data-action="new"]').click();
  await expect(page.locator("#pn-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(saved);
  await page.locator('[data-action="new"]').click();
  await page.locator('[data-action="restart"]').click();
  await expect(page.locator(".pn-counter strong")).toHaveText("0");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).not.toBe(saved);
});

test("uncertain final guesses stay tentative and can use all three attempts", async ({
  page,
}) => {
  await page.goto("./pokinator.html");
  await expect(page.locator("#pn-prompt")).toBeVisible();
  const r = newRound(game, "uncertain");
  r.events = game.questions.slice(0, 25).map((q, i) => ({
    kind: "answer",
    question: q.id,
    value: i < 4 ? "yes" : "unknown",
  }));
  await seed(page, r);
  await expect(page.locator(".pn-kicker")).toHaveText("가장 유력한 후보예요");
  await page.locator("[data-language-select]").selectOption("en");
  await expect(page.locator(".pn-kicker")).toHaveText("This is my best guess");
  const names = new Set();
  for (let i = 0; i < 3; i++) {
    await expect(page.locator(".pn-guess")).toBeVisible();
    const guess = await page.locator(".pn-character").innerText();
    expect(names.has(guess)).toBe(false);
    names.add(guess);
    await page.locator('[data-action="reject"]').click();
    await page.reload();
  }
  await expect(page.locator(".pn-shortlist")).toBeVisible();
  await expect(page.locator(".pn-counter strong")).toHaveText("25");
});

test("question updates reset only incompatible progress and retain completed records", async ({
  page,
}) => {
  await page.goto("./pokinator.html");
  await expect(page.locator("#pn-prompt")).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem(
      "pokinator:records",
      JSON.stringify([
        {
          id: "finished",
          day: "2026-09-14",
          answerId: 122,
          questions: 24,
          outcome: "guessed",
        },
      ]),
    );
    localStorage.setItem("other-game", "untouched");
  });
  await seed(page, {
    ...newRound(game, "old"),
    version: "pokinator-v1",
    dataVersion: "old-data",
    events: [{ kind: "answer", question: "gen-until-1", value: "yes" }],
  });
  await expect(page.locator("#pn-updated")).toContainText(
    "완료한 기록은 유지됩니다.",
  );
  await expect(page.locator(".pn-counter strong")).toHaveText("0");
  await page.locator("[data-language-select]").selectOption("en");
  await expect(page.locator("#pn-updated")).toContainText(
    "completed records are kept",
  );
  await page.locator('[data-action="stats"]').click();
  await expect(page.locator(".pn-records > div")).toHaveCount(1);
  await expect(page.locator(".pn-records")).toContainText("Mr. Mime");
  await page.keyboard.press("Escape");
  await page.locator('[data-action="new"]').click();
  await expect(page.locator("#pn-updated")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("other-game"))).toBe(
    "untouched",
  );
});

test("long game-title debut questions fit both languages and mobile sizes", async ({
  page,
}) => {
  const q = data.questions.find((q) => q.id === "debut-scarlet-violet");
  await page.route("**/pokinator.json", (route) =>
    route.fulfill({ json: { ...data, questions: [q] } }),
  );
  await page.goto("./pokinator.html");
  await expect(page.locator("#pn-prompt")).toContainText("최초로 등장했나요?");
  await expect(page.locator("#pn-prompt")).not.toContainText("메가");
  await expect(page.locator("#pn-question-note")).toContainText(
    "추가 콘텐츠 포함",
  );
  for (const language of ["ko", "en"]) {
    await page.locator("[data-language-select]").selectOption(language);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.locator("#pn-prompt").evaluate((el) => {
          const rect = el.getBoundingClientRect(),
            note = document
              .querySelector("#pn-question-note")
              .getBoundingClientRect(),
            buttons = document
              .querySelector(".pn-answer-buttons")
              .getBoundingClientRect();
          return (
            document.documentElement.scrollWidth <= innerWidth &&
            el.scrollWidth <= el.clientWidth &&
            rect.bottom <= note.top &&
            note.bottom <= buttons.top
          );
        }),
      ).toBe(true);
      await page.screenshot({
        path: `.preview/pokinator-debut-${language}-${width}.png`,
        fullPage: true,
      });
    }
  }
});

for (const id of ["starter-family", "fossil-family", "standalone"]) {
  test(`${id} and its scope note fit both languages on mobile and desktop`, async ({
    page,
  }) => {
    const q = data.questions.find((q) => q.id === id);
    await page.route("**/pokinator.json", (route) =>
      route.fulfill({ json: { ...data, questions: [q] } }),
    );
    await page.goto("./pokinator.html");
    for (const language of ["ko", "en"]) {
      await page.locator("[data-language-select]").selectOption(language);
      await expect(page.locator("#pn-prompt")).toHaveText(q[language]);
      await expect(page.locator("#pn-question-note")).toHaveText(
        q.note[language],
      );
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        expect(
          await page.locator("#pn-stage").evaluate((el) => {
            const prompt = el.querySelector("#pn-prompt"),
              note = el.querySelector("#pn-question-note"),
              buttons = el.querySelector(".pn-answer-buttons");
            return (
              document.documentElement.scrollWidth <= innerWidth &&
              [prompt, note, buttons].every(
                (node) => node.scrollWidth <= node.clientWidth,
              ) &&
              prompt.getBoundingClientRect().bottom <=
                note.getBoundingClientRect().top &&
              note.getBoundingClientRect().bottom <=
                buttons.getBoundingClientRect().top
            );
          }),
        ).toBe(true);
        await page.screenshot({
          path: `.preview/pokinator-${id}-${language}-${width}.png`,
          fullPage: true,
        });
      }
    }
  });
}

test("question, guess, shortlist, result and help fit mobile and desktop in both languages with nonblank sprites", async ({
  page,
}) => {
  await page.goto("./pokinator.html");
  await expect(page.locator("#pn-prompt")).toBeVisible();
  for (const state of ["question", "guess", "shortlist", "complete"]) {
    if (state === "guess" || state === "complete")
      await seed(page, prepare("charizard-mega-x"));
    if (state === "shortlist")
      await page.locator('[data-action="stop"]').click();
    if (state === "complete")
      await page.locator('[data-action="confirm"]').click();
    for (const language of ["ko", "en"]) {
      await page.locator("[data-language-select]").selectOption(language);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: width < 500 ? 844 : 1080 });
        const fits = await page.locator("#pn-stage").evaluate((el) => {
          const prompt = el.querySelector("h2").getBoundingClientRect();
          const buttons = el
            .querySelector(".pn-answer-buttons, .pn-result-actions, .pn-search")
            ?.getBoundingClientRect();
          return (
            document.documentElement.scrollWidth <= innerWidth &&
            el.scrollWidth <= el.clientWidth &&
            [...el.querySelectorAll("h2, button")].every(
              (p) => p.scrollWidth <= p.clientWidth + 1,
            ) &&
            (!buttons || prompt.bottom <= buttons.top)
          );
        });
        expect(fits).toBe(true);
        const pixels = await page
          .locator(".pn-portrait img")
          .evaluate(async (img) => {
            await img.decode();
            const c = document.createElement("canvas");
            c.width = c.height = 96;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, 96, 96);
            return [...ctx.getImageData(0, 0, 96, 96).data].filter(
              (v, i) => i % 4 === 3 && v > 0,
            ).length;
          });
        expect(pixels).toBeGreaterThan(150);
        await page.screenshot({
          path: `.preview/pokinator-${state}-${language}-${width}.png`,
          fullPage: true,
        });
      }
    }
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('[data-action="help"]').click();
  expect(
    await page
      .locator("#pn-dialog")
      .evaluate(
        (el) =>
          el.scrollWidth <= el.clientWidth &&
          el.getBoundingClientRect().height <= innerHeight,
      ),
  ).toBe(true);
  await page.screenshot({ path: ".preview/pokinator-help-mobile.png" });
  await page.keyboard.press("Escape");
  await page.locator('[data-action="stats"]').click();
  expect(
    await page.locator(".stats-grid").evaluate((el) => {
      const items = [...el.children].map((item) =>
        item.getBoundingClientRect(),
      );
      return (
        items[0].top === items[1].top &&
        items[0].right < items[1].left &&
        el.scrollWidth <= el.clientWidth
      );
    }),
  ).toBe(true);
  await page.screenshot({ path: ".preview/pokinator-stats-mobile.png" });
});

test("broken artwork, corrupt storage, blocked persistence and invalid bundles fail safely", async ({
  page,
  browser,
}) => {
  await page.goto("./pokinator.html");
  await expect(page.locator("#pn-prompt")).toBeVisible();
  await page.locator(".pn-portrait img").evaluate((el) => {
    el.src = "data:image/png;base64,broken";
  });
  await expect(page.locator(".pn-portrait .pn-image-fallback")).toBeVisible();
  await page.evaluate((key) => {
    localStorage.setItem(key, "bad");
    localStorage.setItem("other", "safe");
  }, STORAGE_KEY);
  await page.reload();
  await expect(page.locator(".pn-counter strong")).toHaveText("0");
  expect(await page.evaluate(() => localStorage.getItem("other"))).toBe("safe");
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
  });
  const blocked = await context.newPage();
  await blocked.goto("http://127.0.0.1:4173/pokemon/pokinator.html");
  await expect(blocked.locator("#pn-save-warning")).toBeVisible();
  await blocked.locator('[data-answer="yes"]').click();
  await expect(blocked.locator(".pn-counter strong")).toHaveText("1");
  await context.close();
  await page.route("**/pokinator.json", (route) =>
    route.fulfill({ json: { ...data, catalogVersion: "incompatible" } }),
  );
  await page.reload();
  await expect(page.locator("#pn-retry")).toBeVisible();
  await expect(page.locator("#pn-stage")).toHaveCount(0);
});
