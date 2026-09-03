// R67 WS-C (C-13) -- IS THIS FAILURE THE USER'S TO FIX, OR OURS?
//
// THE ROWS THIS EXISTS TO KILL, both captured live in the R66 walkthrough and
// both shown to a site engineer:
//
//   "Review Leads > View — write CONNECT_TIMEOUT 3.109.171.244:6543"
//   "Record record_work_progress — item code 01 not found"
//
// The first is a pooler IP and a port for a pool timeout nobody on site can do
// anything about; the second is a real question for the person, wearing a
// function id. They are DIFFERENT KINDS OF THING and the product treated them
// identically: same list, same badge, same silence about what to do next.
//
// ---------------------------------------------------------------------------
// FIX PASS, decision D-11 -- WHAT CHANGED AND WHY.
//
// Lane B's src/lib/pipeline/error-codes.ts merged to main while this file was
// being written, and the two declared the SAME two exported symbols --
// PIPELINE_ERROR_CODES and PipelineErrorCode -- over two different closed
// vocabularies. Two competing error vocabularies in one repo is the exact
// drift D-03 was raised to remove, so under D-11 ("the version already merged
// to main is canonical; the arriving lane folds its distinct capability into
// it") error-codes.ts is now THE vocabulary and this file no longer declares
// one at all. It keeps only the two things error-codes.ts does not do:
//
//   1. THE SYSTEM / USER SPLIT. Which codes mean "nobody on site can act on
//      this", so those rows can leave the needs-you list and its badge.
//   2. A RETRY TOKEN, so a retry can be correlated in the logs with the
//      failure that caused it.
//
// It no longer re-implements classification of a thrown driver error: that is
// normaliseThrownError()'s job and it does it. What is left of classifyFailure
// is a thin adapter that calls it and adds those two facts.
//
// Lane C's original file also carried a USER_PATTERNS table mapping legacy
// English ("no BOQ found for project") back to a code. That is DELIBERATELY
// GONE: lane B put the one legacy prose mapping in projexa's task-errors.ts
// (legacyToCode) precisely so the programme has ONE such mapping rather than
// two that drift, and a second copy here would have been that second copy.
//
// WHY 'failed_system' IS NOT A NEW pipeline_task_status VALUE. schema.ts's own
// comment closes that enum at five ("M24's closed 5-status set, verbatim -- no
// sixth value") and records that extending it needs owner sign-off this lane
// does not have. So 'failed_system' is a classification of the OUTCOME, and
// the row itself is persisted the way lane B's B-06 already persists a
// transport failure: status 'waiting' with a retryable error_code, which the
// tasks route groups without the blocked styling.
//
// PURE. No DB, no I/O -- asserted in failure-classification.test.ts.

import {
  isStatementTimeoutMessage,
  isTransportErrorMessage,
  normaliseThrownError,
  type PipelineErrorCode,
  type PipelineFailure,
} from "./error-codes";

/**
 * The codes NOBODY ON SITE CAN ACT ON. Excluded from the needs-you query and
 * from its count, so "3 needs you" means three decisions a person can actually
 * make -- a number that can be worked down to zero.
 *
 * INTERNAL_ERROR is here with the two transport codes: an unclassifiable
 * exception is still not something a foreman can fix by picking a different
 * BOQ line. INFRA_UNAVAILABLE is accepted as an alias because rows written by
 * lane C's own earlier build carry it, and a code this build does not know
 * must not silently become a user-fixable row.
 */
export const SYSTEM_ERROR_CODES: ReadonlySet<string> = new Set([
  "BACKEND_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
  "INTERNAL_ERROR",
  "INFRA_UNAVAILABLE",
]);

export function isSystemErrorCode(code: string | null | undefined): boolean {
  return !!code && SYSTEM_ERROR_CODES.has(code);
}

// ---------------------------------------------------------------------------
// MASKING -- the server's own last line of defence
// ---------------------------------------------------------------------------

/**
 * An IPv4 address WITH A PORT: "3.109.171.244:6543" (the real R66 row).
 *
 * FIX PASS -- THE PORT IS MANDATORY, and that is the whole fix. It used to be
 * optional (`(?::\d{1,5})?`), which made this pattern match a four-segment
 * dotted BOQ ITEM CODE: maskInfrastructure("record 50% on 1.01.1.2") returned
 * "record 50% on the service". This repo's own fixtures use exactly that shape
 * (work-progress-report-pdf.test.ts itemCode "1.01.1"), so it was not a
 * hypothetical. The captured defect was always an IP:PORT pair, and a bare
 * dotted quad is far more likely to be a BOQ code than a leaked host.
 */
const IP_PORT = /\b\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}\b/g;
/** A host with a port: "db.abcdefgh.supabase.co:5432", "localhost:5432". */
const HOST_PORT = /\b(?:[a-z0-9-]+\.)*[a-z0-9-]+:\d{2,5}\b/gi;
/** Transport codes that mean exactly one thing to a person: nothing. */
const TRANSPORT_CODE =
  /\b(?:ECONN[A-Z]+|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN|CONNECT_TIMEOUT|POOL_TIMEOUT|SASL|SSL)\b/g;

