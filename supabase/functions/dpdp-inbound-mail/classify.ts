// DPDP single mailbox -- the inbound classifier. PURE: no network, no Deno, no
// clock, no model. The same input always gives the same class, so a ruling the
// operator disagrees with can be reproduced from the stored row and fixed here.
//
// WHAT IT DECIDES. A message arrived at dpdp@veridian-aios.com (or at
// dpdp+<tag>.<ref>@, which Cloudflare delivers to the same rule). Which of the
// eleven MailClass values (mail-taxonomy.ts) is it? FIRST MATCH WINS, in this order:
//
//   0. self     the sender is our own mailbox -> auto (loop guard: an operator
//               address that is itself dpdp@ would otherwise notify itself forever).
//   1. machine  MACHINE-ONLY signals: a MAILER-DAEMON / postmaster sender, an empty
//               Return-Path, a delivery-status / multipart-report / disposition-
//               notification content type -> auto. Evaluated BEFORE the plus-tag and
//               NEVER escalated: a bounce that quotes our mail (or a person's words
//               inside it) is a bounce.
//   2. headers  HEADER-BASED auto signals: Auto-Submitted other than "no", X-Autoreply
//               (and X-Autorespond), Precedence bulk / auto_reply / junk, an "out of
//               office" / "automatic reply" style subject, and our own X-Veridian-Origin
//               header but ONLY when a thread match corroborates it (anyone can type that
//               header, so on its own it means nothing). Evaluated BEFORE the plus-tag,
//               so a vacation reply to the Monday digest (which arrives at dpdp+mon.<ref>@)
//               is auto and stops notifying the operator every Monday. These headers are
//               chosen by the SENDER, though, so they cannot hide a legal request: if the
//               unquoted text carries a data_request or grievance keyword the message is
//               ESCALATED (below) instead of being filed as auto.
//               One exception, on purpose: when the tag names a legal-clock class
//               (grv / dsr / rev) and the message is NOT a reply to one of our own
//               acknowledgements (an outbound row with a ticket number, or of a legal-clock
//               class), the sender addressed a legal channel deliberately (the legacy
//               grievance@ alias is rewritten to dpdp+grv@; the List-Unsubscribe mailto of
//               a digest is dpdp+dsr.<ref>@, whose ref matches the MONDAY row), so the
//               header does not divert it to auto; it is filed under the tag, the operator
//               is told, and no acknowledgement is sent to a message that carries auto-mail
//               headers. A reply to our own acknowledgement IS diverted: that is the
//               auto-responder loop.
//   a. tag      the recipient's plus-tag names a class (highest confidence). A
//               `sal` tag on a message that answers something we sent is the
//               sales_chain class, not sales. An `aut` tag is IGNORED: anyone can
//               type dpdp+aut@, and auto is the one class that is logged without
//               telling the operator, so the tag alone must not be able to hide a
//               message.
//   b. thread   In-Reply-To / References carries a Message-ID we sent (the caller
//               looked it up; this function does no IO) -> inherits that row's
//               class ("sales" -> "sales_chain").
//   d. keyword  subject + the first 4096 characters of the text (quoted lines
//               removed), English AND Hindi / Hinglish, in this order:
//               data_request, grievance, invoice, partner, sales, support.
//   e. default  review.
//
// ESCALATION (the owner's core requirement: a legal request must never miss its clock
// or its acknowledgement, whatever tag it arrived on, whatever thread it belongs to,
// whatever headers it carries). When the class chosen by a, b or d is NOT a legal-clock
// class (grievance, data_request, review), or when a header-based auto signal (2) chose
// auto, ONLY the data_request and grievance keyword rules are run over what the person
// actually wrote: the body with quoted lines, "On ... wrote:" and everything after it,
// "-----Original Message-----", Outlook "From: / Sent: / To: / Subject:" blocks and our
// own footer boilerplate removed (stripQuoted), plus the subject. A subject that carries our own
// "[VERIDIAN DPDP" prefix is an echo of ours (ours contain words such as "escalated" and
// "Data Protection Board", and the acknowledgement label "DATA REQUEST"), so only the
// data_request rules are run on it, with the bracketed prefix cut off (matchEscalation).
// A hit raises the class to that legal class and
// keeps where it came from in the reason: 'tag:mon; escalated keyword:data_request:"..."'.
// So a reply to the Monday digest that says "Please stop sending me these emails. Delete
// my data." is a data_request, a reply on an invoice thread that says "I want to file a
// complaint" is a grievance, and a plain "thanks for the invoice" stays an invoice.
// The same escalation has one more outcome: when NO keyword hit and the person wrote nothing of their own above
// the quote (everything is quoted, or sits below an "On ... wrote:" line: a reply typed BELOW the original, as
// Thunderbird does by default, or interleaved with it), the message is not read, so it cannot be told from an empty
// reply; it becomes `review` (nothingAboveTheQuote), never the class of its tag. The same goes for a reply written in a
// script the keyword rules have no words for (Bengali to Sinhala, Arabic / Urdu; UNREAD_SCRIPT): a person reads it.
//
// SAFETY RULE: nothing is silently dropped or demoted. `review` is a legal-clock class,
// acknowledged and always notified; `auto` is the only class logged without a notice, so
// it is deliberately hard to reach: a sender we are sure is a machine (self, machine
// signals), or a sender-controlled auto header with no legal keyword in what was written.
// X-Auto-Response-Suppress is NOT an auto signal: it is a hint the sender sets about how
// others should answer THEM, not proof that the message is automatic.
//
// Deliberately over-inclusive keyword lists: a false data_request costs the
// operator one ticket; a missed one costs a statutory clock. Hindi terms are
// matched without \b (JavaScript's \b only knows ASCII word characters).
import { CLASS_TAG, LEGAL_CLOCK_CLASSES, parseRecipient, type MailClass } from "../_shared/mail-taxonomy.ts"

/** Characters of body text the keyword rules read. */
export const KEYWORD_WINDOW_CHARS = 4096

/** The outbound row (dpdp.mail_outbound) a reply was matched to, looked up by the caller. */
export type OutboundMatch = {
  ref: string
  cls: MailClass
  ticketNo?: string | null
  matchedBy?: "ref" | "message_id"
}

