import { defineConfig, devices } from "@playwright/test";

// The trailing slash matters: specs navigate with paths relative to it (`./#/backfill`).
const baseURL = "http://localhost:4173/eat-the-world/";

export default defineConfig({
  testDir: "tests/solo-e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    ...devices["Pixel 7"],
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "phone", use: { browserName: "chromium" } }],
  // Serves the production build under the subpath GitHub Pages uses, so every spec runs as deployed.
  webServer: {
    command: "npm run solo:build && npm run solo:preview -- --base /eat-the-world/ --port 4173 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
