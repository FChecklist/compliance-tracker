// Build-time sitemap (WO-DPDP-012 §1: "sitemap.xml (public pages only, with
// real lastmod)"). Writes dist/sitemap.xml -- or <argv[2]>/sitemap.xml --
// listing exactly the pages in src/lib/public-surface.mjs, each with the
// last git commit date of its own source HTML file. Run after `vite build`
// and before scripts/check-public-surface.mjs (the `build` script does).
//
// Why git and not the file's mtime: a fresh checkout gives every file the
// same mtime (checkout time), which would tell crawlers every page changed
// on every deploy. The commit date is the real "last changed".
import { execFileSync } from "node:child_process"
import { existsSync, statSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PUBLIC_PAGES, renderSitemap } from "../src/lib/public-surface.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const outDir = process.argv[2] ? resolve(process.argv[2]) : resolve(root, "dist")

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

if (!existsSync(outDir)) {
  console.error(`build-sitemap: ${outDir} not found -- run \`vite build\` first`)
  process.exit(2)
}

// A shallow clone (some hosted builders fetch depth 1) has only the fetched
// commit, so `git log -1 -- file` returns that one date for every file.
// Still a valid sitemap, just a less useful lastmod -- say so rather than
// let it pass for a real per-page date.
let shallow = false
try {
  shallow = git("rev-parse", "--is-shallow-repository") === "true"
} catch {
  // not a git checkout at all -- handled per page below
}
if (shallow) console.warn("build-sitemap: WARNING shallow clone -- every lastmod is the fetched commit's date, not each page's own last change")

const entries = PUBLIC_PAGES.map((page) => {
  let lastmod = ""
  try {
    lastmod = git("log", "-1", "--format=%cI", "--", page.source)
  } catch {
    // no git: fall through to the mtime fallback
  }
  if (!lastmod) {
    // Not committed yet (the first local build of a new page), or no git at
    // all: the file's own mtime, loudly, so it is never mistaken for a
    // commit date in a real deploy.
    lastmod = statSync(resolve(root, page.source)).mtime.toISOString().replace(/\.\d{3}Z$/, "Z")
    console.warn(`build-sitemap: WARNING ${page.source} has no commit yet -- using its mtime ${lastmod} for lastmod`)
  }
  return { path: page.path, lastmod }
})

const xml = renderSitemap(entries)
writeFileSync(resolve(outDir, "sitemap.xml"), xml)
for (const e of entries) console.log(`build-sitemap: ${e.path}  lastmod ${e.lastmod}`)
console.log(`build-sitemap: wrote ${resolve(outDir, "sitemap.xml")} (${entries.length} public pages)`)
