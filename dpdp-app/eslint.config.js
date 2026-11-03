// dpdp-app's own ESLint config. The repo root's config deliberately ignores
// dpdp-app/** (this is a separate Vite project with its own toolchain), so
// `bun run lint` here is the only lint that covers these files.
import js from "@eslint/js"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  // functions/_analytics is a byte-for-byte copy of the central visitor collector (site-analytics/src/core.ts, checksum-tested): it is changed at its source, never here.
  globalIgnores(["dist", "functions/_analytics"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
  },
  {
    files: ["scripts/**/*.mjs", "src/**/*.mjs", "vite.config.ts"],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
  },
])
