import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { chromium } from "@playwright/test";

// Resize and encode only; scene composition stays in home-art.js and CSS.
const inputs = process.argv.slice(2);
if (!inputs.length) throw new Error("Pass the generated background PNG paths in game order.");
const ids = ["pokemantle", "scratch", "pokeclue", "highlow", "typedoku", "pokinator"];
if (inputs.length !== ids.length) throw new Error("Exactly six backgrounds are required.");
const out = resolve("web/src/assets/home-art");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const jobs = inputs.map((path, i) => ({ path, name: ids[i], width: 800, quality: 0.78 }));
  for (const [id, name] of [[25, "pikachu"], [64, "kadabra"], [133, "eevee"],
    [134, "vaporeon"], [135, "jolteon"], [722, "rowlet"],
    [727, "incineroar"], [745, "lycanroc"]]) {
    jobs.push({ path: `.preview/cover-artwork/${id}.png`, name, width: 384, quality: 0.86 });
  }
  for (const { path, name, width, quality } of jobs) {
    const source = `data:image/png;base64,${readFileSync(path).toString("base64")}`;
    const result = await page.evaluate(async ({ source, width, quality }) => {
      const img = new Image();
      img.src = source;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round(width * img.naturalHeight / img.naturalWidth);
      const context = canvas.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", quality);
    }, { source, width, quality });
    const bytes = Buffer.from(result.split(",")[1], "base64");
    writeFileSync(resolve(out, `${name}.webp`), bytes);
    console.log(`${basename(path)} -> ${name}.webp (${bytes.length} bytes)`);
  }
} finally {
  await browser.close();
}
