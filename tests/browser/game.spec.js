import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  makePuzzle,
  newState,
  getUnitTypeStatus,
  getCandidateTypes,
  placePokemon,
} from "../../web/src/engine.js";

const catalog = JSON.parse(
  readFileSync(new URL("../../web/public/catalog.json", import.meta.url)),
);
const pack = JSON.parse(
  readFileSync(new URL("../../web/public/puzzles.json", import.meta.url)),
);
const byId = new Map(catalog.pokemon.map((p) => [p.id, p]));

async function expectUnits(page, selector, units) {
  expect(
    await page.locator(`${selector} .board-unit`).evaluateAll((rows) =>
      rows.map((row) => ({
        key: row.dataset.unit,
        missing: [...row.querySelectorAll("[data-missing-type]")].map((t) =>
          Number(t.dataset.missingType),
        ),
        count: Number(row.querySelector(".unit-count").textContent),
      })),
    ),
  ).toEqual(
    units.map((unit) => ({
      key: `${unit.kind}-${unit.index}`,
      missing: unit.missing,
      count: unit.missing.length,
    })),
  );
}

test("direct candidate notes, automatic notes and all unit trackers survive moves and reload", async ({
  page,
}) => {
  const puzzle = makePuzzle(pack, catalog, {
    size: 6,
    difficulty: "hard",
    seed: "free:notes",
  });
  const state = newState(puzzle);
  const index = state.entries.indexOf(null);
  await page.goto("./?size=6&level=hard&seed=free:notes");
  await page.locator(`[data-cell="${index}"]`).click();
  await expect(page.locator("#note-picker")).toBeVisible();
  const note = page.locator("[data-note]").first();
  await note.check();
  await expect(note).toBeChecked();
  await note.press("Control+z");
  await expect(note).not.toBeChecked();
  await expect(note).toBeFocused();
  await note.press("Control+Shift+z");
  await expect(note).toBeChecked();
  await expect(page.locator(`[data-cell="${index}"] .note-dot`)).toHaveCount(1);
  await page.reload();
  await page.locator(`[data-cell="${index}"]`).click();
  await expect(note).toBeChecked();
  await page
    .getByRole("button", { name: "충돌 없는 후보 메모", exact: true })
    .click();
  const candidates = getCandidateTypes(puzzle, state.entries, byId, index);
  expect(
    await page
      .locator("[data-note]:checked")
      .evaluateAll((els) => els.map((el) => Number(el.dataset.note))),
  ).toEqual(candidates);
  const units = getUnitTypeStatus(puzzle, state.entries, byId);
  await expectUnits(page, "#board", units);
  await expect(page.locator(".board-unit.current-unit")).toHaveCount(3);
  await expect(page.locator("#unit-tracker, #selected-units")).toHaveCount(0);
  await page.locator('[data-board-unit="row-0"]').click();
  await expect(page.locator("#dialog-title")).toHaveText("1행 남은 타입");
  await expect(page.locator("#dialog-body .type-badge")).toHaveCount(
    units[0].missing.length,
  );
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page
    .getByRole("button", { name: "후보 메모 지우기", exact: true })
    .click();
  await expect(page.locator("[data-note]:checked")).toHaveCount(0);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.locator("[data-note]:checked")).toHaveCount(
    candidates.length,
  );
  const headerBounds = await page
    .locator(".board-unit")
    .evaluateAll((headers) =>
      headers.map((header) => ({
        width: header.offsetWidth,
        height: header.offsetHeight,
      })),
    );
  await page
    .locator(`[data-pokemon="${puzzle.representatives[index]}"]`)
    .click();
  placePokemon(puzzle, state, byId, index, puzzle.representatives[index]);
  await expectUnits(
    page,
    "#board",
    getUnitTypeStatus(puzzle, state.entries, byId),
  );
  await expect(page.locator("#note-picker")).toBeHidden();
  expect(
    await page.locator(".board-unit").evaluateAll((headers) =>
      headers.map((header) => ({
        width: header.offsetWidth,
        height: header.offsetHeight,
      })),
    ),
  ).toEqual(headerBounds);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expectUnits(page, "#board", units);
  await expect(page.locator("[data-note]:checked")).toHaveCount(
    candidates.length,
  );
  const duplicateUnit = units.find(
    (unit) =>
      unit.cells.includes(index) && unit.cells.some((i) => puzzle.givens[i]),
  );
  const duplicateCell = duplicateUnit.cells.find((i) => puzzle.givens[i]);
  await page
    .locator(`[data-pokemon="${puzzle.representatives[duplicateCell]}"]`)
    .click();
  const warningHeader = page.locator(
    `[data-board-unit="${duplicateUnit.kind}-${duplicateUnit.index}"]`,
  );
  await expect(warningHeader).toHaveClass(/unit-conflict/);
  await warningHeader.click();
  await expect(page.locator(".unit-detail-warning")).toHaveText("중복 타입");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expectUnits(page, "#board", units);
  await page.getByRole("button", { name: "일시 정지", exact: true }).click();
  await expect(page.locator(".board-unit").first()).toBeHidden();
  await expect(page.locator("#note-picker")).toBeHidden();
  await page.locator('#pause-cover [data-action="pause"]').click();
  await expect(page.locator("#note-picker")).toBeVisible();
  await page.screenshot({
    path: ".preview/candidate-desktop.png",
    fullPage: true,
  });
});

