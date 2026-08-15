// Wave 151 (Phase4_Implementation_Plan.md, structured-response renderer v1).
//
// This is the PARSING + RENDERING half of the structured-response contract
// first sketched in Phase 3's ai-reply-gate.ts. Phase 3 shipped only a
// minimal envelope schema (`aiReplyEnvelopeSchema`) and deliberately left
// the full structured-output rewrite as future work -- see the long comment
// in ai-reply-gate.ts for why touching the generation side (chat-service.ts,
// system prompts) was explicitly out of scope then and remains out of scope
// for THIS wave too.
//
// What ships here is the read-side capability only: a Zod discriminated
// union covering two real content types (summary + confirmation), plus a
// parser that NEVER throws and returns `null` as the explicit "this isn't
// structured JSON, fall back to plain-Markdown rendering" signal. That null
// path is what makes this 100% backward compatible with the thousands of
// plain-text messages already stored -- a normal English sentence isn't
// valid JSON, so parseStructuredMessage returns null and MessageContent.tsx
// renders it through the EXACT same ReactMarkdown block it always has.
//
// The generation side (system prompt instructing the model to emit this JSON,
// chat-service.ts changes, migration of stored messages) is explicitly
// future work and is NOT attempted here.
import { z } from "zod"

// --- Schemas ---------------------------------------------------------------

const summaryItemSchema = z.object({
  label: z.string(),
  value: z.string(),
})

const summaryMessageSchema = z.object({
  type: z.literal("summary"),
  title: z.string(),
  items: z.array(summaryItemSchema),
})

const confirmationMessageSchema = z.object({
  type: z.literal("confirmation"),
  message: z.string(),
  actionLabel: z.string(),
})

// VCEL Calculation Explainability (VERIDIAN Review Framework gap closure,
// 2026-07-18): a third structured type, emitted by
// task-execution-engine.ts's executeEngineDispatch() only when the
// dispatched engine's output carries a `breakdown` (see
// src/lib/engines/breakdown.ts) -- an engine with no breakdown still posts
// the pre-existing plain "Result: {...}" string, unaffected by this
// addition. `result` is the flat key/value view of the engine's own
// output fields (already-formatted strings, matching summaryMessageSchema's
// own item.value convention); `steps` is the optional step-by-step
// derivation.
const calculationStepSchema = z.object({
  label: z.string(),
  formula: z.string().optional(),
  value: z.union([z.string(), z.number()]),
})

const calculationMessageSchema = z.object({
  type: z.literal("calculation"),
  engineName: z.string(),
  engineVersion: z.string().optional(),
  result: z.array(summaryItemSchema),
  steps: z.array(calculationStepSchema).optional(),
})

export const structuredMessageSchema = z.discriminatedUnion("type", [
  summaryMessageSchema,
  confirmationMessageSchema,
  calculationMessageSchema,
])

export type StructuredMessage = z.infer<typeof structuredMessageSchema>

export type SummaryMessage = z.infer<typeof summaryMessageSchema>
export type ConfirmationMessage = z.infer<typeof confirmationMessageSchema>
export type CalculationMessage = z.infer<typeof calculationMessageSchema>

// --- Parser ----------------------------------------------------------------

/**
 * Attempt to parse `content` as a structured message.
 *
 * Returns the validated structured object on success, or `null` on ANY
 * failure -- invalid JSON, valid JSON that doesn't match the discriminated
 * union, etc. `null` is the explicit "fall back to plain-Markdown
 * rendering" signal consumed by MessageContent.tsx.
 *
 * This function never throws. A plain English sentence like "Hi, how can I
 * help?" is not valid JSON and therefore returns null.
 */
export function parseStructuredMessage(content: string): StructuredMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  const result = structuredMessageSchema.safeParse(parsed)
  if (!result.success) {
    return null
  }
  return result.data
}
