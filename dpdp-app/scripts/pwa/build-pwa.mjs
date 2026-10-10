// After `vite build`: write dist/app/sw.js (the service-worker template with this build's exact file list and a version) and check that the
// precache list is complete. The list is every /assets/* and /fonts/* file the /app/ page can load, found by walking the built HTML, then
// each JS/CSS file's own references. Run by `bun run build`; also imported by the tests (pure functions below).
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, "..", "..")

const REF = /(?:["'(=]|^)(\/(?:assets|fonts)\/[A-Za-z0-9._/-]+\.(?:js|css|woff2|woff|png|svg|json))/g
const REL = /["'`]\.\/([A-Za-z0-9._-]+\.(?:js|css))["'`]/g

/** Every file the page can load: the HTML's own references, then the references inside each JS/CSS file, until nothing new turns up. */
export function collectPrecache(distDir, entryHtml = "app/index.html") {
  const seen = new Set()
  const todo = []
  const add = (u) => { if (!seen.has(u)) { seen.add(u); todo.push(u) } }
  const html = readFileSync(join(distDir, entryHtml), "utf8")
  for (const m of html.matchAll(REF)) add(m[1])
  while (todo.length) {
    const u = todo.pop()
    const file = join(distDir, u)
    if (!existsSync(file)) throw new Error(`precache: ${u} is referenced but not in the build`)
    if (!/\.(js|css)$/.test(u)) continue
    const text = readFileSync(file, "utf8")
    for (const m of text.matchAll(REF)) add(m[1])
    // Vite chunks import each other by "./name.js" (same folder).
    for (const m of text.matchAll(REL)) add(`${dirname(u).replace(/\\/g, "/")}/${m[1]}`)
  }
  return [...seen].sort()
}

export function renderSw(template, files) {
  const version = createHash("sha256").update(files.join("\n")).update(readFileSync(join(appRoot, "dist", "app", "index.html"))).digest("hex").slice(0, 12)
  if (!template.includes("__VERSION__") || !template.includes("__PRECACHE__")) throw new Error("sw template lost its placeholders")
  return template.replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(files, null, 2))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = join(appRoot, "dist")
  const files = collectPrecache(dist)
  if (files.length < 3) throw new Error(`precache list suspiciously short (${files.length})`)
  writeFileSync(join(dist, "app", "sw.js"), renderSw(readFileSync(join(here, "sw.template.js"), "utf8"), files))
  console.log(`build-pwa: dist/app/sw.js written, ${files.length} files precached`)
}
