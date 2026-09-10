import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4173/pokemon/",
    viewport: { width: 1440, height: 1080 },
    headless: true,
  },
  webServer: {
    command: "node scripts/serve_game.mjs --port 4173 --base /pokemon/",
    url: "http://127.0.0.1:4173/pokemon/",
    reuseExistingServer: true,
  },
});
