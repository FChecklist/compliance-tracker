// DPDP single mailbox -- the inbound classifier. PURE: no network, no Deno, no
// clock, no model. The same input always gives the same class, so a ruling the
// operator disagrees with can be reproduced from the stored row and fixed here.
//
// WHAT IT DECIDES. A message arrived at dpdp@veridian-aios.com (or at
// dpdp+<tag>.<ref>@, which Cloudflare delivers to the same rule). Which of the
// ten MailClass values (mail-taxonomy.ts) is it? FIRST MATCH WINS, in this order:
//
//   0. self    the sender is our own mailbox -> auto (loop guard: an operator
//              address that is itself dpdp@ would otherwise notify itself forever).
//   a. tag     the recipient's plus-tag names a class (highest confidence). A
//              `sal` tag on a message that answers something we sent is the
//              sales_chain class, not sales. An `aut` tag is IGNORED: anyone can
//              type dpdp+aut@, and auto is the one class that is logged without
//              telling the operator, so the tag alone must not be able to hide a
//              message.
//   b. thread  In-Reply-To / References carries a Message-ID we sent (the caller
//              looked it up; this function does no IO) -> inherits that row's
//              class ("sales" -> "sales_chain").
//   c. auto    bounce / out-of-office / delivery notice -> auto.
//   d. keyword subject + the first 4096 characters of the text (quoted lines
//              removed), English AND Hindi / Hinglish, in this order:
//              data_request, grievance, invoice, partner, sales, support.
//   e. default review.
//
// SAFETY RULE (the owner's core requirement): nothing is silently dropped or
// demoted. `review` is a legal-clock class, acknowledged and always notified;
// `auto` is the only class logged without a notice, so it is deliberately hard
// to reach:
//   * STRONG auto signals (a MAILER-DAEMON / postmaster sender, an empty
//     Return-Path, Auto-Submitted other than "no", X-Autoreply, Precedence:
//     auto_reply, a delivery-status / multipart-report content type, our own
//     X-Veridian-Origin header) always mean auto.
//   * WEAK auto signals (Precedence: bulk / junk, X-Auto-Response-Suppress, or
//     only an "out of office" style subject) mean auto ONLY when no keyword rule
//     matches. A human's grievance that happens to carry one of them is still
//     read by the keyword rules and keeps its class.
//   * Rules a and b run BEFORE c, as specified: an out-of-office answering a
//     Monday email lands as `monday`, with its auto signals listed in
//     `autoSignals` so the operator can see what it is and the caller can refuse
//     to send it an acknowledgement (no auto-reply loop).
//
// Deliberately over-inclusive keyword lists: a false data_request costs the
// operator one ticket; a missed one costs a statutory clock. Hindi terms are
// matched without \b (JavaScript's \b only knows ASCII word characters).
import { CLASS_TAG, parseRecipient, type MailClass } from "../_shared/mail-taxonomy.ts"

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

export type ClassificationRule = "self" | "tag" | "thread" | "auto" | "keyword" | "default"

