import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: { reporter: ["text", "html"], include: ["apps/web/lib/**", "packages/*/src/**"] },
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web"),
      "@compliancetrack/db": path.resolve(__dirname, "packages/db/src"),
      "@compliancetrack/types": path.resolve(__dirname, "packages/types/src"),
      "@compliancetrack/api-client": path.resolve(__dirname, "packages/api-client/src"),
      "@compliancetrack/config": path.resolve(__dirname, "packages/config/src"),
      "@compliancetrack/ui": path.resolve(__dirname, "packages/ui/src"),
    },
  },
});