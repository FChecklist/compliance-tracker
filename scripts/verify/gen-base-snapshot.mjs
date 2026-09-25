#!/usr/bin/env node
// PROJEXA-BUILD-001 phase 2 (U-17, BR-207): write the base snapshot a PGlite rollback replay starts from.
//
// A snapshot holds ONLY the tables one migration touches, read from the live catalog with read-only queries, so the
// replay (scripts/verify/rollback-replay.sh) needs neither a paid Supabase branch (PMD-10) nor the whole schema, which
// drizzle/ cannot rebuild from empty (scripts/replay-migrations-from-empty.mjs, E-103).
//
// Usage:
//   node scripts/verify/gen-base-snapshot.mjs --tables <schema.table>[,<schema.table>...] [--function <schema.name>]...
//        [--out scripts/verify/fixtures/<migration name>.base.sql]
//   Without --out the snapshot goes to stdout. --function may repeat; it adds every overload of that function (for
//   example compliance.current_org_id, which most compliance policies call).
// Connection (never printed): VERIFY_DATABASE_URL, the same variable scripts/verify/sql-assert.mjs reads. Every query is
// a SELECT on pg_catalog inside a READ ONLY transaction with an 8 second statement timeout; search_path is pg_catalog for
// that transaction only, so every name in the output is schema-qualified. Catalog reads are exact for any role that can
// connect (app_runtime included): no information_schema view, which would hide objects the role holds no privilege on.
//
// What a snapshot holds, in load order: SET check_function_bodies = off; CREATE SCHEMA IF NOT EXISTS for every schema
// used; the enum types the columns use; sequences named in column defaults; the --function definitions; CREATE TABLE
// (types, NOT NULL, defaults, identity and generated columns); primary key, unique, check and exclusion constraints;
// foreign keys whose target table is in the snapshot; the other indexes; RLS and FORCE RLS flags; policies; table grants;
// RESET check_function_bodies.
// What it leaves out, each with a comment line in the output where it applies: foreign keys to tables outside the
// snapshot (name the target table too if the migration touches that key), policies and grants naming a role the PGlite
// baseline does not create (it creates anon, authenticated, service_role, authenticator, app_runtime), triggers,
// column-level grants, comments, partitioning (a partitioned table is refused), domain and composite column types
// (refused), rows (a snapshot is schema only).
//
// Regenerate a snapshot when the live table changed after it was written: run the same command again and commit the
// result together with the migration it belongs to. The first line of the output records the command and the time.
import { writeFileSync } from "node:fs"
import postgres from "postgres"

const KNOWN_ROLES = new Set(["postgres", "anon", "authenticated", "service_role", "authenticator", "app_runtime", "public"])
const CMD = { "*": "ALL", r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE" }
const PRIV_ORDER = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]

const qi = (s) => (/^[a-z_][a-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`)
const ql = (s) => `'${String(s).replace(/'/g, "''")}'`
const qname = (schema, name) => `${qi(schema)}.${qi(name)}`

function parseArgs(argv) {
  const out = { tables: [], functions: [], out: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const v = argv[i + 1]
    if (a === "--tables" && v) { out.tables.push(...v.split(",").map((s) => s.trim()).filter(Boolean)); i++ }
    else if (a === "--function" && v) { out.functions.push(v.trim()); i++ }
    else if (a === "--out" && v) { out.out = v; i++ }
    else throw new Error(`unknown or incomplete argument: ${a}`)
  }
  const split = (s) => {
    const m = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/.exec(s)
    if (!m) throw new Error(`expected schema.name, got '${s}'`)
    return { schema: m[1], name: m[2] }
  }
  if (out.tables.length === 0) throw new Error("--tables is required")
  return { tables: out.tables.map(split), functions: out.functions.map(split), out: out.out }
}

