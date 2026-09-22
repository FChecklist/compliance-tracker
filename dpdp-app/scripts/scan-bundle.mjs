// Post-build proof that nothing privileged shipped: `service_role` must
// never appear in dist/ (that key would let any visitor bypass RLS), and the
// count of `eyJ` (the JWT prefix) is reported so a reviewer can confirm it
// equals the anon key's own occurrences and nothing more.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const dist = fileURLToPath(new URL("../dist/", import.meta.url))

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

function count(haystack, needle) {
  let n = 0
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++
  return n
}

let files
try {
  files = walk(dist)
} catch {
  console.error("scan-bundle: dist/ not found -- run `bun run build` first")
  process.exit(2)
}

let serviceRole = 0
let jwtPrefix = 0
let bytes = 0
for (const f of files) {
  const buf = readFileSync(f)
  bytes += buf.length
  const text = buf.toString("utf8")
  const sr = count(text, "service_role")
  const jwt = count(text, "eyJ")
  if (sr || jwt) console.log(`${relative(dist, f)}: service_role=${sr} eyJ=${jwt}`)
  serviceRole += sr
  jwtPrefix += jwt
}

console.log(`scan-bundle: ${files.length} files, ${(bytes / 1024).toFixed(1)} KiB total`)
console.log(`scan-bundle: service_role occurrences = ${serviceRole} (must be 0)`)
console.log(`scan-bundle: eyJ occurrences = ${jwtPrefix} (expect exactly the anon key's own; 0 when built without VITE_SUPABASE_ANON_KEY)`)

if (serviceRole > 0) {
  console.error("scan-bundle: FAIL -- service_role found in the client bundle")
  process.exit(1)
}
console.log("scan-bundle: OK")
