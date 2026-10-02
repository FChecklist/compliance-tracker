// LIVE probe of the release registry (0680): builds a REAL release manifest with the laptop app's own builder (projexa scripts/make-release.mjs, on a tiny
// fixture tree), then registers it on the live database inside a transaction that ends in a deliberate exception, so NOTHING is left behind:
//   register -> current -> the same manifest again is idempotent -> a tampered manifest is refused -> an install is recorded -> min_compatible works.
//   node scripts/verify/projexa-live-release-probe.mjs [path to the projexa checkout, default C:/ct/projexa]
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"

const PROJEXA = process.argv[2] || "C:/ct/projexa"
const FIX = join(tmpdir(), "px-release-fixture")
rmSync(FIX, { recursive: true, force: true })
mkdirSync(join(FIX, ".next", "static", "chunks"), { recursive: true })
mkdirSync(join(FIX, "public"), { recursive: true })
writeFileSync(join(FIX, ".next", "static", "chunks", "app.js"), "console.log('px live probe 1');\n")
writeFileSync(join(FIX, ".next", "static", "chunks", "app.css"), "body{margin:0}\n")
// the builder reads the local database version from the laptop app's own source file
mkdirSync(join(FIX, "src", "lib", "local-first"), { recursive: true })
copyFileSync(join(PROJEXA, "src", "lib", "local-first", "local-db.ts"), join(FIX, "src", "lib", "local-first", "local-db.ts"))
writeFileSync(join(FIX, "public", "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>\n")
execFileSync(process.execPath, [join(PROJEXA, "scripts", "make-release.mjs"), "--root", FIX], { env: { ...process.env, BUILD_NUMBER: "9999", GITHUB_SHA: "0000000000000000000000000000000000livecheck" }, stdio: "pipe" })
const manifestPath = join(FIX, "public", "_release", "release.json")
if (!existsSync(manifestPath)) throw new Error("make-release.mjs wrote no release.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
console.log(`manifest built: version ${manifest.release_version}, ${manifest.files?.length} files, protocol ${manifest.protocol}, keys: ${Object.keys(manifest).join(",")}`)

const lit = (o) => `$m$${JSON.stringify(o)}$m$::jsonb`
const tampered = { ...manifest, files: manifest.files.map((f, i) => (i === 0 ? { ...f, sha256: "0".repeat(64) } : f)) }
const sql = `DO $p$
DECLARE
  A constant text := '4ecc472f-4152-4310-ae8d-cf8b7c52ab6d';
  s_mem text; r jsonb := '{}'::jsonb; x jsonb;
BEGIN
  SELECT auth_user_id::text INTO s_mem FROM compliance.users WHERE org_id = A AND role = 'member' AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  r := r || jsonb_build_object('before', public.projexa_release_current());
  BEGIN r := r || jsonb_build_object('register', public.projexa_release_register(${lit(manifest)})); EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('register_error', SQLERRM); END;
  r := r || jsonb_build_object('current', public.projexa_release_current());
  BEGIN r := r || jsonb_build_object('register_again', public.projexa_release_register(${lit(manifest)})); EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('register_again_error', SQLERRM); END;
  BEGIN r := r || jsonb_build_object('register_tampered', public.projexa_release_register(${lit(tampered)})); EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('register_tampered_error', SQLERRM); END;
  BEGIN
    r := r || jsonb_build_object('install', public.projexa_install_record(s_mem, NULL, 'live-laptop-0001', ${JSON.stringify(manifest.release_version).replace(/"/g, "'")}, ${JSON.stringify(manifest.manifest_sha256).replace(/"/g, "'")}, NULL, now() - interval '10 seconds', now(), ${manifest.files.length}, 1234::bigint, 'installed', NULL));
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('install_error', SQLERRM); END;
  BEGIN r := r || jsonb_build_object('min_compat', public.projexa_release_set_min_compatible(${JSON.stringify(manifest.release_version).replace(/"/g, "'")})); EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('min_compat_error', SQLERRM); END;
  r := r || jsonb_build_object('after_min', public.projexa_release_current());
  RAISE EXCEPTION 'PROBE_RESULT %', r::text;
END
$p$;
`
const out = join(tmpdir(), "px-live-release-probe.sql")
writeFileSync(out, sql)
const res = execFileSync(process.execPath, [join(import.meta.dirname, "sql", "run-probe.mjs"), out], { encoding: "utf8" })
console.log(res)
