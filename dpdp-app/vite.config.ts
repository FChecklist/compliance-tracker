import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // The onepage/* components and view-model are ported from the Next.js
    // tree byte-for-byte where possible (WO-DPDP-011 §1: port, don't
    // rewrite). Keeping their `@/lib/...` imports resolvable means a future
    // diff against src/app/dpdp on main stays about behaviour, not paths.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // An inline (empty) PostCSS config stops Vite searching parent directories
  // and picking up the Next.js repo root's postcss.config.mjs, whose plugin
  // isn't installed here. Tailwind runs through @tailwindcss/vite instead.
  css: { postcss: {} },
  build: { sourcemap: false },
})
