import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  makePuzzle,
  newState,
  placePokemon,
  setNotes,
} from "../../web/src/engine.js";
import { dailyTarget } from "../../web/src/similarity-engine.js";

const read = (name) =>
  JSON.parse(
    readFileSync(new URL(`../../web/public/${name}.json`, import.meta.url)),
  );
const catalog = read("catalog"),
  pack = read("puzzles"),
  oldPack = read("puzzles-v2"),
  forms = read("pokemantle");
const byId = new Map(catalog.pokemon.map((p) => [p.id, p]));

test("Arceus has only 18 real types in search and revealed rankings in both languages", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("./pokemantle.html?date=2026-09-10");
  await page.locator("#guess-input").fill("아르세우스");
  await expect(page.locator("#match-count")).toHaveText("18개 모습");
  await expect(page.locator("#guess-options [role=option]")).toHaveCount(18);
  await expect(page.locator("#guess-options img.pm-type")).toHaveCount(18);
  await expect(page.locator('#guess-options [data-guess="10057"]')).toHaveCount(
    0,
  );
  await page.screenshot({
    path: ".preview/arceus-search-390.png",
    fullPage: true,
  });
  await page.locator("[data-language-select]").selectOption("en");
  await page.locator("#guess-input").fill("Arceus");
  await expect(page.locator("#match-count")).toHaveText("18 forms");
  await expect(page.locator("#guess-options [role=option]")).toHaveCount(18);
  await page.locator("[data-language-select]").selectOption("ko");
  await page.locator("#guess-input").fill("아르세우스");
  await page.locator('#guess-options [data-guess="493"]').click();
  await expect(page.locator("#attempts")).toHaveText("1");
  await page.getByRole("button", { name: "포기", exact: true }).click();
  await page.getByRole("button", { name: "정답 공개", exact: true }).click();
  await expect(page.locator("#ranking-total")).toHaveText("1,559개 모습");
  await page.locator("#ranking-search").fill("아르세우스");
  await expect(page.locator("#similarity-ranking tr")).toHaveCount(18);
  await expect(
    page.locator("#similarity-ranking .pm-type-unknown"),
  ).toHaveCount(0);
  await page.locator("[data-language-select]").selectOption("en");
  await page.locator("#ranking-search").fill("Arceus");
  await expect(page.locator("#similarity-ranking tr")).toHaveCount(18);
  await expect(
    page.locator('#similarity-ranking [data-ranking="10057"]'),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".preview/arceus-ranking-390.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("a removed-answer date uses normal Arceus and the replacement win survives reload", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const day = "2026-05-29";
  expect(dailyTarget(forms, day)).toBe(493);
  await page.addInitScript((day) => {
    const key = `pokemantle:pokemantle-v1:${day}`;
    if (!localStorage.getItem(key))
      localStorage.setItem(
        key,
        JSON.stringify({
          version: "pokemantle-v1",
          day,
          guesses: [{ id: 10057, hint: false }],
          gaveUp: false,
        }),
      );
  }, day);
  await page.goto(`./pokemantle.html?date=${day}`);
  await expect(page.locator("#attempts")).toHaveText("0");
  await page.locator("#guess-input").fill("arceus unknown");
  await expect(page.locator("#guess-options [role=option]")).toHaveCount(0);
  await page.locator("#guess-input").fill("arceus normal");
  await page.locator('#guess-options [data-guess="493"]').click();
  await expect(page.locator("#best-score")).toHaveText("100.00");
  await expect(page.locator("#answer-title")).toContainText(
    "아르세우스 (Normal Type)",
  );
  await expect(page.locator("#answer-panel .pm-type-unknown")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#best-score")).toHaveText("100.00");
  await expect(page.locator("#answer-title")).toContainText(
    "아르세우스 (Normal Type)",
  );
  expect(errors).toEqual([]);
});

test("special forms stay hidden while base mythicals and ambiguous forms remain available", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./pokemantle.html?date=2026-09-10");
  const input = page.locator("#guess-input");
  for (const language of ["ko", "en"]) {
    await page.locator("[data-language-select]").selectOption(language);
    for (const query of [
      "너로정했다캡",
      "pikachu partner cap",
      "pichu spiky eared",
      "zarude dada",
      "vivillon poke ball",
    ]) {
      await input.fill(query);
      await expect(page.locator("#guess-options [role=option]")).toHaveCount(0);
    }
    for (const [query, keys] of [
      ["피카츄", ["pikachu", "pikachu-starter", "pikachu-gmax"]],
      ["피츄", ["pichu"]],
      ["자루도", ["zarude"]],
      [
        "Arceus",
        forms.pokemon
          .filter((p) => p.speciesId === 493 && p.key !== "arceus-unknown")
          .map((p) => p.key),
      ],
    ]) {
      await input.fill(query);
      const ids = await page
        .locator("#guess-options [role=option]")
        .evaluateAll((rows) => rows.map((r) => Number(r.dataset.guess)));
      expect(new Set(ids)).toEqual(
        new Set(
          forms.pokemon.filter((p) => keys.includes(p.key)).map((p) => p.id),
        ),
      );
    }
    for (const key of [
      "mew",
      "celebi",
      "jirachi",
      "magearna-original",
      "greninja-ash",
      "floette-eternal",
    ]) {
      await input.fill(key);
      const p = forms.pokemon.find((p) => p.key === key);
      await expect(
        page.locator(`#guess-options [data-guess="${p.id}"]`),
      ).toBeVisible();
    }
  }
  await input.fill("Pikachu");
  await page.screenshot({
    path: ".preview/filtered-pikachu-1440.png",
    fullPage: true,
  });
  await page.locator('[data-action="give-up"]').click();
  await page.locator('[data-action="confirm-give-up"]').click();
  await page.locator("#ranking-search").fill("Pikachu");
  await expect(page.locator("#similarity-ranking tr")).toHaveCount(3);
  await page.locator("#ranking-search").fill("pichu spiky eared");
  await expect(page.locator("#similarity-ranking tr")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("legacy special-form guesses disappear without dropping other guesses or finished records", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const key = "pokemantle:pokemantle-v1:2026-09-10";
    if (!localStorage.getItem(key)) {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: "pokemantle-v1",
          day: "2026-09-10",
          gaveUp: false,
          guesses: [
            { id: 25, hint: false },
            { id: 10057, hint: true },
            { id: 381, hint: true },
          ],
        }),
      );
      localStorage.setItem(
        "pokemantle:records",
        JSON.stringify([
          {
            version: "pokemantle-v1",
            day: "2026-05-29",
            won: true,
            attempts: 1,
            hints: 0,
          },
        ]),
      );
    }
  });
  await page.goto("./pokemantle.html?date=2026-09-10");
  await expect(page.locator("#attempts")).toHaveText("2");
  await expect(page.locator("#hint-label")).toHaveText("힌트 1/3");
  await expect(page.locator("#guess-history tr")).toHaveCount(2);
  await expect(page.locator('[data-result="10057"]')).toHaveCount(0);
  await page.locator("#guess-input").fill("pichu");
  await page.locator('#guess-options [data-guess="172"]').click();
  await page.reload();
  await expect(page.locator("#attempts")).toHaveText("3");
  await expect(page.locator('[data-result="10057"]')).toHaveCount(0);
  const records = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("pokemantle:records")),
  );
  expect(records).toEqual([
    {
      version: "pokemantle-v1",
      day: "2026-05-29",
      won: true,
      attempts: 1,
      hints: 0,
    },
  ]);
  expect(errors).toEqual([]);
});

