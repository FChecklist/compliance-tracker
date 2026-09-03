// R67 WS-C (C-03) -- WHICH VALUES A FUNCTION CANNOT RUN WITHOUT, AND WHAT TO
// CALL THE FAILURE WHEN ONE IS MISSING.
//
// WHY THIS FILE EXISTS. Until now every "you did not give me X" sentence in
// the pipeline was hand-written at the point of failure, in the executor's
// own words: `itemCode is required`, `percent is required`, `no project
// resolved for this task`. Those strings are what PROJEXA's Task Master
// rendered to a site engineer -- a camelCase parameter name, verbatim. D-03
// closes that vocabulary: the pipeline names the missing SLOT and the CODE,
// and the product chooses the sentence a person reads.
//
// It is also the only place that says what "complete" means for a function,
// which is what lets the composer ask ONE question at a time instead of
// minting a blocked task and making the user work it out.
//
// PURE. No DB, no model, no I/O -- the same posture validate.ts takes, so the
// whole table is testable with plain objects.

/**
 * D-03's closed vocabulary, plus the two codes R67 adds for the second write
 * this pipeline registers (a timesheet needs a TASK, which no D-03 code
 * covered) and for an unregistered function. Every value here has a matching
 * sentence in PROJEXA's src/lib/task-errors.ts; a code with no sentence there
 * falls back to "Something went wrong", never to a raw string.
 */
export const SLOT_ERROR_CODES = [
  "BOQ_LINE_REQUIRED",
  "BOQ_LINE_NOT_FOUND",
  "PROJECT_REQUIRED",
  "VALUE_REQUIRED",
  "TASK_REQUIRED",
  "FUNCTION_NOT_AVAILABLE",
  "BACKEND_UNAVAILABLE",
] as const;

export type SlotErrorCode = (typeof SLOT_ERROR_CODES)[number];

export type SlotDef = {
  /** The param name, exactly as the executor reads it. Never shown to a user. */
  name: string;
  /** The closed-vocabulary code for "this one is missing". */
  code: SlotErrorCode;
  /**
   * A slot the caller may omit because the pipeline fills it. `spentOn`
   * defaults to today; `activityType` is genuinely optional on the table.
   */
  optional?: boolean;
};

/**
 * One entry per function that WRITES. Read-only functions are deliberately
 * absent: a read with a missing filter returns fewer rows, which is an
 * answer, not a failure.
 */
export const FUNCTION_SLOTS: Readonly<Record<string, readonly SlotDef[]>> = {
  record_work_progress: [
    { name: "itemCode", code: "BOQ_LINE_REQUIRED" },
    { name: "percent", code: "VALUE_REQUIRED" },
  ],
  // C-03's four slots: task (fuzzy-matched over the project's issue titles),
  // category, date and hours. `issueId` is the resolved form of `task`, so
  // either satisfies the slot -- see missingSlots() below.
  record_timesheet: [
    { name: "task", code: "TASK_REQUIRED" },
    { name: "hours", code: "VALUE_REQUIRED" },
    { name: "spentOn", code: "VALUE_REQUIRED", optional: true },
    { name: "activityType", code: "VALUE_REQUIRED", optional: true },
  ],
};

/**
 * Slots that may be satisfied by a DIFFERENT param name -- the already
 * resolved id. "task" is what a person says; "issueId" is what the composer
 * has once a chip has been picked, and either is enough to run.
 */
const SLOT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  task: ["issueId"],
  itemCode: ["boqLineItemId"],
  percent: ["quantityDone", "quantity"],
};

function present(params: Record<string, unknown>, name: string): boolean {
  const value = params[name];
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

function satisfied(params: Record<string, unknown>, slot: SlotDef): boolean {
  if (present(params, slot.name)) return true;
  return (SLOT_ALIASES[slot.name] ?? []).some((alias) => present(params, alias));
}

/** The declared slots for a function, or an empty list when it has none. */
export function functionSlots(functionId: string): readonly SlotDef[] {
  return FUNCTION_SLOTS[functionId] ?? [];
}

/**
 * The REQUIRED slots this params object does not satisfy, in declaration
 * order -- so "ask one question at a time" always asks the same first
 * question for the same gap.
 */
export function missingSlots(functionId: string, params: Record<string, unknown>): string[] {
  return functionSlots(functionId)
    .filter((slot) => !slot.optional && !satisfied(params, slot))
    .map((slot) => slot.name);
}

/** The closed-vocabulary code for one slot name. */
export function slotCode(functionId: string, slotName: string): SlotErrorCode | null {
  const slot = functionSlots(functionId).find((s) => s.name === slotName);
  if (slot) return slot.code;
  // A param this function does not declare, but which another one does and
  // which means the same thing everywhere in this codebase.
  for (const slots of Object.values(FUNCTION_SLOTS)) {
    const match = slots.find((s) => s.name === slotName || (SLOT_ALIASES[s.name] ?? []).includes(slotName));
    if (match) return match.code;
  }
  return null;
}

/** The code for the FIRST missing slot -- the one question to ask now. */
export function firstMissingCode(functionId: string, params: Record<string, unknown>): SlotErrorCode | null {
  const missing = missingSlots(functionId, params);
  return missing.length === 0 ? null : slotCode(functionId, missing[0]);
}