test("mobile notes are immediately editable and all 18 fit without resizing the board", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("./?size=9&level=hard&seed=free:mobilenotes");
  const cell = page.locator(".cell:not(.given)").first();
  const before = await cell.boundingBox();
  await cell.click();
  await expect(page.locator("#note-picker")).toBeVisible();
  for (const checkbox of await page.locator("[data-note]").all())
    await checkbox.check();
  await expect(page.locator("[data-note]:checked")).toHaveCount(18);
  await expect(page.locator(".board-unit.current-unit")).toHaveCount(3);
  await page.getByRole("button", { name: "선택창 닫기", exact: true }).click();
  await expect(cell.locator(".note-dot")).toHaveCount(18);
  const after = await cell.boundingBox();
  expect(after.width).toBeCloseTo(before.width);
  expect(after.height).toBeCloseTo(before.height);
  expect(
    await cell.locator(".note-dot").evaluateAll((notes) =>
      notes.every((note) => {
        const bounds = note.getBoundingClientRect(),
          parent = note.closest(".cell").getBoundingClientRect();
        const image = note.querySelector(".type-icon");
        const imageBounds = image.getBoundingClientRect();
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.left >= parent.left &&
          bounds.right <= parent.right &&
          bounds.top >= parent.top &&
          bounds.bottom <= parent.bottom &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.alt.length > 0 &&
          imageBounds.width >= 8 &&
          imageBounds.height >= 8 &&
          imageBounds.left >= parent.left &&
          imageBounds.right <= parent.right &&
          imageBounds.top >= parent.top &&
          imageBounds.bottom <= parent.bottom
        );
      }),
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".preview/candidate-mobile-board.png",
    fullPage: true,
  });
  await cell.click();
  await expect(page.locator("[data-note]:checked")).toHaveCount(18);
  await page.screenshot({
    path: ".preview/candidate-mobile-picker.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Pokemon type icons remain visible and fit below sprites at every board size", async ({
  page,
}) => {
  for (const size of [4, 6, 9]) {
    const puzzle = makePuzzle(pack, catalog, {
      size,
      difficulty: "hard",
      seed: "free:typelabels",
    });
    const state = newState(puzzle);
    state.entries = [...puzzle.representatives];
    // Check every filled cell, not just the fixed clues.
    await page.addInitScript(
      ({ key, state }) => localStorage.setItem(key, JSON.stringify(state)),
      {
        key: `typedoku:game:${puzzle.id}`,
        state,
      },
    );
    await page.goto(`./?size=${size}&level=hard&seed=free:typelabels`);
    await expect(page.locator(".cell-types .type-badge")).toHaveCount(
      size * size * 2,
    );
    for (const width of [320, 360, 390, 460, 600, 800, 900, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const clipped = await page
        .locator(".cell-types .type-badge")
        .evaluateAll((badges) =>
          badges.flatMap((badge) => {
            const bounds = badge.getBoundingClientRect();
            const cell = badge.closest(".cell"),
              cellBounds = cell.getBoundingClientRect();
            const sprite = cell
              .querySelector(".sprite")
              .getBoundingClientRect();
            const image = badge.querySelector(".type-icon");
            const glyph = image.getBoundingClientRect();
            const fits =
              image.complete &&
              image.naturalWidth > 0 &&
              image.alt.length > 0 &&
              glyph.width >= 12 &&
              glyph.height >= 12 &&
              glyph.left >= bounds.left - 0.5 &&
              glyph.right <= bounds.right + 0.5 &&
              glyph.top >= bounds.top - 0.5 &&
              glyph.bottom <= bounds.bottom + 0.5 &&
              bounds.left >= cellBounds.left &&
              bounds.right <= cellBounds.right &&
              bounds.bottom <= cellBounds.bottom &&
              sprite.bottom <= bounds.top + 0.5;
            return fits
              ? []
              : [
                  {
                    cell: cell.dataset.cell,
                    type: image.alt,
                    bounds: bounds.toJSON(),
                    glyph: glyph.toJSON(),
                    sprite: sprite.toJSON(),
                  },
                ];
          }),
        );
      expect(clipped, `${size}x${size} at ${width}px`).toEqual([]);
      expect(
        await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
        })),
        `${size}x${size} at ${width}px`,
      ).toEqual({ width, scroll: width });
      if (width === 390)
        await page
          .locator("#board")
          .screenshot({ path: `.preview/mobile-type-labels-${size}.png` });
    }
  }
});

