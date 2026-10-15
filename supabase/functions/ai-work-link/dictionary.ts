// The function dictionary: for every function on a link, what it is for, every field it takes (name, plain label, type, required or not, where an id comes
// from), a worked example and the order of calls. Generated from the registry (function-registry.generated.json, which scripts/gen-ai-link-registry.ts builds
// from src/lib/pipeline/function-registry.ts), so it cannot drift from what the functions really accept: an AI that reads this page knows what exists and how to
// use it without guessing. Pure: no database, no Deno, bun-tested (src/lib/ai-links/function-dictionary.test.ts).
import { EXAMPLE_PARAMS, type RegistryFunction } from "./api-definition.ts"

export type DictFieldType = "text" | "number" | "percent" | "date" | "time" | "choice" | "file" | "id" | "list" | "flag"

export type DictField = {
  name: string
  label: string
  type: DictFieldType
  required: boolean
  unit?: string
  default?: string | number
  /** Where a value comes from or how it is written: "an id from records/boqs", "YYYY-MM-DD", "send one of these names instead". */
  note?: string
}

/** The record list an id parameter points at ("boqId" -> records/boqs). A name not listed here still says "an id from the matching records list". */
const ID_SOURCE: Record<string, string> = {
  boqId: "boqs", boqLineItemId: "boq_lines", lineItemId: "boq_lines", rosterId: "roster", materialId: "materials", milestoneId: "milestones",
  documentId: "documents", drawingDocumentId: "documents", changeOrderId: "change_orders", meetingId: "meetings", issueId: "tasks", taskId: "tasks",
  entryId: "progress", progressEntryId: "progress", claimId: "progress_claims", rfiId: "rfis", permitId: "permits", attendanceId: "attendance",
  timeEntryId: "timesheets", timesheetId: "timesheets", punchItemId: "punch_list", activityId: "activities", submittalId: "submittals",
  siteDiaryId: "site_diaries", kpiEntryId: "kpi_entries", baselineId: "schedule_baselines", receiptId: "material_receipts",
}

const TYPE_HINT: Partial<Record<DictFieldType, string>> = {
  date: "YYYY-MM-DD",
  time: "HH:MM",
  percent: "a number from 0 to 100",
  number: "a number, no units or commas",
}

function idNote(name: string, project: boolean): string {
  if (project) return "the project's id, from the project list"
  const kind = ID_SOURCE[name]
  return kind ? `an id from records/${kind}` : "an id read from the matching records list"
}

function listLike(name: string): boolean {
  return /(lines|items|list|signers|ids)$/i.test(name) || /^(lines|lineItems|controlTotals)$/.test(name)
}

/** Every field of a function, required ones first: the card's typed fields, then the required names the card lacks (ids mostly), then the optional extras. */
export function fieldsOf(def: RegistryFunction): DictField[] {
  const out: DictField[] = []
  const seen = new Set<string>()
  const add = (f: DictField) => {
    if (seen.has(f.name)) return
    seen.add(f.name)
    out.push(f)
  }
  const cardFields = (def as RegistryFunction & { fields?: Array<{ key: string; label: string; type: string; required: boolean; unit?: string; default?: string | number }> }).fields ?? []
  const requiredNames = new Set(def.required_params.flatMap((r) => r.any_of))
  const alternatives = new Map<string, string[]>()
  for (const r of def.required_params) if (r.any_of.length > 1) for (const n of r.any_of) alternatives.set(n, r.any_of.filter((x) => x !== n))

  for (const r of def.required_params) {
    const name = r.name
    const card = cardFields.find((c) => c.key === name)
    if (name === "projectId") {
      add({ name, label: "Project", type: "id", required: true, note: idNote(name, true) })
      continue
    }
    if (card) {
      const type = (card.type === "select" ? "choice" : (card.type as DictFieldType)) ?? "text"
      add({ name, label: card.label, type, required: true, ...(card.unit ? { unit: card.unit } : {}), ...(card.default !== undefined ? { default: card.default } : {}), note: [TYPE_HINT[type], alternatives.get(name)?.length ? `or send ${alternatives.get(name)!.join(" or ")} instead` : ""].filter(Boolean).join("; ") || undefined })
      continue
    }
    const isId = /Ids?$/.test(name) || def.id_params.includes(name) || name in ID_SOURCE
    add({ name, label: r.label, type: isId ? "id" : listLike(name) ? "list" : "text", required: true, note: [isId ? idNote(name, false) : "", alternatives.get(name)?.length ? `or send ${alternatives.get(name)!.join(" or ")} instead` : ""].filter(Boolean).join("; ") || undefined })
  }
  for (const c of cardFields) {
    if (seen.has(c.key) || requiredNames.has(c.key)) continue
    const type = (c.type === "select" ? "choice" : (c.type as DictFieldType)) ?? "text"
    add({ name: c.key, label: c.label, type, required: false, ...(c.unit ? { unit: c.unit } : {}), ...(c.default !== undefined ? { default: c.default } : {}), note: TYPE_HINT[type] })
  }
  const optional = (def as RegistryFunction & { optional_params?: string[] }).optional_params ?? []
  for (const name of [...optional, ...def.declared_params]) {
    if (seen.has(name) || name === "projectId") continue
    const isId = /Ids?$/.test(name) || name in ID_SOURCE
    add({ name, label: name, type: isId ? "id" : listLike(name) ? "list" : "text", required: false, note: isId ? idNote(name, false) : undefined })
  }
  return out
}

