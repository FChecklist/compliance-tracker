// PROJEXA-BUILD-002 WP-04 -- a BOQ built in batches and sealed against control totals.
//
// WHY THIS FILE EXISTS. createBoq() takes every line in one call, and an AI holding a link cannot send
// 71 lines in one call: the link body is capped (8 KB, 64 KB for the three BOQ functions) and
// create_boq_revision REPLACES the whole list, so chunking through revisions makes one BOQ version per
// chunk. There was no way to append. This service adds the missing steps, on top of the same
// validateLineItemInputs()/insertLineItems() every other BOQ write uses:
//   - appendBoqLines(): at most MAX_LINES_PER_BATCH lines into an existing BOQ, in one transaction;
//   - sealBoq(): sums quantity x rate of the ROOT lines per area and compares with the totals the
//     caller read from its own source, sealing only when they are equal;
//   - createBoqLedgerHooks(): the retry key for create_boq (see below).
//
// THE LEDGER. Three facts must survive a retry: which batches were added, whether the BOQ is sealed, and
// which BOQ a retry key already created. No table holds them and this unit may not add one, so each is
// one row of compliance.audit_logs, written through logActivity() in the SAME transaction as the change
// it records (the contract audit.ts states: a write and its audit record commit or roll back together).
// audit_logs is append-only (drizzle/0236 revokes UPDATE and DELETE), so a ledger row cannot be edited
// afterwards, and it names the acting person and the time for free. The cost: state is read back by
// scanning a BOQ's own ledger rows (a handful per BOQ), not by a keyed lookup.
//
//   action                                entity_type          entity_id               details (JSON)
//   construction_boq.lines_batch_added    construction_boq     the BOQ id              batchNo, digest, lineIds, itemCodes, linesInBoq
//   construction_boq.sealed               construction_boq     the BOQ id              digest, controlTotals, expectedLineCount, lineCount
//   construction_boq.created_with_key     construction_boq_key <projectId>:<key>       boqId, digest of the title and lines
//
// RULES (each has a test in src/lib/pipeline/executor-boq-*.test.ts):
//   - a batch has 1 to 25 lines, and EVERY line needs an itemCode (the duplicate check and the area
//     sums are keyed by it); a child line's parentItemCode must be a code in the same batch;
//   - an itemCode already on the BOQ, from any earlier batch, is refused (DUPLICATE_ITEM_CODE) and the
//     whole batch is rolled back: a batch is all or nothing;
//   - the same boqId + batchNo with the same lines is a replay: nothing is written and the stored
//     outcome is returned (replayed: true); the same batchNo with different lines is a 409;
//   - a sealed BOQ takes no more batches (BOQ_SEALED), except the replay of a batch that was stored
//     before the seal;
//   - sealing compares whole-currency cents, per area and in total, and the line count; a mismatch is
//     TOTAL_MISMATCH with every difference listed and nothing is sealed. Sealing does NOT approve the
//     BOQ: its status is not touched, and approval stays the existing approve flow.
//
// WHAT "AREA" MEANS. The area of a line is the text of its category before the first "/", trimmed, so
// the categories "Play Area / Joinery" and "Play Area / Flooring" are both in the area "Play Area". A
// category with no "/" is its own area. A line with no category is in no area and is counted only in
// the grand total. Areas are matched without regard to case.
import { and, eq, inArray } from "drizzle-orm"
import { createHash } from "node:crypto"
import { auditLogs, constructionBoqLineItems, constructionBoqs, users } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { logActivity } from "@/lib/audit"
import { ServiceError } from "./compliance-service"
import { bustProjectDashboardCache } from "./project-dashboard-cache"
import {
  assertLineItemsPersisted,
  insertLineItems,
  validateLineItemInputs,
  type BoqLineItemInput,
  type CreateBoqHooks,
} from "./construction-boq-service"

export const MAX_LINES_PER_BATCH = 25
export const MAX_BATCH_NO = 100000
/** The most differences a TOTAL_MISMATCH lists; diffCount always carries the full number. */
export const MAX_DIFFS_LISTED = 20
/** The most characters of a retry key: long enough for a uuid or a hash, short enough to be an entity id. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128

const ACTION_BATCH = "construction_boq.lines_batch_added"
const ACTION_SEALED = "construction_boq.sealed"
const ACTION_CREATED = "construction_boq.created_with_key"
const ENTITY_BOQ = "construction_boq"
const ENTITY_KEY = "construction_boq_key"

/**
 * A refusal that carries the pipeline code the executor answers with. `status` is the HTTP-style status
 * the service would use; `payloadCode` is the specific reason a plain 409 or 422 cannot say.
 */