test("inline row, column and box headers align with cells even with every type missing", async ({
  page,
}) => {
  await page.route("**/puzzles.json", (route) =>
    route.fulfill({
      json: pack.map((base) => ({
        ...base,
        givens: { ...base.givens, hard: [] },
      })),
    }),
  );
  for (const size of [4, 6, 9]) {
    await page.goto(`./?size=${size}&level=hard&seed=free:boardheaders`);
    await expect(page.locator(".board-unit")).toHaveCount(size * 3);
    await expect(page.locator(".compact-type")).toHaveCount(
      size * 3 * size * 2,
    );
    for (const width of [320, 360, 390, 600, 900, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const problems = await page.locator("#board").evaluate((board, size) => {
        const cells = [...board.querySelectorAll(".cell")].map((cell) =>
          cell.getBoundingClientRect(),
        );
        const bounds = board.getBoundingClientRect();
        const issues = [];
        const near = (a, b) => Math.abs(a - b) < 0.6;
        const boxRows = size === 6 ? 2 : Math.sqrt(size),
          boxCols = size / boxRows;
        for (const header of board.querySelectorAll(".board-unit")) {
          const rect = header.getBoundingClientRect();
          const [kind, rawIndex] = header.dataset.unit.split("-"),
            index = Number(rawIndex);
          if (
            rect.left < bounds.left ||
            rect.right > bounds.right ||
            rect.top < bounds.top ||
            rect.bottom > bounds.bottom
          )
            issues.push(`${header.dataset.unit}: outside board`);
          if (
            cells.some(
              (cell) =>
                Math.min(rect.right, cell.right) -
                  Math.max(rect.left, cell.left) >
                  0.5 &&
                Math.min(rect.bottom, cell.bottom) -
                  Math.max(rect.top, cell.top) >
                  0.5,
            )
          )
            issues.push(`${header.dataset.unit}: overlaps a cell`);
          if (
            kind === "row" &&
            (!near(rect.top, cells[index * size].top) ||
              !near(rect.height, cells[index * size].height))
          )
            issues.push(`${header.dataset.unit}: row misaligned`);
          if (
            kind === "column" &&
            (!near(rect.left, cells[index].left) ||
              !near(rect.width, cells[index].width))
          )
            issues.push(`${header.dataset.unit}: column misaligned`);
          if (kind === "box") {
            const first =
              Math.floor(index / (size / boxCols)) * boxRows * size +
              (index % (size / boxCols)) * boxCols;
            if (
              !near(rect.left, cells[first].left) ||
              !near(rect.right, cells[first + boxCols - 1].right) ||
              !near(rect.bottom, cells[first].top)
            )
              issues.push(`${header.dataset.unit}: box misaligned`);
          }
          for (const chip of header.querySelectorAll(".compact-type")) {
            const image = chip.querySelector(".type-icon");
            const glyph = image.getBoundingClientRect();
            if (
              !image.complete ||
              image.naturalWidth <= 0 ||
              glyph.width < 8 ||
              glyph.height < 8 ||
              glyph.left < rect.left ||
              glyph.right > rect.right ||
              glyph.top < rect.top ||
              glyph.bottom > rect.bottom
            )
              issues.push(`${header.dataset.unit}: clipped ${image.alt}`);
          }
        }
        return issues;
      }, size);
      expect(problems, `${size}x${size} at ${width}px`).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 390 || width === 1440)
        await page
          .locator("#board")
          .screenshot({ path: `.preview/inline-headers-${size}-${width}.png` });
    }
  }
});