const SERVICE = "the service";
const UNAVAILABLE = "unavailable";

/**
 * Replace anything identifying infrastructure with words.
 *
 * PROJEXA masks again on its own side (task-errors.ts's maskTechnical) and
 * that is deliberate, not duplication: this endpoint has other consumers --
 * the MCP surface, the assistant route, any future client -- and "the browser
 * will clean it up" is not a property the server may rely on.
 *
 * FIX PASS -- THE STUTTER COLLAPSE NO LONGER EATS THE SEPARATOR. It was
 * /(?:the service[\s,]*)+/g, whose trailing `[\s,]*` consumed the space AFTER
 * the last replacement, so "write CONNECT_TIMEOUT 3.109.171.244:6543 while
 * saving" came out as "write unavailable the service while saving" with words
 * run together elsewhere. The collapse now matches only the repeats
 * themselves, so exactly one separator survives where one was.
 */
export function maskInfrastructure(text: string): string {
  if (!text) return text;
  return text
    .replace(IP_PORT, SERVICE)
    .replace(TRANSPORT_CODE, UNAVAILABLE)
    .replace(HOST_PORT, SERVICE)
    .replace(/(?:the service)(?:[ ,]+the service)+/g, SERVICE)
    .replace(/(?:unavailable)(?:[ ,]+unavailable)+/g, UNAVAILABLE)
    .replace(/ {2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// THE CLASSIFICATION
// ---------------------------------------------------------------------------

export type ClassifiedFailure = {
  /**
   * 'failed' -- a person can fix it, and the row stays in "needs you".
   * 'failed_system' -- nobody on site can, and the row leaves that list.
   */
  status: "failed" | "failed_system";
  /** The closed-vocabulary failure, from error-codes.ts. */
  failure: PipelineFailure;
  code: PipelineErrorCode;
  /** The slots the user has to supply, when the failure names any. */
  missing: string[];
  /**
   * The sentence a CLIENT may render. For a system failure it is replaced
   * outright -- there is nothing in a driver's own words a user can use.
   */
  message: string;
  /**
   * The raw text, for the SERVER LOG ONLY. It is deliberately not persisted
   * anywhere: pipeline_tasks has no column for it (see the schema.ts note on
   * pipelineTasks), which is what makes the R66 leak impossible to repeat
   * through that table.
   */
  details: string;
  /**
   * Present only on a system failure: the token a Retry re-submits with, so a
   * retry can be correlated in the logs with the failure that caused it.
   */
  retryToken?: string;
};

/** The one sentence every system failure gets. D-03's wording, verbatim. */
export const SYSTEM_FAILURE_MESSAGE =
  "The construction data service didn't answer — nothing was saved";

/**
 * Classify one thrown error.
 *
 * ORDER MATTERS AND SYSTEM WINS. A pool timeout that happens to mention a BOQ
 * line is still a pool timeout, and telling a foreman to "pick a BOQ line"
 * when the database did not answer would send them round a loop they cannot
 * get out of.
 *
 * The transport predicates are error-codes.ts's own -- this file no longer
 * keeps a second set. That is also what closes the FIX PASS finding that
 * lane C's own SYSTEM_PATTERNS carried a bare /\b(?:502|503|504)\b/, which
 * reclassified an ordinary refusal whose text contained a three-digit number
 * ("item code \"502\" not found in this project's BOQ") as an outage --
 * excluding it from the needs-you list AND its count, and telling the user to
 * wait for a service that was fine. error-codes.ts branches on ServiceError's
 * own status before it ever reaches a regex, for exactly that reason.
 */
export function classifyFailure(error: unknown, now: number = Date.now()): ClassifiedFailure {
  const { failure, debug } = normaliseThrownError(error);
  return fromFailure(failure, debug, now);
}

/**
 * The same classification for a failure that was RETURNED rather than thrown
 * -- an executor's own deliberate refusal, already carrying a code. Nothing is
 * re-read out of its wording; the code it chose is the authority.
 */
export function classifyPipelineFailure(
  failure: PipelineFailure,
  debug = "",
  now: number = Date.now()
): ClassifiedFailure {
  return fromFailure(failure, debug, now);
}

function fromFailure(failure: PipelineFailure, debug: string, now: number): ClassifiedFailure {
  const system = isSystemErrorCode(failure.code);
  return {
    status: system ? "failed_system" : "failed",
    failure,
    code: failure.code,
    missing: [...failure.missing],
    message: system ? SYSTEM_FAILURE_MESSAGE : maskInfrastructure(debug),
    details: debug,
    ...(system ? { retryToken: `retry_${now.toString(36)}` } : {}),
  };
}

/**
 * "Would this text have been classified as ours?" -- exported because the
 * needs-you exclusion has to be able to answer that for a LEGACY row whose
 * only record of the failure is the prose in `error`, and because a test that
 * pins the 502 regression needs to name the predicate it is pinning.
 */
export function looksLikeSystemText(text: string): boolean {
  return isStatementTimeoutMessage(text) || isTransportErrorMessage(text);
}
