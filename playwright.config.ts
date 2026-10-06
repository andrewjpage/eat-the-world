import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    defaultBrowserType: "chromium",
    trace: "retain-on-failure",
  },
  projects: [{ name: "phone", use: { browserName: "chromium" } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run build && npm run start -- -H 127.0.0.1 -p 3000",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 300_000,
      },
});
