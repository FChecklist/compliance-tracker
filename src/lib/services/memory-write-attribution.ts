// R68 (Institutional Memory Graph) Phase 6 -- ATTRIBUTION FOR AI-ORIGINATED
// MEMORY WRITES.
//
// THE RULE THIS ENFORCES, verbatim from R-IMG-07 (platform.crr_ruling, ruled
// 2026-09-03, is_binding = true):
//
//   "Every AI write to memory must be attributable -- which model, which
//    prompt hash, which caller, which chain -- and an unattributable write is
//    a corruption of the record. THAT ATTRIBUTION IS ALREADY HALF-BUILT:
//    compliance.memory_versions already carries changed_by_type,
//    changed_by_id, change_reason and content_hash per version. IMG must
//    extend it with model id and prompt hash, not replace it."
//
// WHAT WAS ALREADY THERE, AND WHAT WAS ACTUALLY MISSING (measured, not
// assumed -- columns confirmed live on pcrjmlpuqsbocqfwoxod, callers
// confirmed by grep over src/ on this branch):
//
//  - compliance.memory_versions.model_id / .prompt_hash EXIST (R68 Phase 1,
//    drizzle/0541 item 4) and supersedeMemoryRecord() already threads them
//    through to the INSERT. That half is real and stays untouched.
//  - But they were OPTIONAL with no rule attached, so a caller could declare
//    `changedBy.type = "AI"` and leave both NULL -- producing exactly the
//    unattributable AI write the ruling calls a corruption of the record.
//    Nothing rejected it. That is the first real gap this module closes.
//  - createMemoryRecord() had NO attribution channel at all. It writes no
//    memory_versions row, so an AI-originated CREATE had nowhere to record
//    which model or prompt produced it. That is the second gap.
//
// WHY A CREATE'S ATTRIBUTION GOES IN metadata AND NOT IN A v1
// memory_versions ROW. The obvious-looking fix -- have createMemoryRecord()
// write a version_number = 1 snapshot row -- is not available:
// memory_versions carries UNIQUE (memory_record_id, version_number)
// (constraint memory_versions_record_version_unique, confirmed live), and
// supersedeMemoryRecord() already inserts its snapshot of the OLD content
// under memory_record_id = <the old row> / version_number = <that row's own
// version>, which for a first supersession is exactly (id, 1). A create-time
// v1 row would therefore collide with the first real supersession of that
// same record and break it. Attribution for the ORIGINATING write is instead
// recorded into memory_records.metadata.attribution -- this table's own
// established audit slot, already used by appendLifecycleHistory()
// (metadata.lifecycleHistory) and redactMemoryRecordLineage()
// (metadata.erasure), and explicitly allow-listed by R68 Phase 1's
// append-only trigger (drizzle/0541, which permits metadata to change for
// precisely this class of append-only audit trail). Revisions keep using the
// real columns. Both facts are queryable; neither is invented.
//
// HONEST STATEMENT OF CURRENT REACH, because the brief asked for it rather
// than for a fabricated caller: at the time this module was written NO
// caller in this codebase originates an AI-driven memory write. There are
// exactly two real callers of createMemoryRecord() -- chat-service.ts's
// captureMemorableStatement() (provenanceType "USER_CONFIRMED", a human's
// own statement) and run-submission.ts's captureTaskResultMemory()
// (provenanceType "DATABASE_CONFIRMED", a completed task's real result) --
// and zero callers of supersedeMemoryRecord()/promoteMemoryRecord()/
// archiveMemoryRecord() outside tests. Nothing in src/ passes
// provenanceType "AI_INFERRED" or changedBy.type "AI" today. So this module
// is enforcement and plumbing built ready for the first such caller, tested
// against a real AI-write case, not a description of traffic that already
// exists. Inventing a caller to make the feature look wired would have been
// the dishonest option.

/** Who caused a memory write. Mirrors compliance.memory_versions'
 * changed_by_type CHECK ('USER' | 'SYSTEM' | 'AI') exactly -- defined here
 * rather than in memory-service.ts so this module can enforce the AI rule
 * without importing back into the service (memory-service.ts re-exports this
 * name, so its public surface is unchanged). */
export type ChangedByType = "USER" | "SYSTEM" | "AI"

