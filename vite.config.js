import { defineConfig } from "vite";
import { readFile } from "node:fs/promises";

const publicDirectory = new URL("./web/public/", import.meta.url);

export default defineConfig({
  root: "web",
  base: "./",
  build: { outDir: "../docs", emptyOutDir: true, copyPublicDir: false },
  plugins: [{
    name: "portable-game-data",
    apply: "build",
    async generateBundle() {
      const catalog = JSON.parse(await readFile(new URL("catalog.json", publicDirectory), "utf8"));
      // Embed unchanged PNG bytes so browser uploads stay under GitHub's 100-file limit.
      for (const pokemon of catalog.pokemon) {
        const bytes = await readFile(new URL(`sprites/${pokemon.id}.png`, publicDirectory));
        pokemon.image = `data:image/png;base64,${bytes.toString("base64")}`;
      }
      this.emitFile({type:"asset",fileName:"catalog.json",source:JSON.stringify(catalog)});
      for (const fileName of ["puzzles.json", "NOTICE.txt", ".nojekyll"]) {
        this.emitFile({type:"asset",fileName,source:await readFile(new URL(fileName, publicDirectory))});
      }
    },
  }],
});
