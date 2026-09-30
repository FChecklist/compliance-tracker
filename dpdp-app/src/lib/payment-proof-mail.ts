// The "Prefer email?" path of the billing widget (components/BillingPanel.tsx),
// kept in a plain module so a test can read it: BillingPanel only draws itself
// after an async call, so nothing about its link is reachable from a static render.
//
// WHERE THE MAIL GOES. To the ONE public address, dpdp@veridian-aios.com -- the
// single mailbox the whole product uses (supabase/functions/dpdp-inbound-mail
// reads it). It used to go to the owner's personal Gmail, which put a private
// address in front of every signed-in customer and kept payment proofs out of
// the ticket log.
//
// WHY THE SUBJECT STARTS "Invoice payment proof". The mail has no plus-tag (the
// visible address is the plain one, on purpose), so the inbound classifier
// (dpdp-inbound-mail/classify.ts) files it by keyword. "Invoice" and "payment"
// are both in its invoice rules, so a proof lands as an `invoice` ticket instead
// of `review`. src/lib/services/dpdp-mail-edge-functions.test.ts (repo root) runs
// the real classifier over exactly this subject and body, so if either side
// changes and they stop agreeing, that test fails. dpdp-app cannot import the
// classifier itself (its tsconfig has no allowImportingTsExtensions).
//
// The org id stays in both the subject and the body: it is how the owner matches
// a proof to an organisation, and the classifier does not care what follows the
// prefix.

/** The address every DPDP mail goes to. Must equal contact.contact_email in data/veridian-facts.yaml. */
export const PAY_EMAIL = "dpdp@veridian-aios.com"

/** The start of every payment-proof subject. Keep the words "Invoice" and "payment": the classifier keys on them. */
export const PAY_PROOF_SUBJECT_PREFIX = "Invoice payment proof"

export type PaymentProofMail = {
  orgId: string
  /** Already formatted for a person, e.g. "Rs 9,999". */
  amountLabel: string
  interval: "month" | "year"
  /** Whatever the customer typed in the UTR / reference box; may be empty. */
  reference: string
}

export function paymentProofSubject(orgId: string): string {
  return `${PAY_PROOF_SUBJECT_PREFIX} -- org ${orgId}`
}

export function paymentProofBody(m: PaymentProofMail): string {
  return `Org: ${m.orgId}\nAmount: ${m.amountLabel} (${m.interval}ly)\nReference: ${m.reference.trim() || "(attached separately)"}\n\n(attach your payment screenshot to this email)`
}

/** The mailto: URL behind "Prefer email?". */
export function paymentProofMailto(m: PaymentProofMail): string {
  return `mailto:${PAY_EMAIL}?subject=${encodeURIComponent(paymentProofSubject(m.orgId))}&body=${encodeURIComponent(paymentProofBody(m))}`
}
