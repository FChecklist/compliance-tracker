// The logic of the consent page (/p/), kept out of the component so it can be tested: when the page is the simple, original Yes/No page and when it is
// the fuller one (several items, a child's guardian), what must be filled before it can be saved, and which answers can be withdrawn.
// The database side is drizzle/0725; the original single Yes/No answer still works and still looks the same.
import type { ConsentPurpose, ParentConsentPreview } from "./rpc-types"

export const LEGACY_PURPOSE_KEY = "consent"
type Ok = Extract<ParentConsentPreview, { ok: true }>

/** The items a link asks about. A database without 0725 sends none: that is the one legacy item. */
export function purposesOf(ctx: Ok): ConsentPurpose[] {
  if (ctx.purposes && ctx.purposes.length > 0) return ctx.purposes
  return [{ key: LEGACY_PURPOSE_KEY, label: "Use of your personal data as described in this notice", answer: null }]
}

/** The original page (one Yes/No for the whole notice, no guardian) is kept exactly when there is one legacy item and the person is not a child. */
export function isSimpleConsent(ctx: Ok): boolean {
  const p = purposesOf(ctx)
  return p.length === 1 && p[0].key === LEGACY_PURPOSE_KEY && !ctx.principalIsChild
}

export type Guardian = { name: string; relation: "parent" | "legal_guardian" | "" }

/** null when the guardian details are fine (or not needed); otherwise one plain sentence. Matches the database check. */
export function guardianProblem(isChild: boolean, g: Guardian): string | null {
  if (!isChild) return null
  const name = g.name.replace(/\s+/g, " ").trim()
  if (!/^\p{L}[\p{L}\p{M} .'-]{1,79}$/u.test(name)) return "Please give the name of the parent or legal guardian answering for the child."
  if (g.relation !== "parent" && g.relation !== "legal_guardian") return "Please say whether you are the parent or the legal guardian."
  return null
}

/** The keys still unanswered. */
export function unanswered(purposes: ConsentPurpose[], answers: Record<string, "yes" | "no" | undefined>): string[] {
  return purposes.filter((p) => answers[p.key] !== "yes" && answers[p.key] !== "no").map((p) => p.key)
}

/** True when every item has an answer and, for a child, the guardian details are in. */
export function canSave(ctx: Ok, answers: Record<string, "yes" | "no" | undefined>, g: Guardian): boolean {
  return unanswered(purposesOf(ctx), answers).length === 0 && guardianProblem(!!ctx.principalIsChild, g) === null
}

/** The items the person said Yes to and can still withdraw with this same link. */
export function withdrawable(ctx: Ok): ConsentPurpose[] {
  return purposesOf(ctx).filter((p) => p.answer === "yes")
}

/** The answers to send: exactly one Yes or No per item. */
export function answersToSend(purposes: ConsentPurpose[], answers: Record<string, "yes" | "no" | undefined>): Record<string, "yes" | "no"> {
  const out: Record<string, "yes" | "no"> = {}
  for (const p of purposes) {
    const a = answers[p.key]
    if (a === "yes" || a === "no") out[p.key] = a
  }
  return out
}

export function answerWords(a: ConsentPurpose["answer"]): string {
  return a === "yes" ? "You said Yes" : a === "no" ? "You said No" : a === "withdrawn" ? "You said Yes, then withdrew it" : "Not answered"
}
