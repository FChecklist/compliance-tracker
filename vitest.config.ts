import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: { reporter: ["text","html"], include: ["apps/web/lib/**","packages/*/src/**"] },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web"),
      "@compliance/db": path.resolve(__dirname, "packages/db/src"),
      "@compliance/types": path.resolve(__dirname, "packages/types/src"),
    },
  },
});