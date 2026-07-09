// Wave 150 (Phase4_Implementation_Plan.md, "central 'Need LLM?' routing
// gate"). GapAnalysis_by_Claude.md's P0 item 3: "LLM calls happen ad hoc
// throughout the codebase rather than through one chokepoint that checks
// deterministic engines/capability registry first." FDE's confidence-
// threshold short-circuit (fde-service.ts) is the one place this pattern
// already works end-to-end and is the template here, not a redesign.
//
// Correction from VERIDIAN_Status_Review_2026-07-09.md: this is NOT
// blocked on OpenRouter credits -- that blocker is specific to this
// session's z.ai dispatch automation, not the app's own runtime LLM calls
// (chat already calls LLM successfully today via per-org BYOK config).
//
// Takes Wave 149's intent classification; if the intent has a real
// deterministic handler registered here, it runs (zero LLM cost) and its
// reply is returned. Anything unmatched returns { handled: false } and the
// caller falls through to the existing callLLM path completely unchanged
// -- purely additive, zero regression risk for every intent this doesn't
// recognize.
import { classifyIntent, type Intent } from "./intent-engine"
import { suggestResponseForTaskStatus, renderShortReply } from "./response-engine"

export type RoutingResult =
  | { handled: true; reply: string }
  | { handled: false }

type DeterministicHandler = (ctx: { orgId: string; userId: string }) => Promise<string | null>

// v1 covers exactly one real handler -- check_status, the most
// unambiguous case to answer deterministically (a direct DB lookup, no
// interpretation needed). Other intents (create_task, create_contact,
// generate_report) still need real argument extraction from free text
// before they could safely bypass the LLM -- correctly left for the LLM
// path for now rather than guessing. Registering more handlers here is
// how this gate grows, not a redesign.
//
// DB access is dynamically imported inside the handler, not at module
// top-level -- this module's dominant code path (an intent with no
// registered handler, i.e. 3 of the 4 classified intents plus "unknown")
// never needs a database connection at all, so it shouldn't pay the cost
// of resolving one just by being imported.
const HANDLERS: Partial<Record<Intent, DeterministicHandler>> = {
  check_status: async (ctx) => {
    const { withTenantContext } = await import("@/lib/db/tenant-scoped")
    const { tasks } = await import("@/lib/db")
    const { eq, and, desc } = await import("drizzle-orm")
    const latest = await withTenantContext(ctx, (db) =>
      db.query.tasks.findFirst({
        where: and(eq(tasks.userId, ctx.userId)),
        orderBy: desc(tasks.createdAt),
      })
    )
    if (!latest) return "No tasks yet"
    // Wave 154 (TaskDocx_Evaluation.md, Response Engine): software decides
    // the label from real status, zero LLM call -- the real proof this
    // vocabulary isn't unused infrastructure.
    return renderShortReply(suggestResponseForTaskStatus(latest.status, latest.title))
  },
}

/** Deterministic-first routing: no LLM call unless nothing here handles it. */
export async function tryDeterministicRoute(ctx: { orgId: string; userId: string }, text: string): Promise<RoutingResult> {
  const classification = classifyIntent(text)
  const handler = HANDLERS[classification.intent]
  if (!handler) return { handled: false }

  const reply = await handler(ctx)
  if (reply === null) return { handled: false }
  return { handled: true, reply }
}
