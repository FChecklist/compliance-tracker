// Package lf-b6-ci-unit-fixes. Since lf-b3-ai-off, PROJEXA's internal model lanes are behind PROJEXA_INTERNAL_AI_ENABLED, default OFF
// (src/lib/projexa-internal-ai.ts). The older suites whose SUBJECT is the extraction / assistant / reconciliation behaviour with the model
// path available call this inside their describe (or at file level) so the switch is exactly "1" for each of their tests only, and is put
// back to what it was afterwards, so no other test in the same process sees it on.
//
// The OFF side -- no model call, the calm refusal -- is pinned by B3's own suites (src/lib/projexa-internal-ai.test.ts,
// .transports.test.ts, .architecture.test.ts, the *-ai-off* suites), and the suites that use this helper add one switch-unset test of
// their own where the surface they drive has an off answer worth pinning.
import { afterEach, beforeEach } from "bun:test"
import { PROJEXA_INTERNAL_AI_FLAG } from "@/lib/projexa-internal-ai"

/** Sets PROJEXA_INTERNAL_AI_ENABLED="1" before each test of the enclosing scope and restores the previous value after it. */
export function withProjexaInternalAiOn(): void {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env[PROJEXA_INTERNAL_AI_FLAG]
    process.env[PROJEXA_INTERNAL_AI_FLAG] = "1"
  })
  afterEach(() => {
    if (saved === undefined) delete process.env[PROJEXA_INTERNAL_AI_FLAG]
    else process.env[PROJEXA_INTERNAL_AI_FLAG] = saved
  })
}

/** Runs `fn` with the switch unset (the default), restoring the previous value afterwards: for a suite's own off-side test. */
export async function withProjexaInternalAiUnset<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env[PROJEXA_INTERNAL_AI_FLAG]
  delete process.env[PROJEXA_INTERNAL_AI_FLAG]
  try {
    return await fn()
  } finally {
    if (saved === undefined) delete process.env[PROJEXA_INTERNAL_AI_FLAG]
    else process.env[PROJEXA_INTERNAL_AI_FLAG] = saved
  }
}