export class BoqPayloadError extends ServiceError {
  constructor(
    message: string,
    status: number,
    readonly payloadCode: "TOTAL_MISMATCH" | "BOQ_SEALED" | "DUPLICATE_ITEM_CODE",
    readonly context: Record<string, string | number | null> = {}
  ) {
    super(message, status)
    this.name = "BoqPayloadError"
  }
}

export type BoqPayloadCtx = { orgId: string; userId: string }

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")

/** JSON with object keys sorted, so the same lines always hash to the same digest. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

/** The area of a category (see the header): the text before the first "/", trimmed; null when there is no category. */
export function boqAreaOf(category: string | null | undefined): string | null {
  if (typeof category !== "string") return null
  const first = category.split("/")[0]?.trim() ?? ""
  return first === "" ? null : first
}

const areaKey = (area: string) => area.trim().toLowerCase()

async function loadActor(db: TenantDb, orgId: string, userId: string) {
  const actor = await db.query.users.findFirst({ where: and(eq(users.id, userId), eq(users.orgId, orgId)) })
  if (!actor || !actor.isActive) throw new ServiceError("The acting person is not an active user of this organisation", 403)
  return actor
}

async function loadBoq(db: TenantDb, orgId: string, projectId: string, boqId: string) {
  const boq = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, boqId), eq(constructionBoqs.orgId, orgId)) })
  // A BOQ of another project reads as absent, the same answer the executors give (U-18).
  if (!boq || boq.projectId !== projectId) throw new ServiceError("BOQ not found", 404)
  return boq
}

type LedgerRow = { action: string; details: Record<string, unknown> }

async function readLedger(db: TenantDb, orgId: string, entityType: string, entityId: string, actions: string[]): Promise<LedgerRow[]> {
  const rows = await db.query.auditLogs.findMany({
    where: and(eq(auditLogs.orgId, orgId), eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId), inArray(auditLogs.action, actions)),
  })
  return rows.map((r) => {
    try {
      const parsed: unknown = JSON.parse(r.details ?? "{}")
      return { action: r.action, details: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {} }
    } catch {
      return { action: r.action, details: {} }
    }
  })
}

// ---------------------------------------------------------------------------------------------------
// create_boq with a retry key
// ---------------------------------------------------------------------------------------------------

/** The key is stored in an entity id, so it is limited to characters that need no escaping. */
export function assertIdempotencyKey(key: string): void {
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new ServiceError(`idempotency_key must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} characters of letters, digits and . _ : -`, 400)
  }
}

/**
 * The hooks that make createBoq() idempotent on a key: a second call with the same project, key AND
 * payload (`payload` is the title and lines the caller sends) returns the BOQ the first call made and
 * writes nothing. The same key with a different payload is a 409, never a silent answer with the first
 * BOQ: a caller that reuses a key for another BOQ would otherwise believe its lines were stored.
 * `state.replayed` is true afterwards when the BOQ already existed.
 */
export function createBoqLedgerHooks(
  ctx: BoqPayloadCtx,
  projectId: string,
  key: string,
  payload: unknown
): { hooks: CreateBoqHooks; state: { replayed: boolean } } {
  assertIdempotencyKey(key)
  const entityId = `${projectId}:${key}`
  const digest = sha(canonical(payload))
  const state = { replayed: false }
  return {
    state,
    hooks: {
      findExisting: async (db) => {
        const [hit] = await readLedger(db, ctx.orgId, ENTITY_KEY, entityId, [ACTION_CREATED])
        const boqId = typeof hit?.details.boqId === "string" ? hit.details.boqId : null
        if (!boqId) return null
        if (hit.details.digest !== digest) {
          throw new ServiceError(`idempotency_key "${key}" was already used to create a different BOQ. Use a new key for a new BOQ.`, 409)
        }
        const boq = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, boqId), eq(constructionBoqs.orgId, ctx.orgId)), columns: { id: true } })
        state.replayed = boq !== undefined
        return boq ? boq.id : null
      },
      afterCreate: async (db, boqId) => {
        const actor = await loadActor(db, ctx.orgId, ctx.userId)
        await logActivity({ tx: db, action: ACTION_CREATED, entityType: ENTITY_KEY, entityId, orgId: ctx.orgId, dbUser: actor, details: JSON.stringify({ boqId, digest }) })
      },
    },
  }
}