test("all 18 local type icons render distinct artwork and expose names on hover, focus and touch", async ({
  page,
  browser,
}) => {
  const external = [];
  page.on("request", (request) => {
    if (
      request.url().startsWith("http") &&
      !request.url().startsWith("http://127.0.0.1:")
    )
      external.push(request.url());
  });
  await page.goto("./?size=9&level=hard&seed=free:iconcheck");
  await expect(page.locator("#type-filters .type-icon")).toHaveCount(18);
  const samples = await page
    .locator("#type-filters .type-icon")
    .evaluateAll(async (images) => {
      const result = [];
      for (const image of images) {
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, 32, 32);
        const pixels = context.getImageData(0, 0, 32, 32).data;
        let painted = 0,
          white = 0,
          hash = 2166136261;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] > 200) painted++;
          if (
            pixels[i + 3] > 200 &&
            pixels[i] > 245 &&
            pixels[i + 1] > 245 &&
            pixels[i + 2] > 245
          )
            white++;
          for (let j = 0; j < 4; j++)
            hash = Math.imul(hash ^ pixels[i + j], 16777619);
        }
        result.push({
          id: Number(image.dataset.typeId),
          name: image.alt,
          painted,
          white,
          hash,
        });
      }
      return result;
    });
  expect(samples.map(({ id, name }) => ({ id, name }))).toEqual(
    catalog.types.map((type) => ({ id: type.id, name: `${type.name} 타입` })),
  );
  expect(new Set(samples.map((sample) => sample.hash)).size).toBe(18);
  expect(
    samples.every((sample) => sample.painted > 600 && sample.white > 10),
  ).toBe(true);
  expect(external).toEqual([]);
  await page.locator('#type-filters [data-type-id="10"]').hover();
  await expect(page.locator("#type-tooltip")).toHaveText("불꽃");
  await expect(page.locator("#type-tooltip")).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page.locator("#type-tooltip")).toBeHidden();
  await page.getByRole("button", { name: "물 타입 필터", exact: true }).focus();
  await expect(page.locator("#type-tooltip")).toHaveText("물");
  await page.locator('[data-board-unit="row-0"]').click();
  const detailIcon = page.locator("#dialog-body .type-icon").first();
  const name = await detailIcon.getAttribute("data-type-name");
  await detailIcon.hover();
  await expect(page.locator("#dialog #type-tooltip")).toHaveText(name);
  await expect(page.locator("#dialog #type-tooltip")).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  const mobile = await browser.newContext({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const touchPage = await mobile.newPage();
    await touchPage.goto(
      "http://127.0.0.1:4173/pokemon/?size=9&seed=free:touchicons",
    );
    await touchPage.locator(".cell:not(.given)").first().tap();
    await touchPage.locator('#note-picker [data-type-id="11"]').tap();
    await expect(touchPage.locator('[data-note="11"]')).toBeChecked();
    await expect(touchPage.locator("#type-tooltip")).toHaveText("물");
    await expect(touchPage.locator("#type-tooltip")).toBeVisible();
  } finally {
    await mobile.close();
  }
});

test("desktop: nested Pages path, real sprites, notes, hints, history, save and pause", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./sudoku.html");
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
  await expect(page.locator(`[data-cell="${index}"] .sprite`)).toHaveCount(1);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.locator(`[data-cell="${index}"] .note-dot`)).toHaveCount(1);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await page.reload();
  await expect(page.locator(`[data-cell="${index}"] .sprite`)).toHaveCount(1);
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
  await page.goto("./sudoku.html");
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
