#!/usr/bin/env node
// Writes the home page's generated region (src/lib/home-copy.mjs -> index.html, between the "generated: home-firm-first" markers).
//   node scripts/generate-home.mjs           rewrite index.html
//   node scripts/generate-home.mjs --check   exit 1 if index.html differs (runs inside `bun run build`)
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { applyHome } from "../src/lib/home-copy.mjs"

const file = fileURLToPath(new URL("../index.html", import.meta.url))
const current = readFileSync(file, "utf8")
const next = applyHome(current)
if (process.argv.includes("--check")) {
  if (next !== current) {
    console.error("index.html is out of date with src/lib/home-copy.mjs. Run: node scripts/generate-home.mjs")
    process.exit(1)
  }
  console.log("index.html: home-firm-first block is up to date")
} else {
  writeFileSync(file, next)
  console.log("index.html: home-firm-first block written")
}
