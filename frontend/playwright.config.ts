import { defineConfig, devices } from "@playwright/test";

// Keycloak advertises the canonical local hostname. Keeping the browser on
// that host also keeps the registration/login cookie same-origin.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://openiotdata.localhost:8080";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Keep the mobile viewport on Chromium so the local prerequisite is one
    // browser binary while still exercising the 375px responsive layout.
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 375, height: 667 } } },
  ],
});
