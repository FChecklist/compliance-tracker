// Exception Handling Framework (VERIDIAN Review Framework gap closure,
// Checks & Balances / Exception Handling & Recovery track, 2026-07-18) --
// see compliance-service.ts's ServiceError header for the full business-vs-
// system / retryable-vs-terminal taxonomy this module builds on. This file
// is the reusable, generic piece of that framework: given ANY thrown error,
// decide whether it's worth retrying, and a bounded automatic-retry runner
// services/routes can wrap a call in without hand-rolling their own
// try/catch-and-retry loop every time.
//
// Anything that isn't a ServiceError at all (a raw driver exception, an
// unwrapped programming error) is treated as an unclassified system fault --
// conservatively retryable once, since nothing here has evidence it's the
// caller's fault the way a deliberately-thrown business ServiceError is.
import { ServiceError } from "./compliance-service"

export function classifyError(error: unknown): { kind: "business" | "system"; retryable: boolean } {
  if (error instanceof ServiceError) return { kind: error.kind, retryable: error.retryable }
  return { kind: "system", retryable: true }
}

export function isRetryableError(error: unknown): boolean {
  return classifyError(error).retryable
}

/**
 * Automatic Recovery: runs `fn`, and if it throws a retryable error (per the
 * taxonomy above), runs it exactly `maxRetries` more times before giving up
 * and rethrowing the last error. Not a generic infinite-retry loop -- one
 * retry is enough to absorb a transient blip without masking a persistent
 * system fault as success, and matches this codebase's existing "no
 * unbounded retry" discipline (see llm-client.ts's own bounded-retry
 * precedent for the same reasoning). A non-retryable (business) error is
 * rethrown immediately on the first attempt -- retrying an invalid request
 * would just fail identically and waste the attempt.
 */
export async function withAutomaticRecovery<T>(fn: () => Promise<T>, opts?: { maxRetries?: number }): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 1
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt >= maxRetries || !isRetryableError(error)) throw error
    }
  }
  throw lastError
}
