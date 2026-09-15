// WO-DPDP-001 Phase 5, B6: "the obligation library written to 40 items
// with section references, lawyer-reviewed" is a LAUNCH BLOCKER, explicitly
// not something this session (or any AI session) can complete -- it needs
// counsel. What follows is NOT B6.
//
// It is the 10 example obligations already written, in final copy, inside
// the owner-supplied veridian-complete.html artefact itself (its `LIB`
// array) -- ported verbatim (same names, section references, proof kinds,
// default days) as a DRAFT seed so the product has something real to run
// against in development, tagged to library_version '0.1-draft'
// (drizzle/0415's own seed) rather than silently presented as final. A
// production launch must not proceed on this list alone -- see B6 in
// WO-DPDP-001 Phase 5 and this repo's own R72_DEPLOY_RITUAL-style posture
// of naming a blocker instead of quietly working around it.
import { eq } from "drizzle-orm"
import { db, dpdpObligationTemplate, dpdpLibraryVersion } from "@/lib/db"

export const DRAFT_LIBRARY_VERSION = "0.1-draft"

type DraftTemplateSeed = {
  key: string; name: string; sectionRef: string; proofKind: "doc" | "photo" | "declaration"
  defaultDays: number; answerableBy: "internal" | "processor" | "either"; roleTag: string
}

// Verbatim from veridian-complete.html's LIB array (L1-L10). u3/u4/o4 in the
// original are the PROTOTYPE's demo people/org (Anil Kapoor, Vikram Joshi,
// PixelForge) -- generalised here to answerableBy since a real org has no
// such fixed cast.
const DRAFT_TEMPLATES: DraftTemplateSeed[] = [
  { key: "L1", name: "Write down where every kind of data is kept", sectionRef: "S.8", proofKind: "declaration", defaultDays: 15, answerableBy: "internal", roleTag: "data_map" },
  { key: "L2", name: "Put a privacy notice on the website", sectionRef: "S.5", proofKind: "doc", defaultDays: 60, answerableBy: "processor", roleTag: "notice" },
  { key: "L3", name: "Name a Grievance Officer and publish the contact", sectionRef: "S.8(10)", proofKind: "photo", defaultDays: 30, answerableBy: "internal", roleTag: "grievance_officer" },
  { key: "L4", name: "Get a signed agreement with your processor", sectionRef: "S.8(2)", proofKind: "doc", defaultDays: 40, answerableBy: "internal", roleTag: "agreement" },
  { key: "L5", name: "Ask your processor exactly what the website collects", sectionRef: "S.5", proofKind: "declaration", defaultDays: 30, answerableBy: "processor", roleTag: "agreement" },
  { key: "L6", name: "Make a way for people to see or delete their data", sectionRef: "S.11", proofKind: "doc", defaultDays: 60, answerableBy: "internal", roleTag: "rights" },
  { key: "L7", name: "Write a plan for what to do in the first 72 hours of a leak", sectionRef: "S.8(6)", proofKind: "doc", defaultDays: 45, answerableBy: "internal", roleTag: "breach_plan" },
  { key: "L8", name: "Lock down PAN and Aadhaar records", sectionRef: "S.8(5)", proofKind: "declaration", defaultDays: 55, answerableBy: "internal", roleTag: "security" },
  { key: "L9", name: "Put a notice at every CCTV camera", sectionRef: "S.5", proofKind: "photo", defaultDays: 60, answerableBy: "internal", roleTag: "cctv" },
  { key: "L10", name: "Decide how long you keep each kind of record", sectionRef: "S.8(7)", proofKind: "declaration", defaultDays: 75, answerableBy: "internal", roleTag: "retention" },
]

/** Idempotent -- safe to call on every deploy/boot. Does nothing once the rows exist. */
export async function ensureDraftObligationLibrarySeeded(): Promise<void> {
  const version = await db.query.dpdpLibraryVersion.findFirst({ where: eq(dpdpLibraryVersion.version, DRAFT_LIBRARY_VERSION) })
  if (!version) return // Phase 1 migration seeds this row; if it's missing, something upstream is wrong -- don't invent one here.

  const existing = await db.query.dpdpObligationTemplate.findMany({ where: eq(dpdpObligationTemplate.libraryVersionId, version.id) })
  const existingKeys = new Set(existing.map((t) => t.key))
  const missing = DRAFT_TEMPLATES.filter((t) => !existingKeys.has(t.key))
  if (missing.length === 0) return

  await db.insert(dpdpObligationTemplate).values(
    missing.map((t) => ({
      libraryVersionId: version.id,
      key: t.key,
      name: t.name,
      plainText: t.name,
      sectionRef: t.sectionRef,
      proofKind: t.proofKind,
      defaultDays: t.defaultDays,
      recurrence: "quarterly",
      answerableBy: t.answerableBy,
      roleTag: t.roleTag,
    }))
  )
}

export async function getCurrentLibraryVersion() {
  const version = await db.query.dpdpLibraryVersion.findFirst({ where: eq(dpdpLibraryVersion.isCurrent, true) })
  if (!version) throw new Error("No dpdp.library_version marked is_current -- run ensureDraftObligationLibrarySeeded() or seed one")
  return version
}

export async function listObligationTemplates(libraryVersionId: string) {
  return db.query.dpdpObligationTemplate.findMany({ where: eq(dpdpObligationTemplate.libraryVersionId, libraryVersionId) })
}
