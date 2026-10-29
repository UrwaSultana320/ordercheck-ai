import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: {
    command: process.platform === "win32" ? "npm.cmd run dev" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