// ---------------------------------------------------------------------------------------------------
// add_boq_lines
// ---------------------------------------------------------------------------------------------------

export type BatchOutcome = {
  boqId: string
  batchNo: number
  accepted: number
  /** the new lines' ids, in the order the lines were sent */
  lineIds: string[]
  itemCodes: string[]
  /** how many lines the BOQ held once this batch was in */
  linesInBoq: number
  sealed: boolean
  /** true when the batch was already stored and nothing was written now */
  replayed: boolean
}

export type BatchInput = { projectId: string; boqId: string; batchNo: number; lines: BoqLineItemInput[] }

/** Refusals that need no database, in the order a caller can fix them. */
function checkBatchShape(input: BatchInput): void {
  if (!Number.isInteger(input.batchNo) || input.batchNo < 1 || input.batchNo > MAX_BATCH_NO) {
    throw new ServiceError(`batchNo must be a whole number from 1 to ${MAX_BATCH_NO}`, 400)
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new ServiceError("lines must be a list with at least one line", 400)
  if (input.lines.length > MAX_LINES_PER_BATCH) {
    throw new ServiceError(`A batch holds at most ${MAX_LINES_PER_BATCH} lines, this one has ${input.lines.length}. Send the rest as the next batch.`, 400)
  }
  if (input.lines.some((l) => typeof l !== "object" || l === null || Array.isArray(l))) throw new ServiceError("every line must be an object", 400)
  input.lines.forEach((line, i) => {
    if (typeof line.itemCode !== "string" || line.itemCode.trim() === "") {
      throw new ServiceError(`line ${i + 1}: itemCode is required in a batch (it is what makes a duplicate visible)`, 400)
    }
  })
  // The service's own rules: description, unit, numbers, duplicate codes inside the batch, the snake_case traps.
  validateLineItemInputs(input.lines)
  const codes = new Set(input.lines.map((l) => l.itemCode))
  input.lines.forEach((line, i) => {
    if (line.parentItemCode && !codes.has(line.parentItemCode)) {
      throw new ServiceError(`line ${i + 1} (${line.itemCode}): parentItemCode "${line.parentItemCode}" must be a line of the same batch`, 400)
    }
  })
}

export async function appendBoqLines(ctx: BoqPayloadCtx, input: BatchInput): Promise<BatchOutcome> {
  checkBatchShape(input)
  const digest = sha(canonical(input.lines))

  const outcome = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db): Promise<BatchOutcome> => {
    const boq = await loadBoq(db, ctx.orgId, input.projectId, input.boqId)
    const actor = await loadActor(db, ctx.orgId, ctx.userId)
    const ledger = await readLedger(db, ctx.orgId, ENTITY_BOQ, boq.id, [ACTION_BATCH, ACTION_SEALED])

    // A replay comes first: a retry of a stored batch is answered from the ledger even after the seal.
    const stored = ledger.find((r) => r.action === ACTION_BATCH && r.details.batchNo === input.batchNo)
    if (stored) {
      if (stored.details.digest !== digest) {
        throw new ServiceError(`Batch ${input.batchNo} of this BOQ was already stored with different lines. Use the next batch number for new lines.`, 409)
      }
      const d = stored.details
      return {
        boqId: boq.id,
        batchNo: input.batchNo,
        accepted: Number(d.accepted ?? 0),
        lineIds: Array.isArray(d.lineIds) ? (d.lineIds as string[]) : [],
        itemCodes: Array.isArray(d.itemCodes) ? (d.itemCodes as string[]) : [],
        linesInBoq: Number(d.linesInBoq ?? 0),
        sealed: ledger.some((r) => r.action === ACTION_SEALED),
        replayed: true,
      }
    }
    if (ledger.some((r) => r.action === ACTION_SEALED)) {
      throw new BoqPayloadError("This BOQ is sealed: it takes no more lines. Create a revision to change it.", 409, "BOQ_SEALED", { boqId: boq.id })
    }

    const existing = await db.query.constructionBoqLineItems.findMany({
      where: eq(constructionBoqLineItems.boqId, boq.id),
      columns: { id: true, itemCode: true },
    })
    const taken = new Set(existing.map((l) => l.itemCode).filter((c): c is string => typeof c === "string"))
    const clash = input.lines.map((l) => l.itemCode as string).filter((c) => taken.has(c))
    if (clash.length > 0) {
      throw new BoqPayloadError(
        `itemCode "${clash[0]}" is already on this BOQ (${clash.length} of this batch's codes are). Item codes are unique across batches.`,
        409,
        "DUPLICATE_ITEM_CODE",
        { itemCode: clash[0], clashes: clash.length, boqId: boq.id }
      )
    }

    await insertLineItems(db, ctx.orgId, boq.id, input.lines)
    await assertLineItemsPersisted(db, boq.id, existing.length + input.lines.length)

    const codes = input.lines.map((l) => l.itemCode as string)
    const stored2 = await db.query.constructionBoqLineItems.findMany({
      where: and(eq(constructionBoqLineItems.boqId, boq.id), inArray(constructionBoqLineItems.itemCode, codes)),
      columns: { id: true, itemCode: true },
    })
    const idByCode = new Map(stored2.map((l) => [l.itemCode as string, l.id]))
    const lineIds = codes.map((c) => idByCode.get(c)).filter((id): id is string => typeof id === "string")
    if (lineIds.length !== codes.length) {
      throw new ServiceError(`Batch not stored: ${codes.length} line(s) sent but ${lineIds.length} found afterwards. Nothing was saved.`, 500)
    }

    const result: BatchOutcome = {
      boqId: boq.id,
      batchNo: input.batchNo,
      accepted: codes.length,
      lineIds,
      itemCodes: codes,
      linesInBoq: existing.length + codes.length,
      sealed: false,
      replayed: false,
    }
    await logActivity({
      tx: db,
      action: ACTION_BATCH,
      entityType: ENTITY_BOQ,
      entityId: boq.id,
      orgId: ctx.orgId,
      dbUser: actor,
      details: JSON.stringify({ batchNo: input.batchNo, digest, accepted: result.accepted, lineIds, itemCodes: codes, linesInBoq: result.linesInBoq }),
    })
    return result
  })
  if (!outcome.replayed) bustProjectDashboardCache(ctx.orgId, input.projectId)
  return outcome
}

