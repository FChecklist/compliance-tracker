// R67 lane I (WS-I items I-01 and I-04) -- the "a debug label must never be
// served to a customer" rule, in one place.
//
// THE REAL INCIDENT THIS CLOSES: compliance.screen_definitions is the M28
// screen registry ("a function is a row, not a folder"), and PROJEXA renders
// list/dashboard column headers straight from the `columns` jsonb of the row
// it resolves. Two rows shipped with a debug label baked into that jsonb, and
// BOTH have org_id NULL -- they are the GLOBAL rows, so both leaked into every
// tenant:
//
//   a018f269-8375-44a5-a9ed-1060bf4d3efc  function_id 'schedule.timeline',
//     columns[0].label "Activity (HARD-STOP TEST)"       -- fixed by drizzle/0531
//   4b1ff3d4-6877-4a10-89cc-ceb4d6f90ca1  function_id 'dashboard.dashboard',
//     columns[0].label "Active Projects (HARD-STOP TEST)" -- fixed by drizzle/0528
//
// (Both ids and function_ids verified against pcrjmlpuqsbocqfwoxod by
// read-only SELECT -- a018f269 is the SCHEDULE row, not the dashboard one.)
// Nothing anywhere checked for this, so a label typed during a debugging
// session was served to real customers until a human happened to read it on
// a screenshot.
//
// WHY /test/i AND NOT SOMETHING NARROWER: the R66 audit's own wording
// ("failing when any label ... matches /test/i", and a verification SELECT of
// `columns::text ILIKE '%TEST%'` that must return zero rows) is deliberately
// blunt -- the point is that no reviewer has to guess which debug spelling
// was used. The cost of that bluntness is real and is NOT hidden here: a
// genuine construction label such as "Test Certificate" or "Testing Date"
// would also trip it. That case is handled by registering the exact label in
// ALLOWED_TEST_LABELS below with a citation -- an explicit, reviewable
// exception -- rather than by loosening the rule (AGENTS.md Rule 9: a
// guardrail is never weakened to make a build pass).
//
// Two consumers, deliberately: this module (unit-tested, imported by app
// code) and scripts/check-screen-definition-labels.mjs (the CI job, which
// needs to run under plain node with no TypeScript build step and therefore
// carries its own copy of the same one-line rule). That script's own test
// asserts the two copies still agree, so the duplication cannot silently
// drift.

/**
 * The label rule, exactly as the R66 audit specified it. Deliberately NOT
 * anchored or word-bounded -- see this file's header for why, and for what
 * ALLOWED_TEST_LABELS is for. Kept as a source string as well as a RegExp
 * so scripts/check-screen-definition-labels.test.ts can prove the CI
 * script's independent copy is character-for-character the same rule.
 */
export const TEST_LABEL_PATTERN_SOURCE = "test"
export const TEST_LABEL_PATTERN_FLAGS = "i"

/**
 * Labels that legitimately contain "test" and have been reviewed as real
 * customer-facing wording, not a debug artefact. Empty on introduction: at
 * the time this guard was written, every matching label in the registry was
 * a genuine leak. Add an entry ONLY with the function_id it belongs to and
 * a dated citation in the PR description -- never to make a red build green.
 */
export const ALLOWED_TEST_LABELS: ReadonlySet<string> = new Set<string>([])

export type ScreenDefinitionLabelRow = {
  id: string
  functionId: string
  orgId: string | null
  /** The raw `columns` jsonb value -- an array of column objects in practice, but typed unknown because this is DB-shaped data. */
  columns: unknown
}

export type LeakedLabel = {
  id: string
  functionId: string
  /** null org_id means the GLOBAL row -- the leak reaches every tenant, which is strictly worse. */
  orgId: string | null
  /** Index of the offending element within the row's `columns` array. */
  columnIndex: number
  label: string
}

function testLabelPattern(): RegExp {
  return new RegExp(TEST_LABEL_PATTERN_SOURCE, TEST_LABEL_PATTERN_FLAGS)
}

/**
 * Pulls the `label` of every element of a screen_definitions `columns` value.
 * Tolerant on purpose: the column is jsonb, so a malformed/legacy row (not an
 * array, or an element that is not an object, or one with a non-string label)
 * must be skipped rather than throwing -- a crashing guard is a guard that
 * gets disabled. Non-label rows simply contribute nothing to scan.
 */
export function extractColumnLabels(columns: unknown): { index: number; label: string }[] {
  if (!Array.isArray(columns)) return []
  const out: { index: number; label: string }[] = []
  columns.forEach((element, index) => {
    if (!element || typeof element !== "object") return
    const label = (element as Record<string, unknown>).label
    if (typeof label !== "string") return
    out.push({ index, label })
  })
  return out
}

/**
 * Every column label across `rows` that trips the debug-label rule and is not
 * an explicitly registered exception. An empty array means the registry is
 * clean.
 */
export function findLeakedTestLabels(rows: ScreenDefinitionLabelRow[]): LeakedLabel[] {
  const pattern = testLabelPattern()
  const leaks: LeakedLabel[] = []
  for (const row of rows) {
    for (const { index, label } of extractColumnLabels(row.columns)) {
      if (!pattern.test(label)) continue
      if (ALLOWED_TEST_LABELS.has(label)) continue
      leaks.push({ id: row.id, functionId: row.functionId, orgId: row.orgId, columnIndex: index, label })
    }
  }
  return leaks
}

/**
 * A human-readable failure report. Names the row id, the function, whether the
 * row is global (the leak-into-every-tenant case), and the offending label --
 * everything needed to write the corrective UPDATE without another query.
 */
export function formatLeakedTestLabelReport(leaks: LeakedLabel[]): string {
  if (leaks.length === 0) return "compliance.screen_definitions: no debug labels found."
  const lines = leaks.map(
    (l) =>
      `  - ${l.functionId} (row ${l.id}, ${l.orgId === null ? "GLOBAL -- leaks into every tenant" : `org ${l.orgId}`}) columns[${l.columnIndex}].label = ${JSON.stringify(l.label)}`
  )
  return [
    `compliance.screen_definitions: ${leaks.length} debug label(s) would be served to customers:`,
    ...lines,
  ].join("\n")
}
