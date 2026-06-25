import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./generated-tests/api",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results/api",
  timeout: 30_000,
  use: {
    trace: "on"
  }
});