// ---------------------------------------------------------------------------------------------------
// seal_boq
// ---------------------------------------------------------------------------------------------------

export type ControlTotals = { areas: Record<string, number>; grand: number }

export type TotalDiff = {
  /** an area name, "grand" for the total of every root line, or "lineCount" */
  field: string
  /** what the caller said */
  expected: number | null
  /** what the BOQ's lines add up to */
  actual: number
  difference: number | null
}

export type SealOutcome = {
  boqId: string
  sealed: true
  lineCount: number
  controlTotals: ControlTotals
  /** true when the BOQ was already sealed with these totals and nothing was written now */
  replayed: boolean
}

export type SealInput = { projectId: string; boqId: string; controlTotals: ControlTotals; expectedLineCount: number }

const cents = (n: number) => Math.round(n * 100)
const fromCents = (c: number) => c / 100

/** Pure: the caller's totals against the lines' own, every difference listed. Empty means they agree. */
export function compareControlTotals(
  lines: ReadonlyArray<{ quantity: string | number | null; rate: string | number | null; category: string | null; parentLineItemId: string | null }>,
  totals: ControlTotals,
  expectedLineCount: number
): TotalDiff[] {
  const perArea = new Map<string, { name: string; cents: number }>()
  let grand = 0
  for (const line of lines) {
    if (line.parentLineItemId) continue // a sub-task's amount is a share of its parent's: root lines only
    const amount = cents(Number(line.quantity ?? 0) * Number(line.rate ?? 0))
    grand += amount
    const area = boqAreaOf(line.category)
    if (area === null) continue
    const slot = perArea.get(areaKey(area)) ?? { name: area, cents: 0 }
    slot.cents += amount
    perArea.set(areaKey(area), slot)
  }
  const diffs: TotalDiff[] = []
  const said = new Map(Object.entries(totals.areas).map(([name, value]) => [areaKey(name), { name, value }]))
  for (const [key, slot] of perArea) {
    const stated = said.get(key)
    if (!stated) diffs.push({ field: slot.name, expected: null, actual: fromCents(slot.cents), difference: null })
    else if (cents(stated.value) !== slot.cents) diffs.push({ field: slot.name, expected: stated.value, actual: fromCents(slot.cents), difference: fromCents(slot.cents - cents(stated.value)) })
  }
  for (const [key, stated] of said) {
    if (!perArea.has(key)) diffs.push({ field: stated.name, expected: stated.value, actual: 0, difference: fromCents(0 - cents(stated.value)) })
  }
  if (cents(totals.grand) !== grand) diffs.push({ field: "grand", expected: totals.grand, actual: fromCents(grand), difference: fromCents(grand - cents(totals.grand)) })
  if (expectedLineCount !== lines.length) diffs.push({ field: "lineCount", expected: expectedLineCount, actual: lines.length, difference: lines.length - expectedLineCount })
  return diffs
}

