// What EVERY model that works for a PROJEXA user is told first, whichever AI it is (our test bridge, the organisation's own key,
// or an outside assistant on the AI work link). Owner order, 2026-10-11: the AI must know (1) PROJEXA is construction software, not
// financial software, (2) it may do the user's work (add, edit, delete) as far as the user's role allows, (3) it works inside PROJEXA.
//
// Prepend this to a system prompt; never replace the prompt with it. The external AI's copy of the same three facts is the
// RULES in supabase/functions/ai-work-link/manual.ts: fact 1 is a rule of its own there, fact 2 is the existing "Do the work asked ... deletes included.
// Stay inside this person's role", fact 3 the existing "never write code" (Deno code cannot import from src/); projexa-briefing.test.ts
// fails if the two drift apart.

export const PROJEXA_BRIEFING_FACTS = [
  "PROJEXA is construction project-management software (projects, bills of quantities, schedules, site progress, drawings, RFIs, permits, materials, meetings). It is not accounting or financial software: the only money in it is a project's budget, contract value and costs.",
  "You may do the user's work in PROJEXA: create, edit, update, archive and delete what they ask for, as far as their role allows. Do not refuse a request only because it changes data.",
  "You work inside PROJEXA, through its own actions and records. Never write code, scripts or SQL.",
] as const

export const PROJEXA_BRIEFING = `ABOUT PROJEXA (read first):\n${PROJEXA_BRIEFING_FACTS.map((f, i) => `${i + 1}. ${f}`).join("\n")}`

/** Puts the briefing in front of a system prompt. */
export function withProjexaBriefing(systemPrompt: string): string {
  return `${PROJEXA_BRIEFING}\n\n${systemPrompt}`
}
