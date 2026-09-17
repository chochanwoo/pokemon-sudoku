import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const source = new URL("../web/src/assets/alola-resort.png", import.meta.url);
const target = new URL("../web/src/assets/alola-resort.webp", import.meta.url);
const original = readFileSync(source);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const result = await page.evaluate(
    async (data) => {
      const image = new Image();
      image.src = data;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      return canvas.toDataURL("image/webp", 0.88);
    },
    `data:image/png;base64,${original.toString("base64")}`,
  );
  if (!result.startsWith("data:image/webp;base64,"))
    throw new Error("WebP encoding unavailable");
  const compressed = Buffer.from(result.split(",")[1], "base64");
  writeFileSync(target, compressed);
  console.log(
    JSON.stringify({ original: original.length, webp: compressed.length }),
  );
} finally {
  await browser.close();
}
