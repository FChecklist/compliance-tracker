// PROJEXA-BUILD-001 U-46b1 (spec sections 4.4, 5.4, 6.2): the Markdown and CSV renderings of the reads. PURE. Every GET that can answer
// more than one format answers Markdown to a request with no Accept header (audit A-22), because Claude's web fetch reads text only.
// Free text from project data always sits inside a fenced `data` block whose content core.ts cleaned (control characters removed, no
// run of three backticks, capped), so a record cannot close the fence or pose as an instruction. Text that is ours (function ids and
// labels, urls built from the fixed base) stays outside a fence.
import { DATA_CLOSING, cleanDeep, fenceRows, fenceValue } from "../_shared/ai-link/core.ts"
import { availableWord, type FunctionView, type RecordsPage } from "./reads.ts"

const HEADING_RE = /[\r\n]/

function line(text: string): string {
  return HEADING_RE.test(text) ? text.replace(/[\r\n]+/g, " ") : text
}

/** A heading, an optional plain note, the value in a fenced data block, and the closing sentence. */
export function docMarkdown(title: string, doc: unknown, note?: string): string {
  return `# ${line(title)}\n\n${note ? `${note}\n\n` : ""}${fenceValue(doc)}\n\n${DATA_CLOSING}\n`
}

export function contextMarkdown(doc: Record<string, unknown>): string {
  const fns = (doc.functions as FunctionView[] | undefined) ?? []
  const level = String(doc.effective_level ?? doc.level ?? 0)
  const note = [
    `Effective level ${level}; the level this link was made at is ${String(doc.authority_level ?? level)}. Expires ${String(doc.expires_at ?? "")}.`,
    typeof doc.level_note === "string" ? doc.level_note : "",
    doc.direct_open ? "Direct changes are switched on." : "Direct changes are not switched on: draft a change and the person confirms it.",
    `Functions on this link now: ${fns.map((f) => f.id).join(", ") || "none"}.`,
  ].filter((l) => l !== "").join("\n")
  return docMarkdown("Context: who you work for", doc, note)
}

/**
 * GET /projects as Markdown. The projects are DATA (names are written by people), so they sit in a fenced block, each row with its number n; the two options
 * after them are ours, so they are plain text with the number each takes. The AI shows the person the numbered list and asks which one.
 */
export function projectsMarkdown(doc: Record<string, unknown>): string {
  const projects = Array.isArray(doc.projects) ? (doc.projects as Array<Record<string, unknown>>) : []
  const extra = Array.isArray(doc.extra_options) ? (doc.extra_options as Array<Record<string, unknown>>) : []
  const lines = [
    "# Your projects",
    "",
    `${projects.length} project${projects.length === 1 ? "" : "s"} of the person you work for${doc.truncated === true ? ` (the first ${projects.length} of ${String(doc.total)})` : ""}. Nothing has been changed.`,
    "",
    "Show the person this list, numbered exactly as below (the number is n), then the options after it, and ask which number they want:",
    "",
    projects.length ? fenceRows(projects) : "The person has no project yet.",
    "",
    "After the projects, offer these, with these numbers:",
    ...extra.map((o) => `- ${String(o.n)}. ${String(o.label)}: ${String(o.method)} ${String(o.url)}. ${String(o.then)}`),
    "",
    `To work in a project, use its id in the address: ${String(doc.project_url ?? "/projects/{id}/context")} (with the id in place of {id}), then /projects/{id}/records/<kind> and the rest of the manual's list.`,
  ]
  if (typeof doc.note === "string") lines.push("", doc.note)
  lines.push("", DATA_CLOSING, "")
  return lines.join("\n")
}

/** GET /portfolio as Markdown: the rows are data in a fenced block, the totals are ours. */
export function portfolioMarkdown(doc: Record<string, unknown>): string {
  const projects = Array.isArray(doc.projects) ? (doc.projects as Array<Record<string, unknown>>) : []
  const totals = (doc.totals && typeof doc.totals === "object" ? doc.totals : {}) as Record<string, unknown>
  const lines = [
    "# Report on all projects",
    "",
    String(doc.how_to_report ?? ""),
    "",
    projects.length ? fenceRows(projects) : "The person has no project yet.",
    "",
    `Totals of the ${projects.length} project${projects.length === 1 ? "" : "s"} shown: ${String(totals.tasks_total ?? 0)} tasks, ${String(totals.tasks_open ?? 0)} open, ${String(totals.tasks_overdue ?? 0)} overdue; ${String(totals.boq_lines ?? 0)} BOQ lines.`,
  ]
  if (typeof doc.note === "string") lines.push("", doc.note)
  lines.push("", DATA_CLOSING, "")
  return lines.join("\n")
}

