import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one database, so files must not run in parallel.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
