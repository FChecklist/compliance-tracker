// The loader for data/veridian-facts.yaml, data/claims-register.yaml and
// data/proof.yaml (WO-DPDP-013 v2 §0 rule 4, WO-DPDP-014 §1): the ONE place
// the three YAML files are read and validated, so scripts/
// generate-public-facts.mjs, scripts/check-claims.mjs,
// scripts/check-two-doors.mjs, src/lib/public-surface.mjs, vite.config.ts and
// the bun tests all see the same, already-checked object.
//
// Plain ESM (.mjs), like public-surface.mjs, because the scripts run under
// plain `node`. The sibling .d.mts carries the types.
//
// Validation is deliberately strict and throws: a facts file that does not
// carry the owner-approved text, or names a public field that does not
// exist, or claims `owner_approved` for a block that has no owner text,
// must stop the build rather than generate a page that says something else.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

export const APP_DIR = fileURLToPath(new URL("../../", import.meta.url))
export const DATA_DIR = join(APP_DIR, "data")
export const FACTS_FILE = "veridian-facts.yaml"
export const CLAIMS_FILE = "claims-register.yaml"
export const PROOF_FILE = "proof.yaml"

const readYaml = (name) => parse(readFileSync(join(DATA_DIR, name), "utf8"))

const isStr = (v) => typeof v === "string" && v.trim().length > 0
const isStrList = (v) => Array.isArray(v) && v.length > 0 && v.every(isStr)

function need(cond, msg) {
  if (!cond) throw new Error(`${FACTS_FILE}: ${msg}`)
}

/** Read a dotted path ("storage.database.sentence") from an object. */
export function getPath(obj, path) {
  let cur = obj
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(key in cur)) return undefined
    cur = cur[key]
  }
  return cur
}

function setPath(obj, path, value) {
  const keys = path.split(".")
  let cur = obj
  for (const key of keys.slice(0, -1)) {
    if (!(key in cur)) cur[key] = {}
    cur = cur[key]
  }
  cur[keys[keys.length - 1]] = value
}

// The public pages the facts file must name (titles, audiences). The list
// of what is PUBLIC lives in public-surface.mjs; this only says which paths
// need a `pages` entry.
export const FACT_PAGE_PATHS = ["/", "/dpdp-firm/", "/dpdp-institution/", "/about/", "/for-ai/", "/proof/"]

/**
 * Load and validate data/veridian-facts.yaml. Adds two derived values that
 * are never typed by hand: `library.job_count` (counted from the library
 * export the facts file names) and `brand_line` (= brand.full, the public
 * field WO-014 §4 asks for on the fact surfaces).
 */
