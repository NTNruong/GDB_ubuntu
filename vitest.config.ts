import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // bcryptjs is pure-JS; auth/userStore suites chain several cost-12 hashes
    // that contend across parallel workers, so the default 5s is too tight.
    testTimeout: 20_000,
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts"
    ],
    exclude: [
      "node_modules",
      "dist",
      "tests/e2e/**"
    ]
  }
});