export type ClassifyInput = {
  /** Envelope recipient first, then the To / Cc header addresses. Display names are tolerated. */
  recipients: string[]
  /** Every sender address known: envelope MAIL FROM, header From, Return-Path. */
  senders: string[]
  subject: string
  text: string
  /** Header names lower-cased. */
  headers: Record<string, string>
  contentType?: string
  outbound?: OutboundMatch | null
}

export type ClassificationRule = "self" | "tag" | "thread" | "auto" | "keyword" | "escalation" | "default"

export type Classification = {
  cls: MailClass
  rule: ClassificationRule
  confidence: "high" | "medium" | "low"
  /** Stored as dpdp.mail_inbound.classifier_reason. Never contains message text beyond a short matched phrase. */
  reason: string
  /** The ref read from the recipient's plus-tag, whatever class was finally chosen. */
  tagRef: string | null
  /**
   * Every auto-mail signal present, machine-only and header-based, whatever class was chosen. Non-empty => never
   * acknowledge, EXCEPT when `escalatedFrom` is set (a legal request is acknowledged whatever headers it carries;
   * ackBlocker in handler.ts still refuses a header-flagged reply to our own acknowledgement).
   */
  autoSignals: string[]
  /** A machine-only signal (a bounce, a delivery report) was present. Such a message is never escalated. (Named for the old "strong signal" it replaces.) */
  strongAuto: boolean
  /**
   * Set when the escalation raised the class to data_request / grievance: the class the tag, the thread or the auto
   * signal had chosen first ("auto" for a header-based auto signal). null otherwise.
   */
  escalatedFrom: MailClass | null
}

// ---------------------------------------------------------------------------
// Small parsers (exported: the handler and the tests use them).
// ---------------------------------------------------------------------------

/** "Asha <Asha@Example.org>" -> "asha@example.org"; "" when there is no address. */
export function bareAddress(value: string): string {
  const angle = /<([^<>]*)>/.exec(value)
  const raw = (angle ? angle[1] : value).trim().replace(/^["']+|["',;]+$/g, "").toLowerCase()
  return raw.includes("@") && !/\s/.test(raw) ? raw : ""
}

/** "<AbC@Host>" -> "abc@host". The same normalisation the migration applies to stored ids. */
export function normalizeMessageId(value: string): string {
  return value.trim().replace(/^<+|>+$/g, "").trim().toLowerCase()
}

/** Every <message-id> in In-Reply-To / References, normalised, unique, at most `max`, newest reference first. */
export function extractMessageIds(values: Array<string | null | undefined>, max = 20): string[] {
  const out: string[] = []
  for (const v of values) {
    if (!v) continue
    const found = v.match(/<[^<>\s]+>/g) ?? []
    // References lists oldest first; the message being replied to is last.
    for (const token of found.reverse()) {
      const id = normalizeMessageId(token)
      if (id && !out.includes(id)) out.push(id)
      if (out.length >= max) return out
    }
  }
  return out
}

/**
 * Lines that are OUR OWN boilerplate, recognised by their fixed wording (render.ts footers and the acknowledgement in
 * handler.ts). A mail client or auto-responder that echoes one of our messages without ">" quoting or a reply marker
 * would otherwise hand the keyword rules our own words ("Stop these weekly emails", an unsubscribe URL). Only the line
 * itself is dropped, so a person's own text on other lines is still read.
 */
const OWN_BOILERPLATE: readonly RegExp[] = [
  /stop these weekly emails/i,
  /this is a statutory notice; it is sent even if you have stopped/i,
  /for india, by india|built for india's dpdp act/i,
  /one portal\.\s*one truth\./i,
  /know a firm that needs this|bring a colleague onto your team/i,
  /dpdp-monday-email\?action=unsubscribe/i,
  /this link works for 24 hours/i,
  /press ["'\u2018\u2019\u201c\u201d]send me a new link["'\u2018\u2019\u201c\u201d]/i,
  /^open my page\s*:/i,
  /we received your message to veridian ai dpdp/i,
  /this is an automatic acknowledgement/i,
  /^-{2}\s*veridian ai dpdp\s*$/i,
]

const WROTE_LINE = /^on\s.{5,300}\swrote:\s*$/i
const HEADER_LINE = /^(?:sent|date|to|cc|subject)\s*:/i

/**
 * Keeps what the person WROTE and drops everything that is somebody else's words, so our own template text in a reply
 * cannot be mistaken for it: lines starting with ">", everything from an "On ... wrote:" line (also when the mail
 * client wrapped it over two lines), an "-----Original Message-----" / "Forwarded message" line, a long underscore
 * rule, or an Outlook header block ("From:" followed by two more of Sent / Date / To / Cc / Subject), and, line by
 * line, our own footer boilerplate (OWN_BOILERPLATE). If nothing is left the caller falls through to `review`, which
 * is the safe class.
 *
 * Trade-off, stated: everything AFTER a reply marker is dropped, as it always was, so an answer typed BELOW the
 * quoted original ("bottom-posting") is not read, which is a possible miss. Reading the quoted original instead
 * would put our own words ("escalated to you", an unsubscribe link) into every reply and turn every vacation reply
 * into a ticket, which is exactly what this design exists to stop. Bottom-posting with no marker at all is still read.
 */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/)
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (WROTE_LINE.test(t)) break
    if (/^on\s/i.test(t) && i + 1 < lines.length && WROTE_LINE.test(`${t} ${lines[i + 1].trim()}`)) break
    if (/^-{2,}\s*(?:original message|forwarded message)\s*-{2,}/i.test(t)) break
    if (/^_{20,}$/.test(t)) break
    if (/^from\s*:/i.test(t)) {
      let more = 0
      for (let j = i + 1; j < Math.min(lines.length, i + 7); j++) if (HEADER_LINE.test(lines[j].trim())) more++
      if (more >= 2) break
    }
    if (t.startsWith(">")) continue
    if (OWN_BOILERPLATE.some((re) => re.test(t))) continue
    kept.push(line)
  }
  return kept.join("\n")
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const v = headers[name]
  return typeof v === "string" ? v : undefined
}

