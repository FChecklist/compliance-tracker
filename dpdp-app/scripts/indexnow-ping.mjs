// Tells Bing, Yandex and the other IndexNow search engines that the public pages changed (IndexNow,
// https://www.indexnow.org/documentation). Free, no account: ownership is proved by the key file
// served at https://veridian-aios.com/<key>.txt (public/<key>.txt; the key is meant to be public).
//
// Run after a deploy: `node scripts/indexnow-ping.mjs` (reads dist/sitemap.xml for the URL list).
// Best effort by design -- a failed ping prints a warning and exits 0, it never fails a deploy.
// Google does not use IndexNow; for Google submit the sitemap in Search Console (see OPERATIONS.md).
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HOST = "veridian-aios.com"
const root = fileURLToPath(new URL("../", import.meta.url))
const dist = process.argv[2] ? resolve(process.argv[2]) : join(root, "dist")

// The key is the name of the one <32 hex>.txt file in public/ (and its body), so nothing here repeats it.
const keyFiles = readdirSync(join(root, "public")).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f))
if (keyFiles.length !== 1) {
  console.warn(`indexnow-ping: expected exactly one IndexNow key file in public/, found ${keyFiles.length} -- nothing submitted`)
  process.exit(0)
}
const INDEXNOW_KEY = keyFiles[0].replace(/\.txt$/, "")

const sitemap = join(dist, "sitemap.xml")
if (!existsSync(sitemap)) {
  console.warn("indexnow-ping: dist/sitemap.xml not found -- nothing to submit")
  process.exit(0)
}
const urls = [...readFileSync(sitemap, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => new URL(u).host === HOST)
if (!urls.length) {
  console.warn("indexnow-ping: the sitemap lists no veridian-aios.com URL -- nothing to submit")
  process.exit(0)
}
try {
  const res = await fetch("https://api.indexnow.org/IndexNow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: INDEXNOW_KEY, keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`, urlList: urls }),
    signal: AbortSignal.timeout(20000),
  })
  // 200 accepted; 202 accepted, key validation pending; 4xx the key file or URL list was refused.
  console.log(`indexnow-ping: submitted ${urls.length} URL(s), HTTP ${res.status}${res.status >= 400 ? " (not accepted -- check that the key file is live)" : ""}`)
} catch (e) {
  console.warn(`indexnow-ping: could not reach api.indexnow.org (${e instanceof Error ? e.message : e}) -- ignored`)
}
