import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./generated-tests/ui",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results/ui",
  timeout: 30_000,
  use: {
    trace: "on",
    video: "on"
  }
});