for (const width of [390, 1440])
  test(`Typedoku supports Mega and regional forms, their names and saved entries at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 1000 });
    const puzzle = makePuzzle(pack, catalog, {
      size: 9,
      difficulty: "hard",
      seed: "free:forms",
    });
    const state = newState(puzzle);
    const index = state.entries.findIndex((id) => id === null);
    const mega = catalog.pokemon.find(
      (p) => p.key.includes("-mega") && !state.entries.includes(p.id),
    );
    const region = catalog.pokemon.find(
      (p) => p.key.includes("-alola") && !state.entries.includes(p.id),
    );
    await page.goto("./sudoku.html?size=9&level=hard&seed=free:forms");
    await page.locator(`[data-cell="${index}"]`).click();
    await page.locator("#search").fill("메가리자몽X");
    await expect(page.locator('[data-pokemon="10134"]')).toBeVisible();
    await page.locator("#search").fill("알로라 라이츄");
    const raichu = catalog.pokemon.find((p) => p.key === "raichu-alola");
    await expect(
      page.locator(`[data-pokemon="${raichu.id}"] .choice-number`),
    ).toHaveText("#026");
    await page.locator("#search").fill(mega.name);
    const choice = page.locator(`[data-pokemon="${mega.id}"]`);
    const image = choice.locator(".sprite");
    await expect(image).toBeVisible();
    expect(
      await image.evaluate(async (img) => {
        await img.decode();
        return img.naturalWidth;
      }),
    ).toBeGreaterThan(0);
    await page.screenshot({
      path: `.preview/mega-picker-${width}.png`,
      fullPage: true,
    });
    await choice.click();
    await expect(page.locator(`[data-cell="${index}"]`)).toHaveAttribute(
      "aria-label",
      new RegExp(mega.baseName),
    );
    const other = state.entries.findIndex(
      (id, i) => id === null && i !== index,
    );
    await page.locator(`[data-cell="${other}"]`).click();
    await page.locator("#search").fill(region.name);
    await page.locator(`[data-pokemon="${region.id}"]`).click();
    await page.reload();
    await expect(page.locator(`[data-cell="${index}"]`)).toHaveAttribute(
      "aria-label",
      new RegExp(mega.baseName),
    );
    await expect(page.locator(`[data-cell="${other}"]`)).toHaveAttribute(
      "aria-label",
      new RegExp(region.baseName),
    );
    await page.locator("[data-language-select]").selectOption("en");
    await page.locator(`[data-cell="${index}"]`).click();
    await page.locator("#search").fill("Mega Charizard X");
    await expect(page.locator('[data-pokemon="10134"]')).toBeVisible();
    await page.screenshot({
      path: `.preview/mega-picker-en-${width}.png`,
      fullPage: true,
    });
    const layout = await page
      .locator('[data-pokemon="10134"] .choice-name')
      .evaluate((el) => ({
        height: el.scrollHeight <= el.clientHeight,
        width: el.scrollWidth <= el.clientWidth,
      }));
    expect(layout).toEqual({ height: true, width: true });
    expect(errors).toEqual([]);
  });

test("old saved puzzles retain their original entries, notes and clues while new games use the expanded catalog", async ({
  page,
}) => {
  const legacy = {
    ...catalog,
    version: 1,
    pokemon: catalog.pokemon.filter((p) => !p.isAlternate),
  };
  const legacyById = new Map(legacy.pokemon.map((p) => [p.id, p]));
  const settings = {
    size: 6,
    difficulty: "hard",
    seed: "free:oldforms",
    mode: "free",
  };
  const puzzle = makePuzzle(oldPack, legacy, settings),
    state = newState(puzzle);
  const blank = state.entries
    .map((id, i) => (id === null ? i : -1))
    .filter((i) => i >= 0);
  placePokemon(
    puzzle,
    state,
    legacyById,
    blank[0],
    puzzle.representatives[blank[0]],
  );
  setNotes(puzzle, state, blank[1], [puzzle.types[0]]);
  state.elapsedMs = 42000;
  const key = `typedoku:game:${puzzle.id}`;
  await page.addInitScript(
    ({ settings, key, state }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem("typedoku:settings", JSON.stringify(settings));
        localStorage.setItem(key, JSON.stringify(state));
      }
    },
    { settings, key, state },
  );
  await page.goto("./sudoku.html");
  await expect(page.locator(".cell")).toHaveCount(36);
  await expect(page.locator(`[data-cell="${blank[1]}"] .note-dot`)).toHaveCount(
    1,
  );
  const fixed = puzzle.givens.findIndex(Boolean);
  await expect(page.locator(`[data-cell="${fixed}"]`)).toHaveAttribute(
    "aria-label",
    new RegExp(byId.get(state.entries[fixed]).name),
  );
  await expect(page.locator("#picker-count")).toHaveText("526종");
  await page.reload();
  await expect(page.locator("#picker-count")).toHaveText("526종");
  await page.getByRole("button", { name: "새 퍼즐", exact: true }).click();
  await page
    .getByRole("button", { name: "새 자유 퍼즐 시작", exact: true })
    .click();
  await expect(page.locator("#picker-count")).toHaveText("652개 모습");
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    key,
  );
  expect(saved.entries).toEqual(state.entries);
  expect(saved.notes).toEqual(state.notes);
  await page.goto(`./sudoku.html?size=6&level=hard&seed=free:oldforms&v=2`);
  await expect(page.locator("#picker-count")).toHaveText("526종");
  await expect(page.locator(`[data-cell="${blank[1]}"] .note-dot`)).toHaveCount(
    1,
  );
});
