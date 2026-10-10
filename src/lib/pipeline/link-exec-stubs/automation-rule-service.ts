// Stub of src/lib/services/automation-rule-service.ts for the ai-work-link-exec bundle. A progress or labour write triggers the organisation's
// automation rules fire-and-forget (`void import(...).then(evaluateAndRunRules)`, no .catch). A link write skips that trigger (PMD-45 R-E): the
// real module needs next/server, and an unhandled rejection can end an Edge isolate after the row is already written (write-path gap G10). The rules
// still run for the same change made in the app.
export async function evaluateAndRunRules(_ctx: unknown, _trigger: string, _payload: unknown): Promise<{ skipped: true }> {
  return { skipped: true }
}
