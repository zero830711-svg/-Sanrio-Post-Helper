const { defineConfig, devices } = require("@playwright/test");

const isCI = Boolean(process.env.CI);

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  webServer: isCI
    ? {
        command: "python3 -m http.server 4173 --bind 127.0.0.1",
        url: "http://127.0.0.1:4173/amazon-scout.html",
        reuseExistingServer: false,
        timeout: 30_000
      }
    : undefined,
  use: {
    ...devices["iPhone 13"],
    baseURL: process.env.BASE_URL || (isCI
      ? "http://127.0.0.1:4173"
      : "https://zero830711-svg.github.io/-Sanrio-Post-Helper/"),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  }
});