// ---------------------------------------------------------------------------
// Auto-mail signals.
// ---------------------------------------------------------------------------

const AUTO_SENDER_LOCALS = new Set(["mailer-daemon", "postmaster"])

// An auto-reply or bounce subject names itself at the START ("Automatic reply: ...", "Out of Office: ...", "Undeliverable: ...",
// "Delivery Status Notification (Failure)"), possibly behind Re: / Fwd: / AW:. Anchored on purpose: the same words in the MIDDLE of
// a person's subject ("Undelivered invoice - not received", "Support needed out of office hours", "Do you support auto-reply
// templates?") are ordinary mail, and the subject is the one header a human types, so an unanchored match filed real enquiries as
// `auto` (logged, nobody told) on the strength of three words (found in the review of the classifier, 2026-09-29).
const AUTO_SUBJECT =
  /^[\s[(*]*(?:(?:re|fwd?|aw|wg|sv|antw)\s*:\s*)*(?:out[\s-]of[\s-](?:the[\s-])?office|automatic(?:ally)?\s+repl(?:y|ies)|auto[\s-]?repl(?:y|ies)|autoreply|undeliver(?:able|ed\s+mail)|delivery\s+(?:status\s+notification|failure|has\s+failed)|mail\s+delivery\s+(?:failed|subsystem)|returned\s+mail|failure\s+notice|away\s+from\s+(?:the\s+)?office|automatische\s+antwort|abwesenheit|r[ée]ponse\s+automatique|respuesta\s+autom[aá]tica|risposta\s+automatica)\b/i

/**
 * `machine`: signals only a mail system produces (a bounce or delivery report). `header`: signals the SENDER chooses,
 * so a person can type them on a real request; see the header comment for why these escalate and `machine` does not.
 * `threadMatched` is true when the caller found an outbound message of ours that this one answers; only then does
 * our own X-Veridian-Origin header count.
 */
export function autoSignals(
  input: Pick<ClassifyInput, "senders" | "subject" | "headers" | "contentType"> & { threadMatched?: boolean },
): { machine: string[]; header: string[] } {
  const machine: string[] = []
  const header: string[] = []
  const h = input.headers

  for (const s of input.senders) {
    const local = bareAddress(s).split("@")[0]
    if (AUTO_SENDER_LOCALS.has(local)) { machine.push(`sender ${local}`); break }
  }

  const returnPath = headerValue(h, "return-path")
  if (returnPath !== undefined && returnPath.trim().replace(/\s+/g, "") === "<>") machine.push("empty Return-Path")

  const contentType = (input.contentType ?? headerValue(h, "content-type") ?? "").toLowerCase()
  if (/multipart\/report|message\/delivery-status|message\/disposition-notification/.test(contentType)) machine.push("delivery-status content type")

  // "Auto-Submitted != no", as specified: a present header whose first token is anything but "no" (an empty value included) is auto.
  const autoSubmitted = headerValue(h, "auto-submitted")
  if (autoSubmitted !== undefined) {
    const token = autoSubmitted.trim().toLowerCase().split(/[;\s]/)[0]
    if (token !== "no") header.push(`Auto-Submitted=${token || "(empty)"}`)
  }

  for (const name of ["x-autoreply", "x-autorespond", "x-auto-reply"]) {
    if (headerValue(h, name) !== undefined) { header.push(name); break }
  }

  const precedence = headerValue(h, "precedence")?.trim().toLowerCase()
  if (precedence === "auto_reply" || precedence === "auto-reply" || precedence === "autoreply" || precedence === "bulk" || precedence === "junk") header.push(`Precedence=${precedence}`)

  if (AUTO_SUBJECT.test(input.subject)) header.push("auto-reply style subject")

  // Our own header counts only when a message of ours is really being answered: without that, it is a header anyone can add.
  if (headerValue(h, "x-veridian-origin") !== undefined && input.threadMatched === true) header.push("x-veridian-origin (our own automatic mail, thread matched)")

  return { machine, header }
}

// ---------------------------------------------------------------------------
// Keyword rules. The haystack is NFKC-normalised and lower-cased, so no `i` flag.
// ---------------------------------------------------------------------------

const rx = (...sources: string[]) => new RegExp(sources.join("|"))

const KEYWORD_RULES: ReadonlyArray<{ cls: MailClass; re: RegExp }> = [
  {
    cls: "data_request",
    re: rx(
      // English
      "\\bunsubscrib",
      "\\bstop\\s+(?:sending|emailing|mailing|contacting|messaging)",
      "\\b(?:withdraw|revok|retract)\\w*\\s+(?:of\\s+)?(?:my\\s+|our\\s+|the\\s+)?consent",
      "\\bconsent\\s+(?:withdrawal|withdrawn|revoked)",
      "\\b(?:delete|deleting|remove|removing|erase|erasing|wipe|destroy)\\s+(?:all\\s+)?(?:of\\s+)?(?:my|our|the)\\s+(?:personal\\s+)?(?:data|information|details|account|records?|profile|emails?)",
      "\\b(?:delete|erase|remove)\\s+me\\b",
      "\\berasure\\b|\\berase\\b|\\berasing\\b",
      "\\bright\\s+to\\s+(?:be\\s+forgotten|erasure|deletion)",
      "\\baccess\\s+(?:to\\s+)?(?:my|our)\\s+(?:personal\\s+)?(?:data|information|details)",
      "\\bcopy\\s+of\\s+(?:my|our)\\s+(?:personal\\s+)?(?:data|information)",
      "\\bdata\\s+(?:access|portability|principal)\\b",
      "\\bsubject\\s+access\\s+request",
      // "Data request" is one of the four subject topics the public copy asks people to use (dpdp-app/data/veridian-facts.yaml,
      // contact.subject_topics), so it must land here on its own, with no other keyword needed. Also the plain "forget me" and
      // "delete the data you hold about me" forms, which the "my data" patterns above miss.
      "\\bdata\\s+(?:subject\\s+)?requests?\\b",
      "\\b(?:delete|erase|remove|wipe)\\s+(?:all\\s+)?(?:the\\s+|any\\s+)?(?:data|information|details|records?)\\b[^\\n.]{0,60}\\b(?:about|of|on|regarding|concerning)\\s+(?:me|us)\\b",
      "\\bforget\\s+(?:me|us)\\b",
      "\\bwhat\\s+(?:personal\\s+)?(?:data|information)\\s+(?:do\\s+you|you)\\s+(?:have|hold|store|keep)",
      "\\b(?:correct|rectify|amend|update)\\s+(?:my|our)\\s+(?:personal\\s+)?(?:data|information|details|records?)",
      "\\bcorrection\\s+(?:of|to)\\s+(?:my|our)",
      "\\bopt[\\s-]?out\\b",
      "\\bremove\\s+me\\s+from",
      "\\btake\\s+me\\s+off",
      "\\b(?:do\\s+not|don'?t)\\s+(?:contact|email|mail|call|message)\\s+me",
      // Short withdrawals and rights requests, as people really type them in a reply to the Monday digest or a statutory notice
      // (review of the hardening pass, 2026-09-29: "Stop.", "No more emails", "Please don't send me these" all fell through to the
      // `monday` / `clock` class of the tag, i.e. no ticket letter D, no due date, no acknowledgement).
      "(?:^|\\n)[^a-z0-9\\n]*stop[^a-z0-9\\n]*(?=\\n|$)",
      "\\bplease\\s+stop\\b(?=\\s*(?:[.!,;:?)]|\\n|$))",
      "\\bstop\\s+(?:these|those|them|all|it\\s+now)\\b|\\bstop\\s+(?:this|the)\\s+(?:e-?mails?|mails?|messages?|newsletters?|digests?|updates?|notifications?|spam)\\b",
      "\\bno\\s+more\\s+(?:e-?mails?|mails?|messages?|newsletters?|digests?|updates?|communications?|notifications?|spam)\\b",
      // "don't send me the invoice again" is a billing remark, not a withdrawal: the object of send / email / mail is not read as one.
      "\\b(?:do\\s+not|don'?t|dont)\\s+(?:send|email|mail)\\s+(?:me|us)\\b(?!\\s+(?:the|a|an|my|our|your|that)\\b)",
      "\\b(?:do\\s+not|don'?t|dont)\\s+(?:share|sell|disclose|transfer|forward)\\s+(?:my|our)\\b",
      "\\b(?:do\\s+not|don'?t|dont)\\s+(?:wish|want|need)\\s+(?:to\\s+)?(?:receive|get|hear|be\\s+contacted)",
      "\\b(?:do\\s+not|don'?t|dont)\\s+(?:wish|want|need)\\s+(?:any\\s+|more\\s+|these\\s+|this\\s+|those\\s+|your\\s+|the\\s+)?(?:e-?mails?|mails?|messages?|newsletters?|digests?|updates?|communications?)\\b",
      "\\bno\\s+longer\\s+(?:wish|want|need)\\s+(?:to\\s+)?(?:receive|get|hear)",
      "\\bdiscontinue\\s+(?:sending|these|this|those|all|my|our|the)\\b[^\\n.]{0,30}\\b(?:e-?mails?|mails?|messages?|newsletters?|digests?|communications?|subscription|sending)\\b",
      "\\b(?:never|didn'?t|did\\s+not)\\s+(?:subscrib(?:e|ed)|sign(?:ed)?\\s+up)\\b",
      "\\bunsub\\b",
      "\\bcancel\\s+(?:my|our|the)\\s+(?:subscription|e-?mails?|newsletter)",
      "\\b(?:close|deactivate)\\s+(?:my|our)\\s+account\\b",
      "\\b(?:data|account|information)\\s+(?:deletion|removal|erasure)\\b",
      // Access to what is held. "you have" alone is too common in business mail ("the records you have"), so it needs "about / on me".
      "\\b(?:data|information|details|records?)\\s+(?:that\\s+)?you\\s+(?:(?:hold|store|keep|collect|process)\\b|have\\s+(?:about|on)\\s+(?:me|us)\\b)",
      "\\byou(?:r\\s+(?:company|team|firm))?\\s+(?:hold|store|keep|collect|process)\\s+(?:any\\s+)?(?:of\\s+)?(?:my|our)\\s+(?:personal\\s+)?(?:data|information|details)",
      "\\bdo\\s+you\\s+have\\s+(?:any\\s+)?(?:of\\s+)?(?:my|our)\\s+(?:personal\\s+)?(?:data|information|details)",
      "\\b(?:my|our)\\s+(?:personal\\s+)?(?:data|information|details)\\s+back\\b",
      "\\bobject\\s+to\\s+(?:the\\s+|my\\s+|our\\s+)?(?:processing|use|collection|sharing)\\b|\\bobjection\\s+to\\s+(?:the\\s+)?processing\\b",
      "\\bnominat(?:e|ion)\\b[^\\n.]{0,60}\\b(?:dpdp|data\\s+principal|the\\s+act)\\b",
      "\\b(?:correct|rectify|amend|update|change|fix)\\s+(?:my|our)\\s+(?:[a-z]+\\s+){0,2}(?:name|number|phone|mobile|address|e-?mail|contact|details|information|data|birth)\\b[^\\n.]{0,40}\\b(?:in|from)\\s+your\\s+(?:records?|system|database|files?)\\b",
      // More withdrawals, objections and rights requests as people type them (second review of the classifier, 2026-09-29: each of these,
      // sent as a reply to the Monday digest, stayed `monday`: no D- ticket, no due date, no acknowledgement).
      "\\b(?:do\\s+not|don'?t|dont|never)\\s+consent\\b|\\bwithout\\s+(?:my|our)\\s+(?:consent|permission)\\b|\\bno\\s+longer\\s+consent",
      "\\b(?:do\\s+not|don'?t|dont)\\s+(?:use|process|share|sell|store|disclose|market)\\s+(?:my|our)\\b",
      "\\b(?:stop|cease|halt|discontinue)\\s+(?:using|processing|sharing|selling|storing|holding|collecting)\\s+(?:all\\s+)?(?:of\\s+)?(?:my|our)\\b|\\b(?:cease|halt)\\s+processing\\b",
      "\\b(?:remove|delete|erase|wipe)\\s+(?:my|our)\\s+(?:name|number|phone|mobile|contact|address|entry|e-?mail\\s+(?:id|address))\\b",
      "\\bunlist\\s+(?:me|us)\\b|\\bleave\\s+(?:me|us)\\s+alone\\b|\\btake\\s+(?:my|our)\\s+(?:e-?mail|name|number|id|address|contact)\\s+off\\b",
      "\\b(?:never|don'?t|do\\s+not|dont)\\s+(?:contact|call|e-?mail|mail|message|text|write\\s+to)\\b[^\\n.]{0,15}\\b(?:again|anymore|any\\s+more|further)\\b|\\bnever\\s+(?:contact|call|e-?mail|mail|message|text)\\s+(?:me|us)\\b",
      "\\bexercis(?:e|ing)\\s+(?:my|our)\\s+(?:data\\s+)?rights?\\b|\\b(?:my|our)\\s+rights?\\s+(?:as\\s+a\\s+data\\s+principal|under\\s+(?:the\\s+)?(?:dpdp|digital\\s+personal))",
      // Hinglish
      "\\bmer[ae]\\s+(?:e-?mail|mail|number|no\\.?|phone|mobile|naam|name)(?:\\s+id)?\\s+(?:ko\\s+)?(?:hata|hatao|mita|mitao|delete|remove)",
      "\\bmer[ae]\\s+data\\s+(?:delete|hata|hatao|mita|mitao|erase|remove)",
      "\\bdata\\s+(?:delete|hata|hatao|mita|mitao|remove)\\s*(?:kar|karo|kijiye|kariye|do|dijiye)",
      "\\bmeri\\s+(?:jaankari|jankari|information|details?)\\s+(?:delete|hata|hatao|mita|mitao)",
      "\\b(?:mail|email|emails|mails|message|messages|sms)\\s+(?:bhejna|bhejni|bhejana|bhejne)\\s+band",
      "\\b(?:mail|email|emails|mails|message|messages)\\s+(?:mat|na)\\s+bhej",
      "\\bbhejna\\s+band\\b",
      "\\bunsubscribe\\s+kar",
      "\\b(?:sahmati|consent|anumati)\\s+(?:wapas|vapas|wapis)",
      "\\b(?:mail|email|emails|mails|message|messages|newsletter)\\s+(?:sab\\s+)?(?:band|bandh)\\s+(?:kar|karo|kardo|kijiye|kariye|dijiye|do)\\b",
      "\\b(?:mail|email|emails|mails|message|messages)\\b[^\\n.]{0,30}\\b(?:nahi|nahin|nhi)\\s+chahiye",
      "\\b(?:mujhe|humein|hame)\\s+(?:mera|meri|apna|apni|apne)\\s+(?:data|jaankari|jankari)\\b",
      // Hindi (Devanagari)
      "(?:मेरा|मेरी|मेरे)\\s*(?:नंबर|नम्बर|ईमेल|ई-मेल|मेल|नाम|पता)\\s*(?:को\\s*)?(?:हटा|मिटा|डिलीट|निकाल)",
      "(?:मुझे|हमें)\\s*(?:ईमेल|ई-मेल|मेल|संदेश|मैसेज)\\s*(?:न|मत|नहीं)\\s*भेज|(?:ईमेल|ई-मेल|मेल|संदेश|मैसेज)\\s*(?:मत|न)\\s*भेज",
      "(?:इसे|इन्हें|यह|ये)\\s*बंद\\s*(?:कर|करें|करो|कीजिए|कीजिये)|मुझे\\s*(?:ये|यह|इसकी|इन)\\s*(?:नहीं|नही)\\s*चाहिए",
      "(?:मेल|ईमेल|ई-मेल|संदेश|मैसेज)[^\\n.]{0,25}(?:नहीं\\s*चाहिए|नही\\s*चाहिए|बंद\\s*(?:कर|करो|करें|कीजिए|कीजिये))",
      "मुझे\\s*(?:मेरा|मेरी|अपना|अपनी)\\s*(?:डेटा|डाटा|जानकारी)",
      // Marathi shares the script: "माझा डेटा हटवा" / "माझी माहिती काढून टाका"
      "(?:डेटा|डाटा|माहिती)\\s*(?:हटव|काढून\\s*टाक|पुसून\\s*टाक)",
      "अनुमति\\s*(?:वापस|रद्द)",
      "(?:डेटा|डाटा)\\s*(?:को\\s*)?(?:हटा|डिलीट|मिटा)",
      "(?:मेरी|मेरे)\\s*(?:जानकारी|डेटा|डाटा|विवरण)\\s*(?:को\\s*)?(?:हटा|मिटा|डिलीट)",
      "(?:ईमेल|मेल|ई-मेल|संदेश)\\s*भेजना\\s*बंद",
      "भेजना\\s*बंद\\s*कर",
      "सहमति\\s*(?:वापस|रद्द|हटा)",
      "अनसब्सक्राइब",
      "सदस्यता\\s*(?:रद्द|समाप्त)",
      "सूची\\s*से\\s*(?:हटा|निकाल)",
    ),
  },
  {
    cls: "grievance",
    re: rx(
      "\\bgrievance",
      "\\bcomplain",
      "\\bbreach",
      "\\bmisus",
      "\\bharass",
      "\\bnot\\s+(?:respond|reply|repli|answer)(?:ing|ed)?",
      "\\bno\\s+(?:response|reply|answer)\\b",
      "\\bunresponsive",
      "\\bnever\\s+(?:replied|responded|answered)",
      "\\byou\\s+(?:haven'?t|hasn'?t|didn'?t)\\s+(?:replied|responded|answered|reply|respond|answer)\\b",
      "\\bescalat",
      "\\blegal\\s+(?:notice|action|proceedings)",
      "\\bdata\\s+protection\\s+board",
      "\\bconsumer\\s+(?:court|forum)",
      "\\bviolat(?:e|ed|es|ion|ions|ing)\\b",
      "\\bfraud",
      "\\bscam\\b",
      // A person chasing a request we did not answer, or reporting that their data got out (the same review, 2026-09-29).
      "\\bignor(?:ed|ing)\\b",
      "\\bstill\\s+(?:no|not|waiting)\\b",
      "\\b(?:second|third|fourth|fifth|\\d+(?:st|nd|rd|th))\\s+time\\s+(?:i|we)\\b|\\b(?:second|third|fourth|fifth|\\d+(?:st|nd|rd|th))\\s+(?:reminder|request|attempt|follow[\\s-]?up)\\b",
      "\\b(?:approach|approaching|file|filing|lodge|lodging)\\s+(?:a\\s+|the\\s+)?(?:court|police|case|lawsuit|litigation)\\b",
      "\\b(?:my|our)\\s+(?:personal\\s+)?(?:data|information|details)\\b[^\\n.]{0,40}\\b(?:leaked|stolen|exposed|hacked|compromised)\\b",
      "\\b(?:leaked|hacked)\\b[^\\n.]{0,30}\\b(?:my|our)\\s+(?:personal\\s+)?(?:data|information|details)",
      // Hinglish
      "\\bs(?:h)?ikaa?yat",
      "\\b(?:reply|response|jawab|javab|uttar)\\s+(?:nahi|nahin|nhi)",
      "\\b(?:ignore|anadekha|andekha)\\s*(?:kiya|kiye|kar)",
      "\\bmeri\\s+baat\\s+(?:nahi|nahin|nhi)\\s+suni",
      // Dissatisfaction and chasing, in words that are not "complaint" (second review of the classifier, 2026-09-29). Not bare "no action":
      // "no action needed" is in half of all business replies.
      "\\b(?:this|that|it)\\s+(?:is|was)\\s+(?:completely\\s+|totally\\s+|absolutely\\s+|simply\\s+)?unacceptable\\b",
      "\\btake\\s+(?:this|it|the\\s+matter)\\s+(?:further|up)\\b|\\bpursue\\s+(?:this|the\\s+matter|legal)",
      "\\bwhere\\s+is\\s+(?:my|the)\\s+(?:response|reply|answer|resolution)\\b",
      "\\bno\\s+(?:action|steps?)\\s+(?:has\\s+been\\s+|have\\s+been\\s+|was\\s+|were\\s+)?taken\\b",
      // A threat, or a report to the authority (not "advocate" / "lawyer" alone: that word is in half the signatures this audience has).
      "\\b(?:will|shall|going\\s+to|gonna)\\s+sue\\b",
      "\\b(?:my|our)\\s+(?:lawyer|advocate|attorney|counsel|legal\\s+(?:team|advisor|adviser))\\b",
      "\\bcyber\\s*crime\\b|\\bdpb\\b|\\bmeity\\b",
      "\\b(?:kanooni|kanuni|qanooni)\\s+notice",
      "\\bdhokh?a",
      // Hindi (Devanagari)
      "शिकायत",
      "(?:जवाब|उत्तर)\\s*नहीं",
      "कानूनी\\s*(?:नोटिस|कार्रवाई|कार्यवाही)",
      "उपभोक्ता\\s*(?:न्यायालय|फोरम|अदालत)",
      "अनदेखा",
      "लीक\\s*(?:हो|कर)",
      "उल्लंघन",
      "दुरुपयोग",
      "धोखा",
      "उत्पीड़न",
    ),
  },
  {
    cls: "invoice",
    re: rx(
      "\\binvoic",
      "\\bpayments?\\b",
      "\\breceipts?\\b",
      "\\bgst(?:in)?\\b",
      "\\brefunds?\\b",
      "\\bbilling\\b",
      "\\bbills?\\b",
      "\\bcredit\\s+note",
      "\\butr\\b",
      "\\bpaid\\b",
      // Hinglish
      "\\bbhugtan\\b",
      "\\bpaisa\\b|\\bpaise\\b",
      "\\brasid\\b",
      // Hindi (Devanagari). "बिल" is a prefix of "बिलकुल" (absolutely), so that word is excluded.
      "भुगतान",
      "रसीद",
      "बिल(?!कुल)",
      "चालान",
      "रिफंड",
      "पैसे|पैसा",
      "जीएसटी",
      "इनवॉइस",
    ),
  },
  {
    cls: "partner",
    re: rx(
      "\\bpartner",
      "\\bresell",
      "\\breferral",
      "\\bwhite[\\s-]?label",
      "\\bcollaborat",
      "\\bdistribut(?:or|ors|ion)\\b",
      "\\bjoint\\s+venture",
      "\\bfranchis",
      "\\bsaajhedaar|\\bsajhedar",
      "साझेदार",
      "पार्टनर",
      "रिसेलर",
    ),
  },
  {
    cls: "sales",
    re: rx(
      // "Sales" is one of the four subject topics the public copy asks people to use. Anchored to the START of the subject
      // (through any Re:/Fwd:) so the bare word in a signature or a sentence does not pull an unclassifiable, legal-clock
      // `review` message down into `sales`.
      "^\\s*(?:(?:re|fwd?)\\s*:\\s*)*sales\\b",
      "\\bpricing\\b",
      "\\bquot(?:e|es|ed|ation|ations)\\b",
      "\\bdemo\\b",
      "\\bplans\\b",
      "\\bprices?\\b",
      "\\bbuy(?:ing)?\\b",
      "\\btrials?\\b",
      "\\b[ei]nquir",
      "\\bpurchas",
      "\\binterested\\s+in\\b",
      "\\bhow\\s+much\\b",
      "\\bbrochure",
      "\\bproposal\\b",
      // Hinglish
      "\\bkimat\\b|\\bkeemat\\b|\\bmulya\\b",
      "\\bkitn[ae]\\s+(?:ka|ki|lagega|paisa|kharcha)",
      "\\bkharid",
      // Hindi (Devanagari)
      "कीमत",
      "मूल्य",
      "खरीद",
      "डेमो",
      "ट्रायल",
      "प्लान",
      "कोटेशन",
    ),
  },
  {
    cls: "support",
    re: rx(
      "\\bhelp\\b",
      "\\berrors?\\b",
      "\\blog[\\s-]?in\\b",
      "\\bsign[\\s-]?in\\b",
      "\\bnot\\s+working\\b",
      "\\b(?:does(?:n'?t|\\s+not)|didn'?t|isn'?t)\\s+work",
      "\\bbugs?\\b",
      "\\b(?:can'?t|cannot)\\s+(?:log|access|open|see|find)",
      "\\bissues?\\b",
      "\\bproblems?\\b",
      "\\bpassword\\b",
      "\\bcrash",
      "\\bstuck\\b",
      // Hinglish
      "\\bmadad\\b",
      "\\bkaam\\s+nahi(?:n)?\\s+kar",
      "\\bchal\\s+nahi(?:n)?\\s+raha",
      "\\bsamasya\\b",
      "\\bkhul\\s+nahi",
      // Hindi (Devanagari)
      "मदद",
      "काम\\s*नहीं\\s*कर",
      "समस्या",
      "एरर",
      "लॉग\\s*इन",
      "पासवर्ड",
    ),
  },
]

function keywordHaystack(subject: string, text: string): string {
  const body = stripQuoted(text).slice(0, KEYWORD_WINDOW_CHARS)
  // Typographic apostrophes become the plain one: an iPhone or an Android keyboard types "don’t" (U+2019) by default, which
  // the `don'?t` rules would otherwise never match (found in the review of the hardening pass, 2026-09-29).
  return `${subject}\n${body}`.normalize("NFKC").toLowerCase().replace(/[\u2018\u2019\u201b\u2032\u02bc`]/g, "'")
}

/**
 * First keyword rule that matches, in the specified order, with the phrase that matched (at most 40 characters).
 * `only` restricts the rules that are run (the order is unchanged): the escalation runs data_request and grievance alone.
 */
export function matchKeywords(subject: string, text: string, only?: readonly MailClass[]): { cls: MailClass; phrase: string } | null {
  const hay = keywordHaystack(subject, text)
  for (const rule of KEYWORD_RULES) {
    if (only && !only.includes(rule.cls)) continue
    const m = rule.re.exec(hay)
    if (m) return { cls: rule.cls, phrase: m[0].replace(/\s+/g, " ").slice(0, 40) }
  }
  return null
}

// ---------------------------------------------------------------------------
// The classifier.
// ---------------------------------------------------------------------------

function inheritClass(outbound: MailClass): MailClass {
  return outbound === "sales" ? "sales_chain" : outbound
}

/**
 * The plus-tag: the first of OUR addresses among the recipients that names a class. A ref on its own
 * (dpdp+<unknown>.<ref>@) is kept, because the outbound lookup can still use it. The handler calls this
 * before classifying, to know which ref to look up.
 */
export function readTag(recipients: string[]): { cls: MailClass | null; ref: string | null } {
  let cls: MailClass | null = null
  let ref: string | null = null
  for (const r of recipients) {
    const p = parseRecipient(bareAddress(r))
    if (!p.ours) continue
    if (p.cls && !cls) { cls = p.cls; ref = p.ref ?? ref; break }
    if (p.ref && !ref) ref = p.ref
  }
  return { cls, ref }
}

/** The rules the escalation runs, in the order matchKeywords applies them. */
const ESCALATION_CLASSES: readonly MailClass[] = ["data_request", "grievance"]

/** Every subject we send starts "[VERIDIAN DPDP"; a reply's subject echoes it, together with words of ours. */
const OWN_SUBJECT = /\[veridian dpdp/i

/**
 * The data_request / grievance rules over what the person wrote (see ESCALATION in the header). The subject is read
 * unless it is an echo of one of ours: ours contain "escalated to you" and "Data Protection Board", which would
 * otherwise turn every vacation reply and every "thanks" into a grievance.
 */
export function matchEscalation(subject: string, text: string): { cls: MailClass; phrase: string } | null {
  if (!OWN_SUBJECT.test(subject)) return matchKeywords(subject, text, ESCALATION_CLASSES)
  // Our own subject echoed: it says "escalated to you" and "Data Protection Board", so the GRIEVANCE rules are not run on it. The
  // data_request rules are: none of our subjects contains one of their words, and a person who types "Unsubscribe" or "DELETE MY
  // DATA" into the subject of a reply, after or instead of the end of ours, has made a withdrawal (dpdp-mail-edge-functions.test.ts
  // and classify.test.ts run the real rendered subjects through this).
  const fromText = matchKeywords("", text, ESCALATION_CLASSES)
  if (fromText?.cls === "data_request") return fromText
  // The "[VERIDIAN DPDP · DATA REQUEST]" LABEL of our own acknowledgement of a data request is itself two of those words, so
  // the bracketed prefix is cut off first; what a person typed after (or instead of) it is what is read (found in the review of
  // the classifier, 2026-09-29: an out-of-office reply to that acknowledgement was raised to a new data_request every time).
  return matchKeywords(subject.replace(/\[veridian dpdp[^\]]*\]/gi, " "), "", ["data_request"]) ?? fromText
}

/** Letters of a script this classifier has no keywords for (Arabic / Urdu, Bengali to Sinhala). Devanagari and Latin are covered. */
const UNREAD_SCRIPT = /[\u0600-\u06ff\u0750-\u077f\u0980-\u0dff]/

/** Anything but whitespace and ASCII punctuation: a letter or digit in any script, or a non-ASCII symbol. */
const HAS_CONTENT = /[^\s\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]/

/**
 * True when the message has text but NONE of it is the person's own: every line is quoted, or the whole message sits below an
 * "On ... wrote:" / Original Message / header-block marker. That is a reply typed BELOW the quoted original (Thunderbird's
 * default) or interleaved with it, and it is indistinguishable here from an empty reply. Reading the quote would put our own
 * words into every reply (see stripQuoted), so the message is not read: it goes to a person as `review` instead of being filed
 * under the class of its tag, where a data request or a grievance written below the quote would miss its clock (found in the
 * review of the hardening pass, 2026-09-29: "delete my data" typed under the quoted Monday digest was `monday`).
 */
export function nothingAboveTheQuote(text: string): boolean {
  return HAS_CONTENT.test(text) && !HAS_CONTENT.test(stripQuoted(text))
}

/**
 * Raises a non-legal class to data_request / grievance when the person's own words ask for one, and to `review` when there
 * are no words of theirs to read (nothingAboveTheQuote). Legal classes and auto pass through.
 */
function escalate(c: Classification, input: ClassifyInput): Classification {
  if (c.cls === "auto" || LEGAL_CLOCK_CLASSES.includes(c.cls)) return c
  const hit = matchEscalation(input.subject, input.text)
  if (!hit) {
    if (nothingAboveTheQuote(input.text)) {
      return { ...c, cls: "review", rule: "escalation", confidence: "low", escalatedFrom: c.cls, reason: `${c.reason}; nothing above the quoted original (a reply typed below it cannot be read safely)` }
    }
    // The person wrote in a script the keyword rules cannot read (Tamil, Bengali, Gujarati, Urdu ...): a data request in it would
    // stay under the class of its tag, so a person reads it instead.
    if (UNREAD_SCRIPT.test(`${OWN_SUBJECT.test(input.subject) ? "" : input.subject}\n${stripQuoted(input.text)}`)) {
      return { ...c, cls: "review", rule: "escalation", confidence: "low", escalatedFrom: c.cls, reason: `${c.reason}; written in a script the classifier has no keywords for` }
    }
    return c
  }
  return { ...c, cls: hit.cls, rule: "escalation", confidence: "medium", escalatedFrom: c.cls, reason: `${c.reason}; escalated keyword:${hit.cls}:"${hit.phrase}"` }
}

export function classify(input: ClassifyInput): Classification {
  const senders = input.senders.map(bareAddress).filter(Boolean)
  const sig = autoSignals({ senders, subject: input.subject, headers: input.headers, contentType: input.contentType, threadMatched: input.outbound != null })
  const signals = [...sig.machine, ...sig.header]

  const { cls: tagCls, ref: tagRef } = readTag(input.recipients)
  const base = { tagRef, autoSignals: signals, strongAuto: sig.machine.length > 0, escalatedFrom: null as MailClass | null }
  const outbound = input.outbound && input.outbound.cls !== "auto" ? input.outbound : null
  const note = tagCls === "auto" ? "; ignored auto tag" : ""

  // 0. self
  if (senders.some((s) => parseRecipient(s).ours)) {
    return { ...base, cls: "auto", rule: "self", confidence: "high", reason: "self:sent from our own mailbox (loop guard)" }
  }

  // 1. machine-only signals: a bounce is a bounce, whatever it quotes and whatever address it was sent to. Never escalated.
  if (sig.machine.length > 0) {
    return { ...base, cls: "auto", rule: "auto", confidence: "high", reason: `auto:${sig.machine.join(", ")} (machine-generated; not escalated)${note}` }
  }

  // 2. header-based auto signals, before the tag: a vacation reply to the Monday digest is auto. The sender chose these
  //    headers, so a legal request in the text still wins (escalation). A deliberate legal tag with no earlier message of
  //    ours behind it is not diverted (see the header comment).
  // What is NOT let through is a reply to one of our own ACKNOWLEDGEMENTS (an outbound row with a ticket number, or of a
  // legal-clock class, which only acknowledgements are): that is the auto-responder loop. A legal tag on a reply to any
  // OTHER message of ours is the List-Unsubscribe mailto of a digest or a notice (dpdp+dsr.<ref>@, same ref as the Monday
  // row): an automatic unsubscribe from a mail client, which may well carry Auto-Submitted / Precedence and no words at
  // all, and must not be filed as `auto` (found in the review of the classifier, 2026-09-29: it was, silently).
  const answersOurAcknowledgement = outbound !== null && (Boolean(outbound.ticketNo) || LEGAL_CLOCK_CLASSES.includes(outbound.cls))
  const legalTagStandsAlone = tagCls !== null && LEGAL_CLOCK_CLASSES.includes(tagCls) && !answersOurAcknowledgement
  if (sig.header.length > 0 && !legalTagStandsAlone) {
    const hit = matchEscalation(input.subject, input.text)
    if (hit) {
      return { ...base, cls: hit.cls, rule: "escalation", confidence: "medium", escalatedFrom: "auto", reason: `auto:${sig.header.join(", ")}; escalated keyword:${hit.cls}:"${hit.phrase}"${note}` }
    }
    return { ...base, cls: "auto", rule: "auto", confidence: "medium", reason: `auto:${sig.header.join(", ")}${note}` }
  }
  const legalTagNote = sig.header.length > 0 ? `; auto-mail headers ignored for a legal tag that is not a reply to our own acknowledgement (${sig.header.join(", ")})` : ""

  // a. tag
  if (tagCls && tagCls !== "auto") {
    if (tagCls === "sales" && outbound) {
      return escalate({ ...base, cls: "sales_chain", rule: "tag", confidence: "high", reason: `tag:${CLASS_TAG[tagCls]}+outbound:${outbound.ref}->sales_chain` }, input)
    }
    return escalate({ ...base, cls: tagCls, rule: "tag", confidence: "high", reason: `tag:${CLASS_TAG[tagCls]}${legalTagNote}` }, input)
  }

  // b. thread
  if (outbound) {
    const cls = inheritClass(outbound.cls)
    const arrow = cls === outbound.cls ? "" : `->${cls}`
    return escalate({ ...base, cls, rule: "thread", confidence: "high", reason: `thread:${outbound.cls}${arrow}(${outbound.matchedBy ?? "message_id"}:${outbound.ref})` }, input)
  }

  // d. keyword
  const kw = matchKeywords(input.subject, input.text)
  if (kw) {
    return escalate({ ...base, cls: kw.cls, rule: "keyword", confidence: "medium", reason: `keyword:${kw.cls}:"${kw.phrase}"${note}` }, input)
  }

  // e. default: never dropped, never demoted.
  return { ...base, cls: "review", rule: "default", confidence: "low", reason: `default:no rule matched${note}` }
}