export function loadFacts() {
  const f = readYaml(FACTS_FILE)
  need(f && typeof f === "object", "not a mapping")
  need(f.version === 1, "version must be 1")
  need(f.owner_approved === true, "owner_approved must be true (the §2.2 / §1.3-A / WO-014 §1 text is owner text)")
  need(/^\d{4}-\d{2}-\d{2}$/.test(String(f.approved_on)), "approved_on must be YYYY-MM-DD")
  need(isStr(f.approved_by), "approved_by missing")
  need(isStr(f.product) && isStr(f.site) && isStr(f.company_site), "product/site/company_site missing")
  need(f.site === "https://app.veridian-aios.com", "site must be https://app.veridian-aios.com")

  for (const key of ["one_line", "who_for_line", "what_it_does", "deadline_line", "what_it_does_not_do", "ai_work_link_public_sentence"]) {
    need(isStr(f[key]), `${key} missing`)
  }
  need(isStrList(f.who_for), "who_for must be a non-empty list of strings")
  need(isStrList(f.three_strongest_facts) && f.three_strongest_facts.length === 3, "three_strongest_facts must be exactly three sentences")
  need(isStrList(f.about_this_system) && f.about_this_system.length === 5, "about_this_system must be the five §1.3-A paragraphs")

  need(f.brand && isStr(f.brand.full) && isStr(f.brand.short) && isStr(f.brand.share_ask) && isStr(f.brand.share_url) && isStr(f.brand.title_prefix), "brand.full/short/share_ask/share_url/title_prefix missing")
  need(f.brand.share_url === "https://veridian-aios.com/", "brand.share_url must be the public website, https://veridian-aios.com/ (WO-014 §3)")
  need(f.brand.full.startsWith(f.brand.title_prefix) && f.brand.short.startsWith(f.brand.title_prefix), "brand.title_prefix must be the start of both lines")

  need(f.key_dates && Array.isArray(f.key_dates.items) && f.key_dates.items.length > 0, "key_dates.items missing")
  for (const d of f.key_dates.items) need(/^\d{4}-\d{2}-\d{2}$/.test(String(d.date)) && isStr(d.label) && isStr(d.what), "each key_dates item needs date/label/what")

  need(f.library && isStr(f.library.version) && isStr(f.library.file), "library.version/file missing")
  need(f.library.reviewer === null || isStr(f.library.reviewer), "library.reviewer must be a string or null")
  need(f.library.reviewed_on === null || /^\d{4}-\d{2}-\d{2}$/.test(String(f.library.reviewed_on)), "library.reviewed_on must be YYYY-MM-DD or null")
  const lib = JSON.parse(readFileSync(join(DATA_DIR, f.library.file), "utf8"))
  need(lib.version === f.library.version, `library.version (${f.library.version}) does not match ${f.library.file} (${lib.version})`)
  need(Array.isArray(lib.templates) && lib.templates.length > 0, `${f.library.file} has no templates`)
  need(lib.templates.every((t) => Array.isArray(t.law_codes) && t.law_codes.length > 0), `${f.library.file}: every template must carry law_codes ("Every job is mapped to its legal source")`)

  need(f.storage && f.storage.database && f.storage.email && f.storage.website, "storage.database/email/website missing")
  for (const k of ["database", "email", "website"]) need(isStr(f.storage[k].sentence), `storage.${k}.sentence missing`)
  need(f.storage.database.country === "India", "storage.database.country must be India (verified: Supabase ap-south-1, Mumbai)")
  need(f.storage.email.provider === "Resend" && f.storage.email.provider_country === "United States", "storage.email must be Resend, United States (verified)")
  need(isStr(f.storage.stored_in_india_wording), "storage.stored_in_india_wording missing")

  need(f.company && typeof f.company === "object", "company block missing")
  for (const k of ["legal_name", "cin", "registered_office", "gstin"]) need(k in f.company, `company.${k} must be present (a string or null)`)
  for (const k of ["legal_name", "cin", "registered_office", "gstin"]) need(f.company[k] === null || isStr(f.company[k]), `company.${k} must be a string or null`)
  need(f.company.owner_required === true || Object.values(f.company).every((v) => v !== null), "company.owner_required must be true while any company field is null")

  need(f.contact && isStr(f.contact.grievance_officer_email) && isStr(f.contact.partners_email), "contact emails missing")

  need(f.pages && typeof f.pages === "object", "pages block missing")
  for (const p of FACT_PAGE_PATHS) {
    need(f.pages[p] && isStr(f.pages[p].name) && isStr(f.pages[p].summary) && isStr(f.pages[p].audience), `pages["${p}"] needs name/summary/audience`)
  }

  need(f.proof && typeof f.proof.enabled === "boolean" && f.proof.content === `data/${PROOF_FILE}`, `proof.enabled (boolean) and proof.content (data/${PROOF_FILE}) missing`)

  // Derived, never typed.
  f.library.job_count = lib.templates.length
  f.brand_line = f.brand.full

  need(isStrList(f.public_fields), "public_fields must be a non-empty list of dotted paths")
  for (const path of f.public_fields) need(getPath(f, path) !== undefined, `public_fields names "${path}", which does not exist`)
  const forbiddenPublic = ["about_this_system", "company.gstin", "brand.share_url", "storage.database.source", "storage.email.source", "company.source", "library.file"]
  for (const path of forbiddenPublic) need(!f.public_fields.includes(path), `public_fields must not include "${path}"`)

  return f
}

