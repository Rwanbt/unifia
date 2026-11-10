// SPDX-License-Identifier: MIT
import { defineConfig, devices } from "@playwright/test"

// Isolated config for security assertions that need a real DOM but not the app.
//
// The sanitisation policy cannot be tested under happy-dom: DOMPurify walks the
// parsed tree and removes nodes, and happy-dom 20.x does not reproduce that
// removal reliably (see docs/security/MARKDOWN-SANITIZE-COVERAGE.md). Chromium is
// the only engine that runs the same code path the shipped Tauri/WebView and
// browser clients run, so these specs use it directly and skip the app's
// webServer entirely -- they only need `page.setContent` plus DOMPurify's UMD
// bundle.
export default defineConfig({
  testDir: "./security",
  outputDir: "./security/.results",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["junit", { outputFile: "security/.results/junit.xml" }]] : [["line"]],
  use: {
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