function placeholder(f: DictField): unknown {
  switch (f.type) {
    case "number": return 1
    case "percent": return 10
    case "date": return "2026-10-01"
    case "time": return "09:00"
    case "flag": return true
    case "list": return []
    case "id": return `<${f.note ?? "an id"}>`
    case "choice": return "<pick one>"
    case "file": return "<link to the uploaded file>"
    default: return `<${f.label.toLowerCase()}>`
  }
}

/** A working example: the hand-written one where there is one, else built from the required fields (never including projectId: the address already names the project). */
export function exampleOf(def: RegistryFunction): Record<string, unknown> {
  const hand = EXAMPLE_PARAMS[def.function_id]
  if (hand && Object.keys(hand).length > 0) return hand
  const out: Record<string, unknown> = {}
  const done = new Set<string>()
  for (const r of def.required_params) {
    if (r.name === "projectId") continue
    if (r.any_of.some((n) => done.has(n))) continue
    const f = fieldsOf(def).find((x) => x.name === r.name)
    if (f) out[f.name] = placeholder(f)
    done.add(r.name)
  }
  return out
}

/** The compact signature used on lists: `title*, idempotency_key*, optional: lineItems`. A * marks a required field; an "either or" is written a|b*. */
export function signatureOf(def: RegistryFunction): string {
  const required = def.required_params.filter((r) => r.name !== "projectId").map((r) => `${r.any_of.join("|")}*`)
  const reqNames = new Set(def.required_params.flatMap((r) => r.any_of))
  const optional = fieldsOf(def).filter((f) => !f.required && !reqNames.has(f.name) && f.name !== "projectId").map((f) => f.name)
  return [required.join(", ") || "no fields", optional.length ? `optional: ${optional.join(", ")}` : ""].filter(Boolean).join("; ")
}

export type DictEntry = {
  id: string
  label: string
  module: string
  kind: "read" | "write"
  level: number
  fields: DictField[]
  example_params: Record<string, unknown>
  steps: string[]
}

export function dictionaryEntry(def: RegistryFunction): DictEntry {
  const read = def.kind === "read"
  return {
    id: def.function_id,
    label: def.label,
    module: def.module,
    kind: def.kind,
    level: def.link_level ?? 0,
    fields: fieldsOf(def),
    example_params: exampleOf(def),
    steps: read
      ? [`Run it: POST /functions/${def.function_id} with {"params": {...}} (a GET never runs a function).`, "Tell the person what you read, with the as-of date and how many records."]
      : [
        `Check it first: POST /check with {"function": "${def.function_id}", "params": {...}}; nothing is recorded.`,
        "Show the person, in plain words, what will be added, changed or removed.",
        "Then do it as the link allows: POST /actions when this link allows direct changes for it, else POST /drafts and give the person the confirm address.",
        "Read the record again and say what you saw. If the software refused, show its own sentence and ask the person; never retry with altered values.",
      ],
  }
}