function checkSealShape(input: SealInput): void {
  const t = input.controlTotals as unknown
  if (!t || typeof t !== "object" || Array.isArray(t)) throw new ServiceError("controlTotals must be an object {areas: {<area>: number}, grand: number}", 400)
  const { areas, grand } = t as { areas?: unknown; grand?: unknown }
  if (typeof grand !== "number" || !Number.isFinite(grand) || grand < 0) throw new ServiceError("controlTotals.grand must be a non-negative number", 400)
  if (!areas || typeof areas !== "object" || Array.isArray(areas)) throw new ServiceError("controlTotals.areas must be an object {<area>: number}, empty when the BOQ has no areas", 400)
  for (const [name, value] of Object.entries(areas)) {
    if (name.trim() === "" || typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new ServiceError(`controlTotals.areas["${name}"] must be a non-negative number`, 400)
    }
  }
  if (!Number.isInteger(input.expectedLineCount) || input.expectedLineCount < 0) throw new ServiceError("expectedLineCount must be a whole number, 0 or more", 400)
}

export async function sealBoq(ctx: BoqPayloadCtx, input: SealInput): Promise<SealOutcome> {
  checkSealShape(input)
  const digest = sha(canonical({ totals: input.controlTotals, count: input.expectedLineCount }))

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db): Promise<SealOutcome> => {
    const boq = await loadBoq(db, ctx.orgId, input.projectId, input.boqId)
    const actor = await loadActor(db, ctx.orgId, ctx.userId)
    const ledger = await readLedger(db, ctx.orgId, ENTITY_BOQ, boq.id, [ACTION_SEALED])
    const sealed = ledger.find((r) => r.action === ACTION_SEALED)
    if (sealed) {
      if (sealed.details.digest !== digest) {
        throw new BoqPayloadError("This BOQ is already sealed with different control totals.", 409, "BOQ_SEALED", { boqId: boq.id })
      }
      return { boqId: boq.id, sealed: true, lineCount: Number(sealed.details.lineCount ?? 0), controlTotals: input.controlTotals, replayed: true }
    }

    const lines = await db.query.constructionBoqLineItems.findMany({
      where: eq(constructionBoqLineItems.boqId, boq.id),
      columns: { quantity: true, rate: true, category: true, parentLineItemId: true },
    })
    const diffs = compareControlTotals(lines, input.controlTotals, input.expectedLineCount)
    if (diffs.length > 0) {
      throw new BoqPayloadError(
        `The control totals do not match the BOQ's lines (${diffs.length} difference${diffs.length === 1 ? "" : "s"}). Nothing was sealed.`,
        422,
        "TOTAL_MISMATCH",
        { boqId: boq.id, diffCount: diffs.length, diffs: JSON.stringify(diffs.slice(0, MAX_DIFFS_LISTED)) }
      )
    }
    await logActivity({
      tx: db,
      action: ACTION_SEALED,
      entityType: ENTITY_BOQ,
      entityId: boq.id,
      orgId: ctx.orgId,
      dbUser: actor,
      details: JSON.stringify({ digest, controlTotals: input.controlTotals, expectedLineCount: input.expectedLineCount, lineCount: lines.length }),
    })
    return { boqId: boq.id, sealed: true, lineCount: lines.length, controlTotals: input.controlTotals, replayed: false }
  })
}