/** The public view of the facts: exactly the dotted paths in public_fields
 * (WO-013 §2.1 "public fields only"), as a nested object, null values
 * dropped (a null is "not yet recorded", never a fact to publish). */
export function publicFacts(facts) {
  const out = {}
  for (const path of facts.public_fields) {
    const v = getPath(facts, path)
    if (v === null || v === undefined) continue
    setPath(out, path, v)
  }
  return out
}

/** "<title_prefix> — <page name>" (WO-014 §4). */
export function pageTitle(facts, path) {
  const page = facts.pages[path]
  if (!page) throw new Error(`${FACTS_FILE}: no pages entry for ${path}`)
  return `${facts.brand.title_prefix} — ${page.name}`
}

/** Load and validate data/claims-register.yaml. */
export function loadClaims() {
  const c = readYaml(CLAIMS_FILE)
  const fail = (m) => {
    throw new Error(`${CLAIMS_FILE}: ${m}`)
  }
  if (!c || c.version !== 1) fail("version must be 1")
  if (!isStrList(c.banned_words)) fail("banned_words must be a non-empty list")
  for (const w of ["best", "only", "world class", "world-class", "guarantee", "guarantees", "guaranteed", "certified", "certification", "#1", "leading", "unmatched", "fastest", "100%", "Made in India"]) {
    if (!c.banned_words.includes(w)) fail(`banned_words must include "${w}"`)
  }
  if (!Array.isArray(c.fact_exceptions)) fail("fact_exceptions must be a list")
  for (const e of c.fact_exceptions) {
    if (!isStr(e.sentence) || !isStrList(e.words) || !isStr(e.kind) || !isStr(e.why)) fail(`fact_exceptions entry needs sentence/words/kind/why: ${JSON.stringify(e)}`)
    if (/made in india/i.test(e.sentence)) fail('no exception may contain "Made in India" (WO-014 §1)')
  }
  if (!Array.isArray(c.claims)) fail("claims must be a list")
  const ids = new Set()
  for (const k of c.claims) {
    if (!isStr(k.id) || !isStr(k.sentence) || !Array.isArray(k.words) || !isStr(k.evidence) || typeof k.owner_approved !== "boolean" || typeof k.legal_approved !== "boolean") {
      fail(`claim needs id/sentence/words/evidence/owner_approved/legal_approved: ${JSON.stringify(k)}`)
    }
    if (ids.has(k.id)) fail(`duplicate claim id ${k.id}`)
    ids.add(k.id)
    if (k.legal_approved && !k.owner_approved) fail(`${k.id}: legal_approved without owner_approved`)
    if (/made in india/i.test(k.sentence)) fail(`${k.id}: "Made in India" is banned outright (WO-014 §1)`)
  }
  return c
}

/** Load data/proof.yaml (content only; the switch is facts.proof.enabled). */
export function loadProof() {
  const p = readYaml(PROOF_FILE)
  const fail = (m) => {
    throw new Error(`${PROOF_FILE}: ${m}`)
  }
  if (!p || !isStr(p.title) || !isStr(p.intro)) fail("title/intro missing")
  if (!p.aggregates || !Array.isArray(p.aggregates.items)) fail("aggregates.items missing")
  for (const a of p.aggregates.items) {
    if (!isStr(a.label)) fail("aggregate needs a label")
    if (a.value !== null && typeof a.value !== "number") fail(`aggregate "${a.label}" value must be a number or null`)
  }
  if (!p.case_studies || !Array.isArray(p.case_studies.items)) fail("case_studies.items missing")
  for (const cs of p.case_studies.items) {
    if (!isStr(cs.organisation) || !/^\d{4}-\d{2}-\d{2}$/.test(String(cs.consent_on)) || !isStr(cs.summary)) fail("each case study needs organisation/consent_on/summary (consented only)")
  }
  return p
}