async function build(tx, args) {
  const lines = []
  const skipped = []
  const schemas = new Set()
  const tables = []
  for (const t of args.tables) {
    const rows = await tx`
      select c.oid::text as oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${t.schema} and c.relname = ${t.name}`
    if (rows.length !== 1) throw new Error(`table ${t.schema}.${t.name} not found`)
    if (rows[0].relkind !== "r") throw new Error(`${t.schema}.${t.name} has relkind '${rows[0].relkind}'; only plain tables are supported`)
    tables.push({ ...t, ...rows[0] })
    schemas.add(t.schema)
  }
  const oids = tables.map((t) => t.oid)

  // columns and the types they need
  const enums = new Map()
  const sequences = new Set()
  for (const t of tables) {
    t.columns = await tx`
      select a.attname, format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull, a.attidentity, a.attgenerated,
             pg_get_expr(d.adbin, d.adrelid) as def,
             coalesce(nullif(et.typtype, ''), t.typtype) as kind, coalesce(et.oid, t.oid)::text as base_oid,
             coalesce(etn.nspname, tn.nspname) as base_ns, coalesce(et.typname, t.typname) as base_name
      from pg_attribute a
      join pg_type t on t.oid = a.atttypid join pg_namespace tn on tn.oid = t.typnamespace
      left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
      left join pg_namespace etn on etn.oid = et.typnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = ${t.oid}::oid and a.attnum > 0 and not a.attisdropped
      order by a.attnum`
    for (const c of t.columns) {
      if (c.kind === "e") enums.set(c.base_oid, { schema: c.base_ns, name: c.base_name })
      else if (c.kind === "d" || c.kind === "c") throw new Error(`${t.schema}.${t.name}.${c.attname} has ${c.kind === "d" ? "domain" : "composite"} type ${c.typ}; write that type into the snapshot by hand`)
      else if (c.base_ns !== "pg_catalog" && !(c.base_ns === "extensions" && c.base_name === "vector")) {
        throw new Error(`${t.schema}.${t.name}.${c.attname} has type ${c.typ} from schema ${c.base_ns}; write that type into the snapshot by hand`)
      }
      if (c.def) for (const m of c.def.matchAll(/nextval\('([^']+)'::regclass\)/g)) sequences.add(m[1])
    }
  }
  for (const e of enums.values()) schemas.add(e.schema)

  const functions = []
  for (const f of args.functions) {
    const rows = await tx`
      select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = ${f.schema} and p.proname = ${f.name} and p.prokind in ('f', 'p') order by p.oid`
    if (rows.length === 0) throw new Error(`function ${f.schema}.${f.name} not found`)
    for (const r of rows) functions.push(r.def.trim())
    schemas.add(f.schema)
  }
  for (const s of sequences) {
    const m = /^(?:"?([^".]+)"?\.)?"?([^".]+)"?$/.exec(s)
    if (m && m[1]) schemas.add(m[1])
  }

  lines.push("SET check_function_bodies = off;")
  for (const s of [...schemas].sort()) lines.push(`CREATE SCHEMA IF NOT EXISTS ${qi(s)};`)
  for (const [oid, e] of enums) {
    const labels = await tx`select enumlabel from pg_enum where enumtypid = ${oid}::oid order by enumsortorder`
    lines.push(`CREATE TYPE ${qname(e.schema, e.name)} AS ENUM (${labels.map((l) => ql(l.enumlabel)).join(", ")});`)
  }
  for (const s of [...sequences].sort()) lines.push(`CREATE SEQUENCE IF NOT EXISTS ${s};`)
  for (const f of functions) lines.push(`${f};`)

  for (const t of tables) {
    const cols = t.columns.map((c) => {
      const typ = c.base_ns === "extensions" && c.base_name === "vector" ? c.typ.replace(/^extensions\./, "") : c.typ
      let s = `  ${qi(c.attname)} ${typ}`
      if (c.attgenerated === "s") s += ` GENERATED ALWAYS AS (${c.def}) STORED`
      else if (c.attidentity === "a") s += " GENERATED ALWAYS AS IDENTITY"
      else if (c.attidentity === "d") s += " GENERATED BY DEFAULT AS IDENTITY"
      else if (c.def) s += ` DEFAULT ${c.def}`
      if (c.attnotnull) s += " NOT NULL"
      return s
    })
    lines.push(`CREATE TABLE ${qname(t.schema, t.name)} (\n${cols.join(",\n")}\n);`)
  }

  const cons = await tx`
    select k.conname, k.contype, pg_get_constraintdef(k.oid) as def, k.conrelid::text as rel, k.confrelid::text as ref,
           k.confrelid::regclass::text as ref_name
    from pg_constraint k where k.conrelid = any(${oids}::oid[]) and k.contype in ('p', 'u', 'c', 'x', 'f')
    order by k.conrelid, k.contype, k.conname`
  const byOid = new Map(tables.map((t) => [t.oid, t]))
  for (const kind of ["p", "u", "c", "x", "f"]) {
    for (const k of cons.filter((c) => c.contype === kind)) {
      const t = byOid.get(k.rel)
      if (kind === "f" && !byOid.has(k.ref)) { skipped.push(`foreign key ${k.conname} on ${t.schema}.${t.name} references ${k.ref_name}, not in the snapshot`); continue }
      lines.push(`ALTER TABLE ${qname(t.schema, t.name)} ADD CONSTRAINT ${qi(k.conname)} ${k.def};`)
    }
  }

  const idx = await tx`
    select pg_get_indexdef(i.indexrelid) as def from pg_index i
    where i.indrelid = any(${oids}::oid[])
      and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid and k.conrelid = i.indrelid and k.contype in ('p', 'u', 'x'))
    order by i.indrelid, i.indexrelid::regclass::text`
  for (const r of idx) lines.push(`${r.def};`)

  for (const t of tables) {
    if (t.relrowsecurity) lines.push(`ALTER TABLE ${qname(t.schema, t.name)} ENABLE ROW LEVEL SECURITY;`)
    if (t.relforcerowsecurity) lines.push(`ALTER TABLE ${qname(t.schema, t.name)} FORCE ROW LEVEL SECURITY;`)
  }

  const pols = await tx`
    select p.polrelid::text as rel, p.polname, p.polpermissive, p.polcmd::text as cmd,
           array(select case when r = 0 then 'public' else pg_get_userbyid(r) end from unnest(p.polroles) r order by 1) as roles,
           pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as wc
    from pg_policy p where p.polrelid = any(${oids}::oid[]) order by p.polrelid, p.polname`
  for (const p of pols) {
    const t = byOid.get(p.rel)
    const unknown = p.roles.filter((r) => !KNOWN_ROLES.has(r))
    if (unknown.length) { skipped.push(`policy ${p.polname} on ${t.schema}.${t.name} names role(s) ${unknown.join(", ")} that the PGlite baseline does not create`); continue }
    let s = `CREATE POLICY ${qi(p.polname)} ON ${qname(t.schema, t.name)} AS ${p.polpermissive ? "PERMISSIVE" : "RESTRICTIVE"} FOR ${CMD[p.cmd]} TO ${p.roles.map((r) => (r === "public" ? "PUBLIC" : qi(r))).join(", ")}`
    if (p.qual) s += ` USING (${p.qual})`
    if (p.wc) s += ` WITH CHECK (${p.wc})`
    lines.push(`${s};`)
  }

  const grants = await tx`
    select c.oid::text as rel, case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end as grantee,
           a.privilege_type, a.is_grantable
    from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.oid = any(${oids}::oid[]) order by 1, 2, 3`
  for (const g of grants) {
    const t = byOid.get(g.rel)
    if (g.grantee === t.owner) continue
    if (!KNOWN_ROLES.has(g.grantee)) { skipped.push(`grant ${g.privilege_type} on ${t.schema}.${t.name} to ${g.grantee} (role not in the PGlite baseline)`); continue }
    if (!PRIV_ORDER.includes(g.privilege_type)) continue
    lines.push(`GRANT ${g.privilege_type} ON TABLE ${qname(t.schema, t.name)} TO ${g.grantee === "public" ? "PUBLIC" : qi(g.grantee)}${g.is_grantable ? " WITH GRANT OPTION" : ""};`)
  }
  lines.push("RESET check_function_bodies;")
  return { lines, skipped }
}

async function main() {
  let args
  try { args = parseArgs(process.argv.slice(2)) } catch (e) { console.error(`usage error: ${e.message}`); return 2 }
  const url = process.env.VERIFY_DATABASE_URL
  if (!url) { console.error("cannot run: VERIFY_DATABASE_URL is not set"); return 3 }
  const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 15 })
  try {
    const { lines, skipped } = await sql.begin("read only", async (tx) => {
      await tx`set local statement_timeout = 8000`
      await tx`set local search_path = pg_catalog`
      return build(tx, args)
    })
    const cmd = `node scripts/verify/gen-base-snapshot.mjs --tables ${args.tables.map((t) => `${t.schema}.${t.name}`).join(",")}` +
      args.functions.map((f) => ` --function ${f.schema}.${f.name}`).join("")
    const header = [
      `-- Base snapshot for the PGlite rollback replay (BR-207). Generated ${new Date().toISOString().replace(/\.\d+Z$/, "Z")} by:`,
      `--   ${cmd}`,
      "-- Schema only, read from the live catalog (pcrjmlpuqsbocqfwoxod). Regenerate with the same command; do not edit by hand",
      "-- except to add an object the generator leaves out (see the generator's header).",
      ...skipped.map((s) => `-- left out: ${s}`),
    ]
    const text = `${header.join("\n")}\n${lines.join("\n")}\n`
    if (args.out) { writeFileSync(args.out, text, { encoding: "utf8" }); console.error(`wrote ${args.out} (${lines.length} statements, ${skipped.length} left out)`) }
    else process.stdout.write(text)
    return 0
  } catch (e) {
    console.error(`error: ${String(e && e.message ? e.message : e).split("\n")[0]}`)
    return 4
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().then((code) => { process.exitCode = code })