/** The two facts an AI-originated write must carry. Both are required
 * together: a model id with no prompt hash cannot be reproduced, and a
 * prompt hash with no model id cannot be attributed. */
export type MemoryWriteAttribution = {
  /** The real model identifier as the router knows it (e.g. an OpenRouter
   * model id). Never a friendly label -- attribution has to survive a model
   * being renamed in the UI. */
  modelId: string
  /** Hash of the prompt that produced this content. This module does not
   * dictate the hash function; it requires that one was recorded. */
  promptHash: string
}

/** The attribution fields as they arrive on a caller's changedBy/originator
 * object -- optional at the type level (a USER or SYSTEM write legitimately
 * has neither) and made mandatory at runtime by assertAttributionComplete()
 * when, and only when, the write is AI-originated. */
export type PartialMemoryWriteAttribution = {
  modelId?: string | null
  promptHash?: string | null
}

export class MemoryAttributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MemoryAttributionError"
  }
}

/**
 * True when this write must be attributable. Two independent signals, either
 * of which is sufficient:
 *
 *  - `originatorType === "AI"` -- the caller says an AI made the change.
 *    This is the memory_versions.changed_by_type axis.
 *  - `provenanceType === "AI_INFERRED"` -- the CONTENT was inferred by a
 *    model. This is the memory_records.provenance_type axis, and it is a
 *    separate axis on purpose: a human clicking "save this" on a model's
 *    inference is a USER-originated write of AI-inferred content, and it
 *    still needs to say which model inferred it.
 */
export function isAiOriginatedWrite(input: { originatorType?: ChangedByType | null; provenanceType?: string | null }): boolean {
  return input.originatorType === "AI" || input.provenanceType === "AI_INFERRED"
}

/**
 * The enforcement point. Throws when an AI-originated write arrives without
 * both attribution facts -- deliberately loud, deliberately before any DB
 * write, and deliberately NOT a "best effort, log and continue": per
 * R-IMG-07 an unattributable AI write is a corruption of the record, so the
 * correct outcome is that the row is never created, not that it is created
 * with NULLs and a warning nobody reads.
 *
 * Returns the completed attribution (or null for a legitimately
 * non-AI-originated write) so callers do not have to re-narrow the type.
 */
export function assertAttributionComplete(
  callerName: string,
  input: {
    originatorType?: ChangedByType | null
    provenanceType?: string | null
  } & PartialMemoryWriteAttribution
): MemoryWriteAttribution | null {
  if (!isAiOriginatedWrite(input)) return null

  const modelId = input.modelId?.trim()
  const promptHash = input.promptHash?.trim()
  const missing: string[] = []
  if (!modelId) missing.push("modelId")
  if (!promptHash) missing.push("promptHash")

  if (missing.length > 0) {
    const why =
      input.originatorType === "AI"
        ? "changedBy.type is 'AI'"
        : "provenanceType is 'AI_INFERRED'"
    throw new MemoryAttributionError(
      `${callerName}: this write is AI-originated (${why}) but is missing ${missing.join(" and ")}. An AI write to institutional memory with no attribution is a corruption of the record (R-IMG-07, binding) -- supply the real model id and prompt hash, or do not record the write as AI-originated.`
    )
  }

  return { modelId: modelId as string, promptHash: promptHash as string }
}

/** The shape written into memory_records.metadata.attribution. Kept as a
 * plain function (not inlined into memory-service.ts) so the exact persisted
 * shape is testable on its own and cannot drift between the create path and
 * the supersede path, which both use it. */
export function buildAttributionEntry(input: {
  originatorType: ChangedByType
  originatorId?: string | null
  attribution: MemoryWriteAttribution | null
  chainId?: string | null
  at?: Date
}): Record<string, unknown> {
  return {
    originatorType: input.originatorType,
    originatorId: input.originatorId ?? null,
    modelId: input.attribution?.modelId ?? null,
    promptHash: input.attribution?.promptHash ?? null,
    // "which chain" -- the fourth fact R-IMG-07 names alongside model,
    // prompt and caller. Null when the write was not made under a chain.
    chainId: input.chainId ?? null,
    at: (input.at ?? new Date()).toISOString(),
  }
}