export type Classification = {
  cls: MailClass
  rule: ClassificationRule
  confidence: "high" | "medium" | "low"
  /** Stored as dpdp.mail_inbound.classifier_reason. Never contains message text beyond a short matched phrase. */
  reason: string
  /** The ref read from the recipient's plus-tag, whatever class was finally chosen. */
  tagRef: string | null
  /** Every auto-mail signal present, strong and weak, whatever class was chosen. Non-empty => never acknowledge. */
  autoSignals: string[]
  strongAuto: boolean
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
 * Drops quoted material so our own template text in a reply cannot be mistaken
 * for what the person wrote: lines starting with ">", everything from an
 * "On ... wrote:" line, an "-----Original Message-----" / "Forwarded message"
 * line or a long underscore rule. If nothing is left the caller falls through to
 * `review`, which is the safe class.
 */
export function stripQuoted(text: string): string {
  const kept: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (/^on\s.{5,300}\swrote:\s*$/i.test(t)) break
    if (/^-{2,}\s*(?:original message|forwarded message)\s*-{2,}/i.test(t)) break
    if (/^_{20,}$/.test(t)) break
    if (t.startsWith(">")) continue
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

const AUTO_SUBJECT =
  /\b(?:out[\s-]of[\s-](?:the[\s-])?office|automatic(?:ally)?\s+repl(?:y|ies)|auto[\s-]?repl(?:y|ies)|autoreply|undeliver(?:able|ed)|delivery\s+(?:status\s+notification|failure|has\s+failed)|mail\s+delivery\s+(?:failed|subsystem)|returned\s+mail|failure\s+notice|away\s+from\s+(?:the\s+)?office|automatische\s+antwort|abwesenheit|r[ée]ponse\s+automatique|respuesta\s+autom[aá]tica|risposta\s+automatica)\b/i

export function autoSignals(input: Pick<ClassifyInput, "senders" | "subject" | "headers" | "contentType">): { strong: string[]; weak: string[] } {
  const strong: string[] = []
  const weak: string[] = []
  const h = input.headers

  for (const s of input.senders) {
    const local = bareAddress(s).split("@")[0]
    if (AUTO_SENDER_LOCALS.has(local)) { strong.push(`sender ${local}`); break }
  }

  const returnPath = headerValue(h, "return-path")
  if (returnPath !== undefined && returnPath.trim().replace(/\s+/g, "") === "<>") strong.push("empty Return-Path")

  // "Auto-Submitted != no", as specified: a present header whose first token is anything but "no" (an empty value included) is auto.
  const autoSubmitted = headerValue(h, "auto-submitted")
  if (autoSubmitted !== undefined) {
    const token = autoSubmitted.trim().toLowerCase().split(/[;\s]/)[0]
    if (token !== "no") strong.push(`Auto-Submitted=${token || "(empty)"}`)
  }

  for (const name of ["x-autoreply", "x-autorespond", "x-auto-reply"]) {
    if (headerValue(h, name) !== undefined) { strong.push(name); break }
  }

  if (headerValue(h, "x-veridian-origin") !== undefined) strong.push("x-veridian-origin (our own automatic mail)")

  const precedence = headerValue(h, "precedence")?.trim().toLowerCase()
  if (precedence === "auto_reply" || precedence === "auto-reply" || precedence === "autoreply") strong.push(`Precedence=${precedence}`)
  else if (precedence === "bulk" || precedence === "junk") weak.push(`Precedence=${precedence}`)

  const contentType = (input.contentType ?? headerValue(h, "content-type") ?? "").toLowerCase()
  if (/multipart\/report|message\/delivery-status|message\/disposition-notification/.test(contentType)) strong.push("delivery-status content type")

  if (headerValue(h, "x-auto-response-suppress") !== undefined) weak.push("x-auto-response-suppress")

  if (AUTO_SUBJECT.test(input.subject)) weak.push("auto-reply style subject")

  return { strong, weak }
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
      // Hinglish
      "\\bmer[ae]\\s+data\\s+(?:delete|hata|hatao|mita|mitao|erase|remove)",
      "\\bdata\\s+(?:delete|hata|hatao|mita|mitao|remove)\\s*(?:kar|karo|kijiye|kariye|do|dijiye)",
      "\\bmeri\\s+(?:jaankari|jankari|information|details?)\\s+(?:delete|hata|hatao|mita|mitao)",
      "\\b(?:mail|email|emails|mails|message|messages|sms)\\s+(?:bhejna|bhejni|bhejana|bhejne)\\s+band",
      "\\b(?:mail|email|emails|mails|message|messages)\\s+(?:mat|na)\\s+bhej",
      "\\bbhejna\\s+band\\b",
      "\\bunsubscribe\\s+kar",
      "\\b(?:sahmati|consent|anumati)\\s+(?:wapas|vapas|wapis)",
      // Hindi (Devanagari)
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
      "\\bescalat",
      "\\blegal\\s+(?:notice|action|proceedings)",
      "\\bdata\\s+protection\\s+board",
      "\\bconsumer\\s+(?:court|forum)",
      "\\bviolat(?:e|ed|es|ion|ions|ing)\\b",
      "\\bfraud",
      "\\bscam\\b",
      // Hinglish
      "\\bs(?:h)?ikaa?yat",
      "\\b(?:jawab|javab|uttar)\\s+(?:nahi|nahin|nhi)",
      "\\b(?:kanooni|kanuni|qanooni)\\s+notice",
      "\\bdhokh?a",
      // Hindi (Devanagari)
      "शिकायत",
      "(?:जवाब|उत्तर)\\s*नहीं",
      "कानूनी\\s*(?:नोटिस|कार्रवाई|कार्यवाही)",
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
  return `${subject}\n${body}`.normalize("NFKC").toLowerCase()
}

/** First keyword rule that matches, in the specified order, with the phrase that matched (at most 40 characters). */
export function matchKeywords(subject: string, text: string): { cls: MailClass; phrase: string } | null {
  const hay = keywordHaystack(subject, text)
  for (const rule of KEYWORD_RULES) {
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

export function classify(input: ClassifyInput): Classification {
  const senders = input.senders.map(bareAddress).filter(Boolean)
  const { strong, weak } = autoSignals({ senders, subject: input.subject, headers: input.headers, contentType: input.contentType })
  const signals = [...strong, ...weak]

  const { cls: tagCls, ref: tagRef } = readTag(input.recipients)
  const base = { tagRef, autoSignals: signals, strongAuto: strong.length > 0 }
  const outbound = input.outbound && input.outbound.cls !== "auto" ? input.outbound : null

  // 0. self
  if (senders.some((s) => parseRecipient(s).ours)) {
    return { ...base, cls: "auto", rule: "self", confidence: "high", reason: "self:sent from our own mailbox (loop guard)" }
  }

  // a. tag
  let ignoredAutoTag = false
  if (tagCls === "auto") {
    ignoredAutoTag = true
  } else if (tagCls) {
    if (tagCls === "sales" && outbound) {
      return { ...base, cls: "sales_chain", rule: "tag", confidence: "high", reason: `tag:${CLASS_TAG[tagCls]}+outbound:${outbound.ref}->sales_chain` }
    }
    return { ...base, cls: tagCls, rule: "tag", confidence: "high", reason: `tag:${CLASS_TAG[tagCls]}` }
  }

  // b. thread
  if (outbound) {
    const cls = inheritClass(outbound.cls)
    const arrow = cls === outbound.cls ? "" : `->${cls}`
    return { ...base, cls, rule: "thread", confidence: "high", reason: `thread:${outbound.cls}${arrow}(${outbound.matchedBy ?? "message_id"}:${outbound.ref})` }
  }

  // c. auto
  const note = ignoredAutoTag ? "; ignored auto tag" : ""
  if (strong.length > 0) {
    return { ...base, cls: "auto", rule: "auto", confidence: "high", reason: `auto:${strong.join(", ")}${note}` }
  }
  const kw = matchKeywords(input.subject, input.text)
  if (weak.length > 0 && !kw) {
    return { ...base, cls: "auto", rule: "auto", confidence: "medium", reason: `auto:${weak.join(", ")} (weak; no keyword rule matched)${note}` }
  }

  // d. keyword
  if (kw) {
    const overrode = weak.length > 0 ? `; weak auto signal overridden (${weak.join(", ")})` : ""
    return { ...base, cls: kw.cls, rule: "keyword", confidence: "medium", reason: `keyword:${kw.cls}:"${kw.phrase}"${overrode}${note}` }
  }

  // e. default: never dropped, never demoted.
  return { ...base, cls: "review", rule: "default", confidence: "low", reason: `default:no rule matched${note}` }
}
