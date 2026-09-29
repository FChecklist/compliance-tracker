// Which envelope recipients this Worker accepts.
//
// With Email Routing's catch-all pointed at this Worker, EVERY address at
// veridian-aios.com lands here, including the random probes and dictionary
// spam a catch-all attracts. Accepting only the mailbox we publish keeps that
// out at the SMTP level (the sender's server gets a bounce) instead of
// creating a ticket and waking the operator for every "sales@" or "info@"
// guess.
//
// Accepted:
//   * dpdp@veridian-aios.com                   the published address
//   * dpdp+<anything>@veridian-aios.com        the Reply-To tags the platform
//                                              stamps on outbound mail
//   * grievance@veridian-aios.com              LEGACY alias, published before
//   * partners@veridian-aios.com               the single-mailbox decision;
//                                              still printed in old emails
//                                              and pages, so still answered
//   * postmaster@veridian-aios.com             RFC 2142 role mailboxes. Every
//   * abuse@veridian-aios.com                  mail system on the internet is
//                                              entitled to write to these two
//                                              (bounce diagnostics, spam and
//                                              abuse reports), so refusing
//                                              them at the SMTP level would
//                                              be a compliance defect of its
//                                              own. They are NOT ticketed: the
//                                              route is "forward_only" and the
//                                              handler hands the untouched
//                                              original to FALLBACK_FORWARD_TO.
//
// The two legacy aliases are rewritten to dpdp+grv@ / dpdp+prt@ before the
// payload is built, so the Edge Function's classifier (which reads the class
// from the plus-tag via parseRecipient) treats a mail to grievance@ as the
// grievance it is, with the highest-confidence rule, not by keyword guessing.
// The tags come from the shared taxonomy so they cannot drift from it.
//
// Honest limitation: an unknown +tag (dpdp+whatever@) is accepted. That is
// deliberate -- rejecting it would bounce a real customer's reply if a tag
// were ever renamed -- and the classifier simply ignores a tag it does not
// know.

import {
  CLASS_TAG,
  MAILBOX_DOMAIN,
  MAILBOX_LOCAL,
  parseRecipient,
} from "../../../supabase/functions/_shared/mail-taxonomy.ts"

/**
 * RFC 2142 role mailboxes we accept but do not ticket. Exact local part only:
 * postmaster+x@ and abuse+x@ are not role mailboxes and are refused like any
 * other unknown address (nobody publishes those, so a plus-tagged one is a
 * probe, not a person).
 */
export const FORWARD_ONLY_ROLES: readonly string[] = ["postmaster", "abuse"]

/** local-part of a legacy alias -> the plus-tagged address it is treated as. */
export const LEGACY_ALIASES: Readonly<Record<string, string>> = {
  grievance: `${MAILBOX_LOCAL}+${CLASS_TAG.grievance}@${MAILBOX_DOMAIN}`,
  partners: `${MAILBOX_LOCAL}+${CLASS_TAG.partner}@${MAILBOX_DOMAIN}`,
}

export type RecipientDecision =
  | {
      accepted: true
      /**
       * "ticket": parse, classify, ticket (the normal path).
       * "forward_only": an RFC 2142 role mailbox; forward the untouched original
       * to the operator and do nothing else.
       */
      route: "ticket" | "forward_only"
      /** Address to hand to the classifier: lower-cased, legacy aliases rewritten. */
      address: string
      /** Address as it arrived: lower-cased, brackets removed. */
      raw: string
      /** "grievance" | "partners" when a legacy alias was rewritten, else null. */
      legacyAlias: string | null
      /** "postmaster" | "abuse" when route is "forward_only", else null. */
      role: string | null
    }
  | { accepted: false }

// RFC 5321 caps a path at 256 octets. Anything longer is not a real mailbox.
const MAX_ADDRESS_LENGTH = 320

export function resolveRecipient(envelopeTo: string): RecipientDecision {
  if (typeof envelopeTo !== "string") return { accepted: false }
  const raw = envelopeTo.trim().toLowerCase().replace(/^<|>$/g, "")
  if (raw.length === 0 || raw.length > MAX_ADDRESS_LENGTH) return { accepted: false }

  if (parseRecipient(raw).ours) {
    return { accepted: true, route: "ticket", address: raw, raw, legacyAlias: null, role: null }
  }

  const at = raw.lastIndexOf("@")
  if (at > 0 && raw.slice(at + 1) === MAILBOX_DOMAIN) {
    const local = raw.slice(0, at)
    const rewritten = Object.hasOwn(LEGACY_ALIASES, local) ? LEGACY_ALIASES[local] : undefined
    if (rewritten) return { accepted: true, route: "ticket", address: rewritten, raw, legacyAlias: local, role: null }
    if (FORWARD_ONLY_ROLES.includes(local)) {
      return { accepted: true, route: "forward_only", address: raw, raw, legacyAlias: null, role: local }
    }
  }
  return { accepted: false }
}
