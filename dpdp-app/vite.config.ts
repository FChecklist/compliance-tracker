import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { HIDDEN_PAGES, PRIVATE_PAGES, PUBLIC_PAGES } from "./src/lib/public-surface.mjs"

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // WO-DPDP-011 §2.1 + WO-DPDP-012 §1: one multi-page build. The public
  // pages (/, /dpdp-firm/, /dpdp-institution/) are complete HTML with no
  // React at all -- readable with JavaScript off -- and the signed-in
  // one-page app is /app/, so robots.txt and _headers can fence it off by
  // prefix. "mpa" switches off the dev server's SPA fallback: an unknown URL
  // 404s locally the same way it will on Cloudflare Pages, instead of
  // quietly serving the app. Every entry comes from public-surface.mjs -- a
  // page not listed there is not built, and one listed cannot be missed.
  // HIDDEN_PAGES (WO-DPDP-013 v2: /proof/ until the owner switches it on)
  // are built too -- "built and hidden", never "not built".
  appType: "mpa",
  resolve: {
    // The onepage/* components and view-model are ported from the Next.js
    // tree byte-for-byte where possible (WO-DPDP-011 §1: port, don't
    // rewrite). Keeping their `@/lib/...` imports resolvable means a future
    // diff against src/app/dpdp on main stays about behaviour, not paths.
    alias: { "@": here("./src") },
  },
  // An inline (empty) PostCSS config stops Vite searching parent directories
  // and picking up the Next.js repo root's postcss.config.mjs, whose plugin
  // isn't installed here. Tailwind runs through @tailwindcss/vite instead.
  css: { postcss: {} },
  build: {
    sourcemap: false,
    rollupOptions: {
      // A private prefix served by a Pages Function (source: null) has no
      // HTML to build; everything else is an entry.
      input: Object.fromEntries(
        [...PUBLIC_PAGES, ...HIDDEN_PAGES, ...PRIVATE_PAGES]
          .filter((p): p is typeof p & { source: string } => p.source !== null)
          .map((p) => [p.source.replace(/\/?index\.html$/, "") || "home", here(p.source)]),
      ),
    },
  },
})