export function recordsMarkdown(page: RecordsPage): string {
  const lines = [`# Records: ${page.kind}`, "", `${page.items.length} row${page.items.length === 1 ? "" : "s"} on this page. ${page.next ? `Next page: ${page.next}` : page.next_after ? `More rows follow: pass after=${page.next_after}.` : "This is the last page."}`]
  if (page.redacted) {
    lines.push(`Some fields are hidden for this role${page.hidden_fields.length ? ` (${page.hidden_fields.join(", ")})` : ""}. A null next to "redacted": true means hidden, not empty. Do not estimate it, and do not filter or sort on it.`)
  }
  lines.push("", fenceRows(page.items), "", DATA_CLOSING, "")
  return lines.join("\n")
}

export function recordMarkdown(doc: Record<string, unknown>): string {
  return `# Record: ${line(String(doc.kind ?? ""))}\n\n${fenceValue(doc.record)}\n\n${DATA_CLOSING}\n`
}

export function functionsMarkdown(functions: FunctionView[], note: string): string {
  const rows = functions.map((f) => `| ${f.id} | ${f.label} | ${f.module} | ${f.kind} | ${f.level} | ${availableWord(f)} | ${f.required.join(", ") || "none"} |`)
  return [
    "# Functions on this link",
    "",
    note,
    "",
    "| Function | What it does | Module | Kind | Level | Available | Required parameters |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n")
}

export function historyMarkdown(doc: Record<string, unknown>): string {
  const items = Array.isArray(doc.items) ? (doc.items as unknown[]) : []
  return `# History of this link\n\n${items.length} entr${items.length === 1 ? "y" : "ies"}, newest first.\n\n${fenceRows(items)}\n\n${DATA_CLOSING}\n`
}

/** GET /suggestions as Markdown: the titles are data written by AIs, so they sit in fenced blocks; the explanation is ours and stays outside them. */
export function suggestionsMarkdown(doc: Record<string, unknown>): string {
  const mine = Array.isArray(doc.mine) ? (doc.mine as unknown[]) : []
  const shared = Array.isArray(doc.shared) ? (doc.shared as unknown[]) : []
  return [
    "# Suggestions board", "", String(doc.note ?? ""), "",
    `## Yours (${mine.length})`, "", mine.length ? fenceRows(mine) : "You have not suggested anything yet.", "",
    `## Shared board: approved by the PROJEXA team (${shared.length})`, "", shared.length ? fenceRows(shared) : "Nothing is on the shared board yet.", "",
    DATA_CLOSING, "",
  ].join("\n")
}

export function intentMarkdown(doc: Record<string, unknown>): string {
  return docMarkdown("Change or draft status", doc)
}

export function proposalMarkdown(doc: { proposal: unknown; check: unknown; confirm_url: string; paste_block?: string; note: string }): string {
  const parts = ["# Proposed change (nothing has changed)", "", doc.note, "", `Confirm link for the person: ${doc.confirm_url}`, ""]
  if (doc.paste_block) parts.push("Paste block:", "", doc.paste_block, "")
  parts.push(fenceValue({ proposal: doc.proposal, check: doc.check }), "", DATA_CLOSING, "")
  return parts.join("\n")
}

// ---------------------------------------------------------------------------------------------------------------------------------
// CSV (spreadsheet paste-back, section 6.2)
// ---------------------------------------------------------------------------------------------------------------------------------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ""
  let s = typeof v === "object" ? JSON.stringify(v) : String(v)
  // A cell that starts like a formula would run in a spreadsheet: a leading apostrophe keeps it text.
  if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?\d/.test(s))) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One CSV document for a page of rows: the union of the row keys, in first-seen order. */
export function recordsCsv(page: RecordsPage): string {
  const cols: string[] = []
  for (const item of page.items) for (const k of Object.keys(item)) if (!cols.includes(k)) cols.push(k)
  const cleaned = page.items.map((i) => cleanDeep(i) as Record<string, unknown>)
  return [cols.map(csvCell).join(","), ...cleaned.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n"
}
