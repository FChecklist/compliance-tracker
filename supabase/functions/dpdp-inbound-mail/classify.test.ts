/// <reference types="bun-types" />
// Offline proof of classify.ts (the DPDP single-mailbox inbound classifier): every class, every rule
// ordering the design fixes (machine signals and auto headers BEFORE the plus-tag), the escalation of a
// non-legal class to data_request / grievance by what the person wrote, the auto-mail headers, Hindi /
// Hinglish samples, thread inheritance and the never-drop default. No database, no network, no clock:
// classify() is pure.
//
// Run (bunfig.toml sets the test root to src/, so this file, which lives beside the function, is not
// found by a bare `bun test`; name it): bun test --isolate supabase/functions/dpdp-inbound-mail/classify.test.ts
import { describe, expect, test } from "bun:test"
import { LEGAL_CLOCK_CLASSES, MAIL_CLASSES, MAILBOX, replyToAddress, type MailClass } from "../_shared/mail-taxonomy.ts"
import { renderDigest, renderLeakClock, renderRightsClock, type Digest, type DigestJob, type Rendered, type RenderLinks } from "../dpdp-monday-email/render.ts"
import {
  TRUNCATED_MIN_LETTERS, autoSignals, bareAddress, classify, extractMessageIds, matchEscalation, matchKeywords, normalizeMessageId, nothingAboveTheQuote, readableLetters, stripQuoted,
  type ClassifyInput, type OutboundMatch,
} from "./classify.ts"

const REF = "k3f9x2ab7q"
const REF2 = "m8n4p2qrs5"

function mail(over: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    recipients: [MAILBOX],
    senders: ["asha@example.org"],
    subject: "Hello",
    text: "Hello there.",
    headers: {},
    ...over,
  }
}
const outbound = (cls: MailClass, over: Partial<OutboundMatch> = {}): OutboundMatch => ({ ref: REF2, cls, matchedBy: "message_id", ...over })

describe("recipient plus-tag (rule a)", () => {
  const TAGGED: Array<[MailClass, MailClass]> = [
    ["monday", "monday"], ["clock", "clock"], ["sales", "sales"], ["sales_chain", "sales_chain"], ["invoice", "invoice"],
    ["grievance", "grievance"], ["data_request", "data_request"], ["partner", "partner"], ["support", "support"], ["review", "review"],
  ]
  for (const [tag, want] of TAGGED) {
    test(`dpdp+${tag} tag gives ${want}`, () => {
      const r = classify(mail({ recipients: [replyToAddress(tag, REF)] }))
      expect(r.cls).toBe(want)
      expect(r.rule).toBe("tag")
      expect(r.confidence).toBe("high")
      expect(r.tagRef).toBe(REF)
    })
  }

  test("a tag with no ref (dpdp+grv@) still names the class", () => {
    const r = classify(mail({ recipients: ["dpdp+grv@veridian-aios.com"] }))
    expect(r.cls).toBe("grievance")
    expect(r.tagRef).toBeNull()
  })

  test("display names, angle brackets and mixed case are tolerated", () => {
    const r = classify(mail({ recipients: [`"VERIDIAN DPDP" <${replyToAddress("invoice", REF).toUpperCase()}>`] }))
    expect(r.cls).toBe("invoice")
    expect(r.tagRef).toBe(REF)
  })

  test("the tag is found on a later recipient (a Cc), envelope address plain", () => {
    const r = classify(mail({ recipients: [MAILBOX, "someone@else.example", replyToAddress("partner", REF)] }))
    expect(r.cls).toBe("partner")
  })

  test("a tag beats every NON-legal keyword rule (sales, partner, support, invoice)", () => {
    const r = classify(mail({ recipients: [replyToAddress("monday", REF)], subject: "Re: your week", text: "What is your pricing? We could partner. I need help with login." }))
    expect(r.cls).toBe("monday")
    expect(r.rule).toBe("tag")
    expect(r.escalatedFrom).toBeNull()
  })

  test("a tag does NOT beat a data request or a grievance in the person's own words: it is escalated (see the escalation tests)", () => {
    const r = classify(mail({ recipients: [replyToAddress("invoice", REF)], subject: "Please delete my data", text: "I want to withdraw consent. This is a complaint." }))
    expect(r.cls).toBe("data_request")
    expect(r.rule).toBe("escalation")
    expect(r.escalatedFrom).toBe("invoice")
  })

  test("a tag beats a thread match", () => {
    const r = classify(mail({ recipients: [replyToAddress("support", REF)], outbound: outbound("invoice") }))
    expect(r.cls).toBe("support")
  })

  test("a sal tag on a reply to something we sent is the sales_chain class", () => {
    const r = classify(mail({ recipients: [replyToAddress("sales", REF)], outbound: outbound("sales", { ref: REF, matchedBy: "ref" }) }))
    expect(r.cls).toBe("sales_chain")
    expect(r.rule).toBe("tag")
    expect(r.reason).toContain("sales_chain")
  })

  test("a sal tag with no outbound row is a new enquiry: sales", () => {
    expect(classify(mail({ recipients: [replyToAddress("sales", REF)] })).cls).toBe("sales")
  })

  test("an unknown tag falls through to the later rules but keeps its ref for the outbound lookup", () => {
    const r = classify(mail({ recipients: [`dpdp+zzz.${REF}@veridian-aios.com`], text: "please delete my data" }))
    expect(r.cls).toBe("data_request")
    expect(r.rule).toBe("keyword")
    expect(r.tagRef).toBe(REF)
  })

  test("a tag on somebody else's domain is not ours", () => {
    const r = classify(mail({ recipients: [`dpdp+grv.${REF}@example.com`] }))
    expect(r.cls).toBe("review")
  })

  test("an aut tag is IGNORED: it cannot hide a message from the operator", () => {
    const r = classify(mail({ recipients: [replyToAddress("auto", REF)], text: "I withdraw my consent" }))
    expect(r.cls).toBe("data_request")
    expect(r.reason).toContain("ignored auto tag")
    const bare = classify(mail({ recipients: [replyToAddress("auto", REF)], text: "hi" }))
    expect(bare.cls).toBe("review")
  })

  test("an aut tag together with an auto header is auto", () => {
    const r = classify(mail({ recipients: [replyToAddress("auto", REF)], headers: { "auto-submitted": "auto-replied" } }))
    expect(r.cls).toBe("auto")
  })
})

describe("thread match (rule b)", () => {
  const INHERIT: Array<[MailClass, MailClass]> = [
    ["monday", "monday"], ["clock", "clock"], ["sales", "sales_chain"], ["sales_chain", "sales_chain"], ["invoice", "invoice"],
    ["grievance", "grievance"], ["data_request", "data_request"], ["partner", "partner"], ["support", "support"], ["review", "review"],
  ]
  for (const [out, want] of INHERIT) {
    test(`a reply to an outbound ${out} is ${want}`, () => {
      const r = classify(mail({ outbound: outbound(out) }))
      expect(r.cls).toBe(want)
      expect(r.rule).toBe("thread")
      expect(r.confidence).toBe("high")
    })
  }

  test("sales -> sales_chain is spelled out in the reason", () => {
    expect(classify(mail({ outbound: outbound("sales") })).reason).toContain("sales->sales_chain")
  })

  test("a thread match beats every NON-legal keyword rule", () => {
    const r = classify(mail({ outbound: outbound("monday"), text: "what is your pricing? we could partner, and I need help with login" }))
    expect(r.cls).toBe("monday")
    expect(r.rule).toBe("thread")
  })

  test("a thread match does NOT beat a data request or a grievance in the person's own words: it is escalated", () => {
    const r = classify(mail({ outbound: outbound("monday"), text: "please delete my data, this is a complaint" }))
    expect(r.cls).toBe("data_request")
    expect(r.escalatedFrom).toBe("monday")
  })

  test("auto-mail headers beat a thread match (a vacation reply to a Monday email is auto), and the signals are reported", () => {
    const r = classify(mail({ outbound: outbound("monday"), headers: { "auto-submitted": "auto-replied" }, subject: "Automatic reply: Monday" }))
    expect(r.cls).toBe("auto")
    expect(r.rule).toBe("auto")
    expect(r.strongAuto).toBe(false)
    expect(r.autoSignals.join(" ")).toContain("Auto-Submitted=auto-replied")
  })

  test("an outbound row of class auto is not inherited: the message is read on its own merits", () => {
    const r = classify(mail({ outbound: outbound("auto"), text: "I want a refund" }))
    expect(r.cls).toBe("invoice")
    expect(r.rule).toBe("keyword")
  })

  test("the reason names the matching route and the outbound ref", () => {
    const r = classify(mail({ outbound: outbound("invoice", { matchedBy: "ref", ref: REF }) }))
    expect(r.reason).toBe(`thread:invoice(ref:${REF})`)
  })
})

describe("self-sent mail (rule 0)", () => {
  test("from the mailbox itself is auto, whatever it says", () => {
    const r = classify(mail({ senders: [MAILBOX], text: "delete my data" }))
    expect(r.cls).toBe("auto")
    expect(r.rule).toBe("self")
  })
  test("from a tagged address of ours too", () => {
    expect(classify(mail({ senders: [replyToAddress("grievance", REF)] })).cls).toBe("auto")
  })
  test("from any header sender candidate", () => {
    expect(classify(mail({ senders: ["bounce@example.org", `DPDP <${MAILBOX}>`] })).cls).toBe("auto")
  })
  test("a look-alike domain is not us", () => {
    expect(classify(mail({ senders: ["dpdp@veridian-aios.com.evil.example"] })).cls).toBe("review")
  })
})

describe("auto mail 1: MACHINE-ONLY signals -> auto, before the tag, never escalated", () => {
  // A delivery-status content type is machine-only on its own. A postmaster / mailer-daemon sender, and an empty Return-Path, are names and
  // an envelope detail: they are machine-only only TOGETHER with a second signal (owner decision, 2026-09-29; see the next describe).
  const MACHINE: Array<[string, Partial<ClassifyInput>]> = [
    ["multipart/report", { contentType: "multipart/report; report-type=delivery-status; boundary=abc" }],
    ["message/delivery-status via the header map", { headers: { "content-type": "message/delivery-status" } }],
    ["a read receipt (message/disposition-notification)", { contentType: "message/disposition-notification" }],
    ["MAILER-DAEMON sender + a delivery-status content type", { senders: ["MAILER-DAEMON@mx.example.org"], contentType: "multipart/report; report-type=delivery-status" }],
    ["postmaster sender + an empty Return-Path", { senders: ["Mail Delivery <postmaster@mx.example.org>"], headers: { "return-path": "<>" } }],
    ["postmaster sender + an empty envelope sender (the transport only reports the envelope)", { senders: ["postmaster@mx.example.org"], nullSender: true }],
    ["MAILER-DAEMON sender + Auto-Submitted", { senders: ["mailer-daemon@mx.example.org"], headers: { "auto-submitted": "auto-replied" } }],
    ["MAILER-DAEMON sender + a bounce style subject at the start", { senders: ["mailer-daemon@mx.example.org"], subject: "Undeliverable: Your week" }],
    ["postmaster sender + an auto-reply style subject behind Re: and a [tag]", { senders: ["postmaster@mx.example.org"], subject: "RE: [External] Out of Office: back Monday" }],
    ["an empty Return-Path + a delivery-status content type", { headers: { "return-path": "<>" }, contentType: "multipart/report" }],
    ["an empty Return-Path + a MAILER-DAEMON sender", { headers: { "return-path": "<>" }, senders: ["MAILER-DAEMON@mx.example.org"] }],
  ]
  for (const [name, over] of MACHINE) {
    test(name, () => {
      const r = classify(mail(over))
      expect(r.cls).toBe("auto")
      expect(r.rule).toBe("auto")
      expect(r.confidence).toBe("high")
      expect(r.strongAuto).toBe(true)
      expect(r.escalatedFrom).toBeNull()
      expect(r.autoSignals.length).toBeGreaterThan(0)
    })
  }

  test("a machine signal beats the plus-tag, the thread and every keyword, and is NEVER escalated: a bounce quoting our mail is a bounce", () => {
    const quoting = "Delivery failed. The original message follows.\n\nPlease delete my data. This is a complaint.\n> Stop these weekly emails: https://x.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=abc"
    for (const over of [{}, { recipients: [replyToAddress("grievance", REF)] }, { recipients: [replyToAddress("monday", REF)], outbound: outbound("monday") }, { outbound: outbound("data_request") }]) {
      for (const bounce of [{ senders: ["MAILER-DAEMON@mx.example.org"] }, { senders: ["postmaster@mx.example.org"], headers: { "return-path": "<>" } }, { contentType: "multipart/report; report-type=delivery-status" }]) {
        const r = classify(mail({ ...over, ...bounce, subject: "Undelivered Mail Returned to Sender", text: quoting }))
        expect(r.cls).toBe("auto")
        expect(r.rule).toBe("auto")
        expect(r.escalatedFrom).toBeNull()
        expect(r.reason).not.toContain("escalated keyword")
      }
    }
  })

  test("a delivery-status report on an aut tag is still a bounce, and says the tag was ignored", () => {
    const r = classify(mail({ recipients: [replyToAddress("auto", REF)], headers: { "return-path": "<>" } }))
    expect(r.cls).toBe("auto")
    expect(r.reason).toContain("ignored auto tag")
  })

  test("a non-empty Return-Path is not a bounce", () => {
    expect(classify(mail({ headers: { "return-path": "<asha@example.org>" } })).cls).toBe("review")
  })
})

// Owner decision (2026-09-29): "postmaster" and "mailer-daemon" are mailbox NAMES. postmaster@ is a real, human-read address at a small
// firm, so on its own it says nothing; it counts as machine-only only together with a second machine signal. An empty envelope sender is
// a header-class signal on its own (a vacation reply or a list robot, both of which a legal request in the text overrides).
describe("auto mail 1b: a postmaster / mailer-daemon name alone is not a machine signal; an empty envelope sender alone is only a header signal", () => {
  const POSTMASTER = "postmaster@smallfirm.example"

  test("a plain text mail from postmaster@ with a legal request is an ordinary mail: keyword-classified, not hidden, no auto signal at all", () => {
    for (const [text, want] of [["Please delete my data.", "data_request"], ["This is a complaint about your service.", "grievance"]] as const) {
      const r = classify(mail({ senders: [POSTMASTER], subject: "Request", text }))
      expect(r.cls, text).toBe(want)
      expect(r.rule).toBe("keyword")
      expect(r.strongAuto).toBe(false)
      expect(r.autoSignals).toEqual([])
      expect(r.autoHeadersIgnored).toBe(false)
    }
    // ... also as a reply on a tagged thread, and to the legal tags
    expect(classify(mail({ senders: [POSTMASTER], recipients: [replyToAddress("monday", REF)], text: "Please delete my data." })).cls).toBe("data_request")
    expect(classify(mail({ senders: [POSTMASTER], recipients: [replyToAddress("grievance", REF)], text: "hello" })).cls).toBe("grievance")
  })

  test("the same for mailer-daemon@ on its own, and for either name when the only other thing is a signal that is not one of the four", () => {
    expect(classify(mail({ senders: ["mailer-daemon@smallfirm.example"], text: "hello" })).cls).toBe("review")
    expect(classify(mail({ senders: [POSTMASTER], text: "hello" })).strongAuto).toBe(false)
    // Precedence: bulk is header-based but is not one of the second signals that confirm a sender: it is a header signal, so a legal request escalates
    const bulk = classify(mail({ senders: [POSTMASTER], headers: { precedence: "bulk" }, text: "Please delete my data." }))
    expect(bulk.cls).toBe("data_request")
    expect(bulk.escalatedFrom).toBe("auto")
    expect(bulk.strongAuto).toBe(false)
    expect(autoSignals({ senders: [POSTMASTER], subject: "Hello", headers: { precedence: "bulk" } })).toEqual({ machine: [], header: ["Precedence=bulk"] })
  })

  test("with a second signal it IS machine-only and is never escalated, whatever it quotes or asks", () => {
    const ask = "Please delete my data. This is a complaint."
    const seconds: Array<Partial<ClassifyInput>> = [
      { contentType: "multipart/report" }, { headers: { "return-path": "<>" } }, { nullSender: true }, { headers: { "auto-submitted": "auto-generated" } }, { subject: "Undeliverable: hello" },
      { subject: "Fwd: [Ext] Delivery Status Notification (Failure)" },
    ]
    for (const over of seconds) {
      const r = classify(mail({ senders: [POSTMASTER], text: ask, ...over }))
      expect(r.cls, JSON.stringify(over)).toBe("auto")
      expect(r.strongAuto).toBe(true)
      expect(r.escalatedFrom).toBeNull()
      expect(r.autoSignals.join(" ")).toContain("sender postmaster")
    }
  })

  test("autoSignals reports which signals were machine-only and which stayed header-based", () => {
    expect(autoSignals({ senders: [POSTMASTER], subject: "Hello", headers: {} })).toEqual({ machine: [], header: [] })
    expect(autoSignals({ senders: [POSTMASTER], subject: "Hello", headers: { "auto-submitted": "auto-replied" } })).toEqual({ machine: ["sender postmaster"], header: ["Auto-Submitted=auto-replied"] })
    expect(autoSignals({ senders: [POSTMASTER], subject: "Hello", headers: { "return-path": "<>" } })).toEqual({ machine: ["sender postmaster", "empty Return-Path"], header: [] })
    expect(autoSignals({ senders: [], subject: "Hello", headers: {}, nullSender: true })).toEqual({ machine: [], header: ["empty Return-Path"] })
    expect(autoSignals({ senders: [], subject: "Hello", headers: { "return-path": " < > " } })).toEqual({ machine: [], header: ["empty Return-Path"] })
    expect(autoSignals({ senders: [], subject: "Hello", headers: {}, contentType: "multipart/report", nullSender: true })).toEqual({ machine: ["empty Return-Path", "delivery-status content type"], header: [] })
  })

  test("an empty envelope sender / Return-Path on its own is a HEADER-class signal: auto when nothing legal is asked, escalated when it is", () => {
    for (const over of [{ nullSender: true }, { headers: { "return-path": "<>" } }]) {
      const quiet = classify(mail({ subject: "Out of the blue", text: "Thanks for your time last week.", ...over }))
      expect(quiet.cls).toBe("auto")
      expect(quiet.rule).toBe("auto")
      expect(quiet.strongAuto).toBe(false)
      expect(quiet.autoSignals).toEqual(["empty Return-Path"])
      expect(quiet.reason).toBe("auto:empty Return-Path")
      const asks = classify(mail({ text: "Please delete my data.", ...over }))
      expect(asks.cls).toBe("data_request")
      expect(asks.rule).toBe("escalation")
      expect(asks.escalatedFrom).toBe("auto")
      expect(asks.strongAuto).toBe(false)
      expect(asks.reason).toBe('auto:empty Return-Path; escalated keyword:data_request:"delete my data"')
      // an ordinary sales enquiry with a null sender is auto (the header rule): only data_request and grievance rescue it
      expect(classify(mail({ text: "What is your pricing?", ...over })).cls).toBe("auto")
    }
  })

  test("a bounce-style subject on its own, with a null sender but no daemon name and no delivery-status type, is still header-class", () => {
    const r = classify(mail({ subject: "Undeliverable: hello", headers: { "return-path": "<>" }, text: "Please delete my data." }))
    expect(r.cls).toBe("data_request")
    expect(r.strongAuto).toBe(false)
  })
})

describe("auto mail 2: HEADER-BASED signals -> auto, before the tag, UNLESS the person's own words are a legal request", () => {
  const HEADERS: Array<[string, Partial<ClassifyInput>]> = [
    ["Auto-Submitted: auto-replied", { headers: { "auto-submitted": "auto-replied" } }],
    ["Auto-Submitted: auto-generated", { headers: { "auto-submitted": "auto-generated" } }],
    ["Auto-Submitted: auto-notified; with a comment", { headers: { "auto-submitted": "auto-notified; owner-email=x@y.z" } }],
    ["X-Autoreply", { headers: { "x-autoreply": "yes" } }],
    ["X-Autorespond", { headers: { "x-autorespond": "1" } }],
    ["Precedence: auto_reply", { headers: { precedence: "auto_reply" } }],
    ["Precedence: bulk", { headers: { precedence: "bulk" } }],
    ["Precedence: junk", { headers: { precedence: "junk" } }],
    ["an out-of-office subject", { subject: "Out of Office: back Monday" }],
    ["an automatic-reply subject", { subject: "Automatic reply: Your message" }],
  ]
  for (const [name, over] of HEADERS) {
    test(name, () => {
      const r = classify(mail({ text: "I am away until 5 October.", ...over }))
      expect(r.cls).toBe("auto")
      expect(r.rule).toBe("auto")
      expect(r.confidence).toBe("medium")
      expect(r.strongAuto).toBe(false)
      expect(r.escalatedFrom).toBeNull()
      expect(r.autoSignals.length).toBeGreaterThan(0)
    })
  }

  test("evaluated BEFORE the plus-tag: a vacation reply to the Monday digest is auto, not a Monday reply", () => {
    const r = classify(mail({ recipients: [replyToAddress("monday", REF)], headers: { "auto-submitted": "auto-replied" }, subject: "Automatic reply: Your week", text: "I am on leave." }))
    expect(r.cls).toBe("auto")
    expect(r.rule).toBe("auto")
    expect(r.tagRef).toBe(REF)
  })

  test("the SAME header on a real 'delete my data' is escalated to a data_request, and the origin is kept in the reason", () => {
    const r = classify(mail({ recipients: [replyToAddress("monday", REF)], headers: { "auto-submitted": "auto-replied" }, subject: "Automatic reply: Your week", text: "Please delete my data." }))
    expect(r.cls).toBe("data_request")
    expect(r.rule).toBe("escalation")
    expect(r.escalatedFrom).toBe("auto")
    expect(r.reason).toBe('auto:Auto-Submitted=auto-replied, auto-reply style subject; escalated keyword:data_request:"delete my data"')
    expect(r.autoSignals.length).toBe(2) // still reported: the handler needs them for the loop guard
  })

  test("and a grievance under the same header is a grievance; a data request wins over a grievance", () => {
    expect(classify(mail({ headers: { precedence: "bulk" }, text: "This is my third complaint." })).cls).toBe("grievance")
    expect(classify(mail({ headers: { precedence: "bulk" }, text: "This is a complaint. Delete my data." })).cls).toBe("data_request")
  })

  test("only data_request and grievance can escalate: a sales, invoice, partner or support keyword under an auto header stays auto", () => {
    for (const text of ["What is your pricing?", "Where is my invoice?", "We would like to partner with you", "I need help with login"]) {
      expect(classify(mail({ headers: { precedence: "bulk" }, text })).cls).toBe("auto")
    }
  })

  test("an out-of-office subject with a real request in the body is read, not dropped", () => {
    const r = classify(mail({ subject: "Automatic reply: hello", text: "Actually please erase my account." }))
    expect(r.cls).toBe("data_request")
    expect(r.escalatedFrom).toBe("auto")
  })

  test("Auto-Submitted: no is not an auto signal", () => {
    const r = classify(mail({ headers: { "auto-submitted": "no" } }))
    expect(r.cls).toBe("review")
    expect(r.autoSignals).toEqual([])
  })

  test("Auto-Submitted is 'not no', literally: a present-but-empty value counts, and so does 'No' in another case only when it is exactly no", () => {
    const empty = classify(mail({ headers: { "auto-submitted": "  " } }))
    expect(empty.cls).toBe("auto")
    expect(empty.reason).toContain("Auto-Submitted=(empty)")
    expect(classify(mail({ headers: { "auto-submitted": "NO" } })).cls).toBe("review")
    expect(classify(mail({ headers: { "auto-submitted": "no; reason=x" } })).cls).toBe("review")
  })

  test("presence alone is the signal for X-Autoreply: an empty value counts", () => {
    expect(classify(mail({ headers: { "x-autoreply": "" } })).cls).toBe("auto")
  })

  test("X-Auto-Response-Suppress is NOT an auto signal: it says how others should answer the sender, not that the message is automatic", () => {
    const r = classify(mail({ headers: { "x-auto-response-suppress": "All" } }))
    expect(r.cls).toBe("review")
    expect(r.autoSignals).toEqual([])
    expect(classify(mail({ headers: { "x-auto-response-suppress": "DR, OOF" }, text: "This is my third complaint." })).cls).toBe("grievance")
  })

  const SUBJECTS = [
    "Out of Office: back Monday", "Out-of-office", "Automatic reply: Your message", "Auto-reply", "Autoreply: thanks",
    "Undeliverable: [VERIDIAN DPDP · Monday] Your week", "Delivery Status Notification (Failure)", "Mail delivery failed: returning message to sender",
    "Returned mail: see transcript for details", "Failure notice", "Away from the office until 5 October",
    "Automatische Antwort: Abwesend", "Réponse automatique : absent", "Respuesta automática: fuera de la oficina",
  ]
  for (const subject of SUBJECTS) {
    test(`subject "${subject}" with nothing to read is auto`, () => {
      const r = classify(mail({ subject, text: "" }))
      expect(r.cls).toBe("auto")
      expect(r.strongAuto).toBe(false)
    })
  }

  test("a MAILER-DAEMON sender with an ordinary subject and nothing else is NOT machine-generated (a name is not evidence); with Auto-Submitted it is", () => {
    const alone = classify(mail({ senders: ["mailer-daemon@googlemail.com"], subject: "Hello", text: "" }))
    expect(alone.strongAuto).toBe(false)
    expect(alone.cls).toBe("review")
    const confirmed = classify(mail({ senders: ["mailer-daemon@googlemail.com"], subject: "Hello", text: "", headers: { "auto-submitted": "auto-generated" } }))
    expect(confirmed.strongAuto).toBe(true)
    expect(confirmed.cls).toBe("auto")
  })

  test("a legal-clock tag with NO earlier message of ours behind it is not diverted to auto by a sender-chosen header (the legacy grievance@ alias)", () => {
    for (const cls of ["grievance", "data_request", "review"] as const) {
      const r = classify(mail({ recipients: [replyToAddress(cls, REF)], headers: { precedence: "bulk" }, text: "Kindly resolve the pending matter." }))
      expect(r.cls).toBe(cls)
      expect(r.rule).toBe("tag")
      expect(r.autoSignals).toEqual(["Precedence=bulk"])
      expect(r.autoHeadersIgnored).toBe(true)
      expect(r.reason).toContain("auto-mail headers ignored for a legal tag")
    }
    // ... but a reply to something we sent that IS an acknowledgement (its outbound row carries the ticket number) with the same header is auto: that is the auto-responder loop.
    const reply = classify(mail({ recipients: [replyToAddress("grievance", REF)], headers: { "auto-submitted": "auto-replied" }, outbound: outbound("grievance", { ref: REF, matchedBy: "ref", ticketNo: "G-2026-0001" }), text: "I am on leave." }))
    expect(reply.cls).toBe("auto")
    expect(reply.autoHeadersIgnored).toBe(false)
    // ... and a non-legal tag is diverted.
    expect(classify(mail({ recipients: [replyToAddress("invoice", REF)], headers: { precedence: "bulk" }, text: "Kindly resolve the pending matter." })).cls).toBe("auto")
  })

  test("our own X-Veridian-Origin header counts ONLY when a thread match corroborates it; anyone can type it", () => {
    const alone = classify(mail({ headers: { "x-veridian-origin": "acknowledgement" }, text: "hello" }))
    expect(alone.cls).toBe("review")
    expect(alone.autoSignals).toEqual([])
    expect(classify(mail({ headers: { "x-veridian-origin": "" }, text: "hello" })).cls).toBe("review")
    const corroborated = classify(mail({ headers: { "x-veridian-origin": "acknowledgement" }, outbound: outbound("grievance", { ticketNo: "G-2026-0001" }), text: "thanks" }))
    expect(corroborated.cls).toBe("auto")
    expect(corroborated.autoSignals.join(" ")).toContain("x-veridian-origin")
    // corroborated by a message-id match or by the tag ref alike, but still sender-controlled: a legal request in the text escalates.
    const withRequest = classify(mail({ headers: { "x-veridian-origin": "" }, outbound: outbound("invoice"), text: "Please delete my data." }))
    expect(withRequest.cls).toBe("data_request")
    // an outbound row that is itself class auto is not a corroboration we inherit from, but it is still a thread match
    expect(classify(mail({ headers: { "x-veridian-origin": "" }, outbound: outbound("auto"), text: "hi" })).cls).toBe("auto")
  })
})

describe("autoSignals()", () => {
  test("reports machine-only and header-based signals separately", () => {
    const s = autoSignals({ senders: ["postmaster@x.example"], subject: "Out of office", headers: { precedence: "bulk", "auto-submitted": "auto-generated", "return-path": "<>" } })
    expect(s.machine).toEqual(["sender postmaster", "empty Return-Path"])
    expect(s.header).toEqual(["Auto-Submitted=auto-generated", "Precedence=bulk", "auto-reply style subject"])
  })
  test("nothing for an ordinary human message", () => {
    expect(autoSignals({ senders: ["asha@example.org"], subject: "Question", headers: { "content-type": "text/plain" } })).toEqual({ machine: [], header: [] })
  })
  test("x-veridian-origin is a header signal only with threadMatched", () => {
    const h = { "x-veridian-origin": "acknowledgement" }
    expect(autoSignals({ senders: [], subject: "s", headers: h })).toEqual({ machine: [], header: [] })
    expect(autoSignals({ senders: [], subject: "s", headers: h, threadMatched: false })).toEqual({ machine: [], header: [] })
    expect(autoSignals({ senders: [], subject: "s", headers: h, threadMatched: true }).header.length).toBe(1)
  })
})

describe("keyword rules (rule d), English", () => {
  const CASES: Array<[MailClass, string[]]> = [
    ["data_request", [
      "Please unsubscribe me", "stop sending me emails", "I withdraw my consent", "withdraw consent", "withdrawal of consent", "Please delete my data",
      "delete all my personal data", "erase my records", "This is an erasure request", "I would like access to my personal data", "access my data",
      "send me a copy of my data", "please correct my data", "rectify my details", "I want to opt out", "remove me from your list", "do not contact me again",
      "right to be forgotten", "subject access request", "what data do you hold",
      "Data request", "this is a data subject request", "please forget me", "please delete the data you hold about me",
      "help! please delete data you hold about me", // a support word must not outrank the legal request
    ]],
    ["grievance", [
      "I have a grievance", "I want to complain", "This is a complaint", "a data breach happened", "my data was misused", "I am being harassed",
      "you are not responding", "no response from you", "I will escalate this", "legal notice enclosed", "I will approach the Data Protection Board",
      "you never replied", "consumer court", "this is a violation", "this is fraud",
    ]],
    ["invoice", [
      "Where is my invoice?", "I made the payment yesterday", "please send a receipt", "GST number mismatch", "I need a refund", "billing question",
      "the bill is wrong", "UTR 1234", "I have paid",
    ]],
    ["partner", [
      "We would like to partner with you", "reseller programme", "referral fee", "white-label option", "white label", "collaboration opportunity",
      "we are a distributor", "joint venture", "franchise",
    ]],
    ["sales", [
      "What is your pricing?", "Please send a quote", "Can I get a demo", "what plans do you have", "price list", "we want to buy", "free trial?",
      "I have an enquiry", "inquiry about your product", "interested in your product", "how much does it cost", "send me the brochure",
    ]],
    ["support", [
      "I need help", "I get an error", "cannot login", "can't log in", "the page is not working", "it doesn't work", "found a bug",
      "there is an issue", "a problem with the form", "forgot my password", "the app keeps crashing", "the login page is blank",
    ]],
  ]
  for (const [cls, samples] of CASES) {
    for (const text of samples) {
      test(`${cls}: "${text}"`, () => {
        const r = classify(mail({ text }))
        expect(r.cls).toBe(cls)
        expect(r.rule).toBe("keyword")
        expect(r.confidence).toBe("medium")
        expect(r.reason.startsWith(`keyword:${cls}:`)).toBe(true)
      })
    }
  }
  test("the subject is read too", () => {
    expect(classify(mail({ subject: "Complaint about delayed reply", text: "" })).cls).toBe("grievance")
  })
  test("upper case and full-width forms are normalised", () => {
    expect(classify(mail({ text: "UNSUBSCRIBE ME NOW" })).cls).toBe("data_request")
    expect(classify(mail({ text: "ＵＮＳＵＢＳＣＲＩＢＥ" })).cls).toBe("data_request")
  })
})

// The public copy (dpdp-app/data/veridian-facts.yaml contact.subject_topics) asks people to put ONE of these four words in
// the subject. Each must reach its own class from the subject alone, with an empty or unhelpful body, or the copy promises
// routing the classifier does not do. (Found at integration: "Data request" and "Sales" both fell through to `review`.)
describe("the four subject topics the public copy names", () => {
  const TOPICS: Array<[string, MailClass]> = [["Grievance", "grievance"], ["Data request", "data_request"], ["Sales", "sales"], ["Partner", "partner"]]
  for (const [topic, cls] of TOPICS) {
    for (const subject of [topic, topic.toLowerCase(), topic.toUpperCase(), `Re: ${topic}`, `${topic} - hello`]) {
      test(`subject "${subject}" -> ${cls}`, () => {
        for (const text of ["", "Hello", "Hi, please get back to me. Thanks."]) {
          const r = classify(mail({ subject, text }))
          expect(r.cls).toBe(cls)
          expect(r.rule).toBe("keyword")
        }
      })
    }
  }
  test("Sales is read only at the start of the subject: the word in a sentence or a signature does not demote an unclassifiable mail", () => {
    expect(classify(mail({ subject: "Question", text: "Regards,\nHead of Sales" })).cls).toBe("review")
    expect(classify(mail({ subject: "Something I was told", text: "your sales rep took some of my information" })).cls).toBe("review")
  })
})

describe("keyword rules: Hindi and Hinglish", () => {
  const CASES: Array<[MailClass, string[]]> = [
    ["data_request", [
      "mera data delete kar do", "mere data hata do", "data delete karo please", "meri jaankari hata dijiye", "email bhejna band karo", "mail mat bhejo",
      "unsubscribe kar do", "meri sahmati wapas le lijiye", "consent wapas chahiye",
      "मेरा डेटा हटाएं", "मेरा डाटा डिलीट कर दीजिए", "मेरी जानकारी को मिटा दें", "ईमेल भेजना बंद करें", "सहमति वापस लेना चाहता हूं", "अनसब्सक्राइब करें", "सदस्यता रद्द करें",
    ]],
    ["grievance", [
      "meri shikayat hai", "shikayat darj karni hai", "koi jawab nahi mila", "aapne jawab nahi diya", "kanooni notice bhejunga", "mere saath dhokha hua",
      "मेरी शिकायत है", "कोई जवाब नहीं आया", "कानूनी नोटिस भेजूंगा", "यह नियमों का उल्लंघन है", "मेरे साथ धोखा हुआ",
    ]],
    ["invoice", ["mera bhugtan ho gaya", "paise wapas chahiye", "rasid bhejiye", "भुगतान हो गया है", "रसीद भेजें", "बिल गलत है", "रिफंड चाहिए", "जीएसटी नंबर", "इनवॉइस चाहिए"]],
    ["partner", ["hum saajhedaar banna chahte hain", "साझेदारी का प्रस्ताव", "पार्टनर बनना है", "रिसेलर प्रोग्राम"]],
    ["sales", ["iski kimat kya hai", "keemat batao", "kitna lagega", "kharidna hai", "कीमत क्या है", "खरीदना चाहता हूं", "डेमो चाहिए", "ट्रायल चाहिए", "कोटेशन भेजें"]],
    ["support", ["madad chahiye", "login kaam nahi kar raha", "chal nahi raha", "samasya aa rahi hai", "मदद चाहिए", "काम नहीं कर रहा", "समस्या है", "एरर आ रहा है", "पासवर्ड भूल गया"]],
  ]
  for (const [cls, samples] of CASES) {
    for (const text of samples) {
      test(`${cls}: "${text}"`, () => {
        const r = classify(mail({ text }))
        expect(r.cls).toBe(cls)
        expect(r.rule).toBe("keyword")
      })
    }
  }
  test("बिलकुल (absolutely) is not an invoice", () => {
    expect(classify(mail({ text: "बिलकुल ठीक है" })).cls).toBe("review")
  })
  test("a Hindi data request wins over a Hindi complaint in the same message (ordering holds across scripts)", () => {
    expect(classify(mail({ text: "यह मेरी शिकायत है, मेरा डेटा हटाएं" })).cls).toBe("data_request")
  })
})

describe("keyword rule ordering: data_request > grievance > invoice > partner > sales > support", () => {
  const ORDER: Array<[MailClass, string]> = [
    ["data_request", "delete my data"],
    ["grievance", "this is a complaint"],
    ["invoice", "send the invoice"],
    ["partner", "partnership"],
    ["sales", "your pricing"],
    ["support", "I need help"],
  ]
  for (let i = 0; i < ORDER.length; i++) {
    for (let j = i + 1; j < ORDER.length; j++) {
      const [hi, hiText] = ORDER[i]
      const [lo, loText] = ORDER[j]
      test(`${hi} beats ${lo}, whichever comes first in the text`, () => {
        expect(classify(mail({ text: `${hiText}. Also, ${loText}.` })).cls).toBe(hi)
        expect(classify(mail({ text: `${loText}. Also, ${hiText}.` })).cls).toBe(hi)
      })
    }
  }
  test("all six at once is a data request; peel them off one by one", () => {
    const all = ORDER.map(([, t]) => t)
    for (let i = 0; i < ORDER.length; i++) {
      expect(classify(mail({ text: all.slice(i).join(". ") })).cls).toBe(ORDER[i][0])
    }
  })
  test("the subject takes part in the ordering", () => {
    expect(classify(mail({ subject: "Complaint", text: "please delete my data" })).cls).toBe("data_request")
  })
})

describe("what the keyword rules read", () => {
  test("quoted lines (>) are not read", () => {
    expect(classify(mail({ text: "Thanks!\n> To unsubscribe, reply STOP\n> delete my data" })).cls).toBe("review")
  })
  test("everything after 'On ... wrote:' is not read, but what came before is", () => {
    const body = "I will call you tomorrow.\n\nOn Mon, 28 Sep 2026 at 06:00, VERIDIAN AI DPDP <dpdp@veridian-aios.com> wrote:\nUnsubscribe here. Payment received."
    expect(classify(mail({ text: body })).cls).toBe("review")
    expect(classify(mail({ text: "Please delete my data.\n\n" + body.split("\n\n")[1] })).cls).toBe("data_request")
  })
  test("everything after an Original Message rule is not read", () => {
    expect(classify(mail({ text: "ok\n-----Original Message-----\nunsubscribe" })).cls).toBe("review")
    expect(classify(mail({ text: "ok\n---------- Forwarded message ----------\nunsubscribe" })).cls).toBe("review")
    expect(classify(mail({ text: "ok\n________________________________\nunsubscribe" })).cls).toBe("review")
  })
  test("an Outlook 'From: / Sent: / To: / Subject:' header block ends what the person wrote", () => {
    const body = "Thanks, noted.\n\nFrom: VERIDIAN AI DPDP <dpdp@veridian-aios.com>\nSent: Monday, September 28, 2026 6:00 AM\nTo: asha@example.org\nSubject: Acme: DPDP this week - 1 escalated to you\n\nStop these weekly emails: unsubscribe"
    expect(classify(mail({ text: body })).cls).toBe("review")
    expect(stripQuoted(body)).toBe("Thanks, noted.\n")
    // A single 'From:' line is not a header block.
    expect(classify(mail({ text: "From: Asha\nPlease delete my data." })).cls).toBe("data_request")
    // Two lines are not enough either (a person's own contact details).
    expect(classify(mail({ text: "From: Asha\nTo: Veridian\nPlease delete my data." })).cls).toBe("data_request")
  })
  test("a Gmail attribution wrapped over two lines still ends what the person wrote", () => {
    const body = "Yes.\n\nOn Mon, 28 Sep 2026 at 06:00, VERIDIAN AI DPDP <\ndpdp@veridian-aios.com> wrote:\nEscalated to you. Unsubscribe here."
    expect(classify(mail({ text: body })).cls).toBe("review")
    expect(stripQuoted("On Monday I will call.\nSecond line.")).toBe("On Monday I will call.\nSecond line.")
  })
  test("our own footer boilerplate is not read even when nothing marks it as quoted; the person's other lines are", () => {
    const echoed = [
      "Stop these weekly emails (statutory notices continue): https://x.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=abc123",
      "This is a statutory notice; it is sent even if you have stopped the weekly email.",
      "VERIDIAN · VERy INDIAN — Built for India's DPDP Act. For India, by India.",
      "Know a firm that needs this? Share VERIDIAN: https://veridian-aios.com/?ref=xyz",
      "We received your message to VERIDIAN AI DPDP.",
      "This is an automatic acknowledgement; it is not a reply to what your message says.",
      "-- VERIDIAN AI DPDP",
    ].join("\n")
    expect(classify(mail({ text: `Thanks for the update.\n${echoed}` })).cls).toBe("review")
    expect(classify(mail({ text: `${echoed}\nPlease delete my data.` })).cls).toBe("data_request")
  })
  // DRIFT GUARD for OWN_BOILERPLATE. classify.ts recognises our footer lines by their wording; render.ts owns that wording. This renders
  // the REAL emails and demands that every line from "Open my page" to the end (sign-in copy, brand line, share/invite asks, the
  // unsubscribe / statutory footer) is dropped, so a footer reworded in render.ts without touching classify.ts fails here rather than
  // quietly turning every marker-less echo of a digest into a data request.
  test("the footer of every real email we render (digest, statutory-only digest, leak clock, rights clock) is recognised as our own boilerplate", () => {
    const links: RenderLinks = {
      signIn: "https://x.supabase.co/auth/v1/verify?token=abc",
      actions: null,
      unsubscribeUrl: "https://x.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=u1",
      appHome: "https://app.veridian-aios.com/app/",
    }
    const digest: Digest = {
      membershipId: "m1", identityId: "i1", orgId: "o1", orgName: "Acme & Co", orgProduct: "firm", email: "staff@example.test", level: "owner", roleKind: "owner",
      referralCode: "ref1", inviteCode: "join1", weekKey: "2026-W39", today: "2026-09-21", unsubscribed: false, statutoryOnly: false, alreadySentThisWeek: false,
      owners: [{ membershipId: "mo", email: "owner@example.test" }], coordinators: [], jobs: [], escalatedToMe: [],
    }
    const recipient = { membershipId: "m1", identityId: "i1", email: "owner@example.test", role: "owner" as const }
    const texts = [
      renderDigest(digest, links, "monday_digest").text,
      renderDigest(digest, links, "statutory").text,
      renderLeakClock({ breachId: "b1", orgId: "o1", orgName: "Acme & Co", becameAwareAt: "2026-09-27T10:00:00Z", deadlineAt: "2026-09-30T10:00:00Z", hoursLeft: 40, boardNotified: false, individualsNotified: false, scopePersonCount: 12, periodKey: "k", recipients: [recipient] }, recipient, links).text,
      renderRightsClock({ requestId: "r1", ref: "RR-7", kind: "erasure", orgId: "o1", orgName: "Acme & Co", receivedAt: "2026-07-01T00:00:00Z", dueAt: "2026-09-29T00:00:00Z", daysLeft: 20, periodKey: "k", recipients: [recipient] }, recipient, links).text,
    ]
    const footerOf = (text: string): string => {
      const lines = text.split("\n")
      const from = lines.findIndex((l) => l.startsWith("Open my page:"))
      expect(from).toBeGreaterThan(0)
      return lines.slice(from).join("\n")
    }
    for (const text of texts) expect(stripQuoted(footerOf(text)).trim()).toBe("")
    // The digest footer really carries the wording that would otherwise hit the data_request rule (the unsubscribe URL); with the
    // boilerplate line dropped the keyword rules find nothing in it.
    expect(footerOf(texts[0])).toContain("action=unsubscribe")
    expect(matchKeywords("", footerOf(texts[0]))).toBeNull()
  })
  test("an inline (interleaved) answer is read", () => {
    expect(classify(mail({ text: "> Do you want the demo?\nYes, please delete my data first." })).cls).toBe("data_request")
  })
  test("only the first 4096 characters are read", () => {
    // Exactly 4096: the word starts beyond the window. (It used to be 4090, which left "unsub" inside it, a prefix that the
    // `unsub` withdrawal rule, added in the hardening review, rightly reads as a word.)
    const filler = "lorem ipsum ".repeat(400).slice(0, 4096)
    expect(classify(mail({ text: `${filler} unsubscribe` })).cls).toBe("review")
    expect(classify(mail({ text: `unsubscribe ${filler}` })).cls).toBe("data_request")
    expect(matchKeywords("", `${filler}     unsubscribe`)).toBeNull()
  })
  test("the matched phrase in the reason is short and is not the message", () => {
    const r = classify(mail({ text: "x ".repeat(50) + "please DELETE   my   data now " + "y ".repeat(50) }))
    expect(r.reason).toBe('keyword:data_request:"delete my data"')
  })
})

describe("the default (rule e) and the never-drop invariant", () => {
  test("nothing recognisable is review, low confidence", () => {
    const r = classify(mail({ text: "Hello there.", subject: "Hello" }))
    expect(r.cls).toBe("review")
    expect(r.rule).toBe("default")
    expect(r.confidence).toBe("low")
    expect(r.strongAuto).toBe(false)
    expect(r.reason).toBe("default:no rule matched")
  })
  test("an empty message is review", () => {
    expect(classify({ recipients: [], senders: [], subject: "", text: "", headers: {} }).cls).toBe("review")
  })
  test("mail to plain dpdp@ with no tag, no thread and no signals is review", () => {
    expect(classify(mail({ recipients: [MAILBOX], text: "asdf qwerty" })).cls).toBe("review")
  })
  test("garbage recipients do not throw", () => {
    expect(classify(mail({ recipients: ["", "not an address", "<>", "@", "a@"], senders: ["", "??"] })).cls).toBe("review")
  })

  // A deterministic pseudo-random walk over messages built from ordinary vocabulary and NO auto signal:
  // none of them may come out as auto. Auto is reachable only through self / a machine signal / an auto header with no data request or grievance in the text.
  function rng(seed: number) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const VOCAB = [
    "hello", "thanks", "regards", "please", "kindly", "reply", "team", "monday", "week", "digest", "unsubscribe", "delete my data", "complaint", "invoice", "partner",
    "pricing", "help", "message", "मदद", "शिकायत", "shikayat", "out", "office", "automatic", "delivered", "the", "a", "of", "and", "asap", "urgent", "नमस्ते",
  ]
  test("200 random messages with no auto header are never auto", () => {
    const next = rng(20260929)
    for (let n = 0; n < 200; n++) {
      const words = Array.from({ length: 1 + Math.floor(next() * 30) }, () => VOCAB[Math.floor(next() * VOCAB.length)])
      const r = classify(mail({ subject: words.slice(0, 4).join(" "), text: words.join(" ") }))
      // Subject words can spell an out-of-office; that is a header-based signal, and it needs the text to carry no data request or grievance.
      if (r.cls === "auto") {
        expect(r.rule).toBe("auto")
        expect(r.strongAuto).toBe(false)
        // ... and only when nothing in it is a data request or a grievance (those escalate).
        expect(matchEscalation(words.slice(0, 4).join(" "), words.join(" "))).toBeNull()
      }
    }
  })
  test("every class the classifier can return is a real MailClass, and each is reachable", () => {
    const seen = new Set<MailClass>()
    const samples: Partial<ClassifyInput>[] = [
      { recipients: [replyToAddress("monday", REF)] }, { recipients: [replyToAddress("clock", REF)] }, { recipients: [replyToAddress("sales", REF)] }, { recipients: [replyToAddress("sales_chain", REF)] },
      { recipients: [replyToAddress("invoice", REF)] }, { recipients: [replyToAddress("grievance", REF)] }, { recipients: [replyToAddress("data_request", REF)] },
      { recipients: [replyToAddress("partner", REF)] }, { recipients: [replyToAddress("support", REF)] }, { headers: { "auto-submitted": "auto-replied" } },
      {},
    ]
    for (const s of samples) seen.add(classify(mail(s)).cls)
    expect([...seen].sort()).toEqual([...MAIL_CLASSES].sort())
  })
  test("classify is deterministic and does not mutate its input", () => {
    const input = Object.freeze(mail({ recipients: Object.freeze([MAILBOX]) as unknown as string[], headers: Object.freeze({ precedence: "bulk" }) as Record<string, string>, text: "delete my data" }))
    const a = classify(input)
    const b = classify(input)
    expect(a).toEqual(b)
  })
})

describe("escalation: a non-legal class is raised to data_request / grievance by the person's own words", () => {
  const NON_LEGAL: MailClass[] = ["monday", "clock", "sales", "sales_chain", "invoice", "partner", "support"]

  test("the specified cases: mon-tagged 'stop sending, delete my data' -> data_request; invoice-thread complaint -> grievance; a plain thanks stays invoice", () => {
    const stop = classify(mail({ recipients: [replyToAddress("monday", REF)], subject: "Re: [VERIDIAN DPDP · Monday] Acme: DPDP this week", text: "Please stop sending me these emails. Delete my data." }))
    expect(stop.cls).toBe("data_request")
    expect(stop.rule).toBe("escalation")
    expect(stop.escalatedFrom).toBe("monday")
    expect(stop.confidence).toBe("medium")
    expect(stop.tagRef).toBe(REF)
    expect(stop.reason.startsWith('tag:mon; escalated keyword:data_request:"')).toBe(true)

    const complaint = classify(mail({ outbound: outbound("invoice", { ref: REF, matchedBy: "ref" }), subject: "Re: [VERIDIAN DPDP · Invoice] Your receipt", text: "I want to file a complaint about misuse of my data." }))
    expect(complaint.cls).toBe("grievance")
    expect(complaint.escalatedFrom).toBe("invoice")
    expect(complaint.reason).toBe(`thread:invoice(ref:${REF}); escalated keyword:grievance:"complain"`)

    const thanks = classify(mail({ outbound: outbound("invoice", { ref: REF, matchedBy: "ref" }), subject: "Re: [VERIDIAN DPDP · Invoice] Your receipt", text: "Thanks for the invoice, received." }))
    expect(thanks.cls).toBe("invoice")
    expect(thanks.rule).toBe("thread")
    expect(thanks.escalatedFrom).toBeNull()
    expect(thanks.reason).toBe(`thread:invoice(ref:${REF})`)
  })

  for (const cls of NON_LEGAL) {
    test(`by tag: a ${cls} reply that says 'delete my data' is a data_request; 'this is a complaint' a grievance; both, a data_request`, () => {
      const to = [replyToAddress(cls, REF)]
      const want: MailClass = cls
      expect(classify(mail({ recipients: to, text: "ok" })).cls).toBe(want)
      const dsr = classify(mail({ recipients: to, text: "Please delete my data." }))
      expect(dsr.cls).toBe("data_request")
      expect(dsr.escalatedFrom).toBe(want)
      const grv = classify(mail({ recipients: to, text: "This is a complaint." }))
      expect(grv.cls).toBe("grievance")
      expect(grv.escalatedFrom).toBe(want)
      expect(classify(mail({ recipients: to, text: "This is a complaint. Also delete my data." })).cls).toBe("data_request")
    })
    test(`by thread: a reply to our ${cls} message that says 'withdraw my consent' is a data_request`, () => {
      const r = classify(mail({ outbound: outbound(cls), text: "I withdraw my consent." }))
      expect(r.cls).toBe("data_request")
      expect(r.rule).toBe("escalation")
      expect(r.reason).toContain("thread:")
    })
  }

  test("a reply to a statutory notice (the clock class): thanks stays clock, a complaint or a data request is raised", () => {
    const to = [replyToAddress("clock", REF)]
    expect(classify(mail({ recipients: to, subject: "Re: [VERIDIAN DPDP · Statutory] 72-hour clock: data leak at Acme - tell the Data Protection Board", text: "Done, thanks." })).cls).toBe("clock")
    expect(classify(mail({ recipients: to, text: "I have a grievance about how this was handled." })).cls).toBe("grievance")
    expect(classify(mail({ recipients: to, text: "Remove me from your list, please." })).cls).toBe("data_request")
  })

  test("a legal class is never changed: grievance stays grievance even with 'delete my data'; data_request stays data_request; review stays review", () => {
    for (const cls of ["grievance", "data_request", "review"] as const) {
      const r = classify(mail({ recipients: [replyToAddress(cls, REF)], text: "delete my data. this is a complaint." }))
      expect(r.cls).toBe(cls)
      expect(r.rule).toBe("tag")
      expect(r.escalatedFrom).toBeNull()
    }
    expect(classify(mail({ outbound: outbound("grievance"), text: "delete my data" })).cls).toBe("grievance")
  })

  test("quoted text, the attribution and everything after it are not the person's words: our digest quoted back is not a request", () => {
    const quoted = [
      "Thanks.",
      "",
      "On Mon, 28 Sep 2026 at 06:00, VERIDIAN AI DPDP <dpdp@veridian-aios.com> wrote:",
      "> Acme: DPDP this week - 1 escalated to you",
      "> Late by 3 days. This job escalates twice as fast.",
      "> Stop these weekly emails (statutory notices continue): https://x.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=abc",
    ].join("\n")
    const r = classify(mail({ recipients: [replyToAddress("monday", REF)], text: quoted }))
    expect(r.cls).toBe("monday")
    expect(r.escalatedFrom).toBeNull()
    // The same words as the person's own, above the marker, do escalate.
    expect(classify(mail({ recipients: [replyToAddress("monday", REF)], text: `Please unsubscribe me.\n\n${quoted}` })).cls).toBe("data_request")
  })

  test("our own subject echoed in a reply is not read (it says 'escalated to you' and 'Data Protection Board'); a subject the person wrote is", () => {
    const echoes = [
      "Re: [VERIDIAN DPDP · Monday] Acme: DPDP this week — 3 open jobs, 1 escalated to you",
      "RE: [VERIDIAN DPDP · Statutory] 72-hour clock: data leak at Acme — tell the Data Protection Board",
      "Re: [VERIDIAN DPDP · Statutory] OVERDUE Rights request RR-1 at Acme — past its 90-day limit",
    ]
    for (const subject of echoes) {
      const r = classify(mail({ recipients: [replyToAddress("monday", REF)], subject, text: "Noted, thanks." }))
      expect(r.cls).toBe("monday")
      expect(r.escalatedFrom).toBeNull()
    }
    const own = classify(mail({ recipients: [replyToAddress("monday", REF)], subject: "Delete my data", text: "" }))
    expect(own.cls).toBe("data_request")
    expect(own.escalatedFrom).toBe("monday")
    expect(matchEscalation("[VERIDIAN DPDP · Monday] 1 escalated to you", "thanks")).toBeNull()
    expect(matchEscalation("escalated to you", "thanks")?.cls).toBe("grievance")
  })

  test("the escalation runs ONLY the data_request and grievance rules, in that order", () => {
    expect(matchEscalation("", "what is your pricing? need help with my invoice, partner?")).toBeNull()
    expect(matchEscalation("", "I have a complaint. Please delete my data.")?.cls).toBe("data_request")
    expect(matchEscalation("", "I have a complaint.")?.cls).toBe("grievance")
    expect(matchKeywords("", "what is your pricing?", ["data_request", "grievance"])).toBeNull()
    expect(matchKeywords("", "what is your pricing?")?.cls).toBe("sales")
  })

  test("only the first 4096 characters of what was written are read, as for the keyword rules", () => {
    const filler = "lorem ipsum ".repeat(400).slice(0, 4096)
    expect(classify(mail({ recipients: [replyToAddress("monday", REF)], text: `${filler} unsubscribe` })).cls).toBe("monday")
    expect(classify(mail({ recipients: [replyToAddress("monday", REF)], text: `unsubscribe ${filler}` })).cls).toBe("data_request")
  })

  test("a Hindi / Hinglish request escalates too", () => {
    expect(classify(mail({ recipients: [replyToAddress("monday", REF)], text: "मेरा डेटा हटाएं" })).cls).toBe("data_request")
    expect(classify(mail({ outbound: outbound("invoice"), text: "meri shikayat hai" })).cls).toBe("grievance")
  })

  test("the reason keeps the origin and stays short: no message text beyond the matched phrase", () => {
    const r = classify(mail({ recipients: [replyToAddress("invoice", REF)], text: `${"x ".repeat(80)}please DELETE   my   data now ${"y ".repeat(80)}` }))
    expect(r.reason).toBe('tag:inv; escalated keyword:data_request:"delete my data"')
  })

  test("the sales+outbound rewrite escalates from sales_chain", () => {
    const r = classify(mail({ recipients: [replyToAddress("sales", REF)], outbound: outbound("sales", { ref: REF, matchedBy: "ref" }), text: "I want to withdraw consent" }))
    expect(r.cls).toBe("data_request")
    expect(r.escalatedFrom).toBe("sales_chain")
    expect(r.reason).toContain("sales_chain")
  })

  test("escalation is deterministic and does not mutate its input", () => {
    const input = Object.freeze(mail({ recipients: Object.freeze([replyToAddress("monday", REF)]) as unknown as string[], headers: Object.freeze({ precedence: "bulk" }) as Record<string, string>, text: "delete my data" }))
    expect(classify(input)).toEqual(classify(input))
  })
})

describe("parsers", () => {
  test("bareAddress", () => {
    expect(bareAddress("Asha M <Asha@Example.ORG>")).toBe("asha@example.org")
    expect(bareAddress('"Doe, John" <john@x.example>')).toBe("john@x.example")
    expect(bareAddress("  plain@x.example,")).toBe("plain@x.example")
    expect(bareAddress("<a+b@x.example>")).toBe("a+b@x.example")
    expect(bareAddress("no address here")).toBe("")
    expect(bareAddress("")).toBe("")
    expect(bareAddress("<>")).toBe("")
  })
  test("normalizeMessageId", () => {
    expect(normalizeMessageId(" <AbC.123@Host.Example> ")).toBe("abc.123@host.example")
    expect(normalizeMessageId("plain@host")).toBe("plain@host")
  })
  test("extractMessageIds: newest reference first, In-Reply-To before References, unique, capped", () => {
    expect(extractMessageIds(["<c@h>", "<a@h> <b@h> <c@h>"])).toEqual(["c@h", "b@h", "a@h"])
    expect(extractMessageIds([null, undefined, ""])).toEqual([])
    expect(extractMessageIds(["<A@H> garbage <a@h>"])).toEqual(["a@h"])
    const many = Array.from({ length: 50 }, (_, i) => `<m${i}@h>`).join(" ")
    expect(extractMessageIds([many]).length).toBe(20)
    expect(extractMessageIds([many], 5).length).toBe(5)
  })
  test("stripQuoted keeps unquoted lines and stops at a reply marker", () => {
    expect(stripQuoted("a\n> b\nc\nOn Tue, 1 Sep 2026, X <x@y.z> wrote:\nd")).toBe("a\nc")
    expect(stripQuoted("a\r\n> b\r\nc")).toBe("a\nc")
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Added in the adversarial review of the hardening pass (2026-09-29). Every case below was run through the REAL classify()
// before the fix and came out as `monday` / `clock` (or `review` by luck, untagged): a consent withdrawal or a rights
// request that is not a legal-clock class misses its clock. The owner's rule: nothing is demoted, a legal request never
// misses its clock. The ones that were already `data_request` / `grievance` stay so.
// ---------------------------------------------------------------------------------------------------------------
describe("review: withdrawals and requests as people really type them, on the two channels they arrive on", () => {
  const MON = [replyToAddress("monday", REF)]
  const CLK = [replyToAddress("clock", REF)]
  const digestSubject = "Re: [VERIDIAN DPDP · Monday] Acme: DPDP this week - 1 escalated to you"

  const DATA_REQUESTS = [
    "Stop.", "STOP", "stop!", "Please stop", "please stop these", "Stop the emails", "stop it now",
    "No more emails please", "no more newsletters", "Please don't send me these anymore", "Don't send me any more mails", "do not email us again",
    "I do not wish to receive further communication", "I don't want to receive these", "I never subscribed to this", "I did not sign up for this",
    "Unsub", "cancel my subscription", "Please cancel the newsletter",
    "close my account and delete everything", "I want my account closed: deactivate my account", "data deletion request", "account removal please",
    "Send me all the data you have on me", "What is the information you hold about me?", "Do you hold my data? Tell me.", "I want my data back",
    "Update my phone number in your records", "Please correct my name in your records", "Kindly do not share my data with third parties",
    "I object to the processing of my data", "Nominate my brother as my nominee under the DPDP Act",
    "I no longer wish to receive this", "Kindly discontinue these mails", "I don’t want these emails", "कृपया माझा डेटा हटवा.",
    "mail band karo", "ye email sab band kijiye", "mujhe ye mail nahi chahiye", "mujhe mera data chahiye",
    "मुझे ये मेल नहीं चाहिए", "ये ईमेल बंद करो", "मुझे मेरा डेटा चाहिए", "मेरी अनुमति वापस", "मुझे मेरी जानकारी चाहिए",
  ]
  const GRIEVANCES = [
    "You have ignored my earlier request", "You are ignoring me", "This is the third time I am writing", "It is my 2nd reminder", "Still no answer from you",
    "I will approach the court", "I am going to file a case", "my personal data was leaked because of you", "someone hacked my data",
    "Aapne meri baat nahi suni", "aapne mujhe ignore kiya", "reply nahi aaya", "मैं उपभोक्ता न्यायालय जाऊँगा", "आपने मेरा अनुरोध अनदेखा कर दिया", "मेरा डेटा लीक हो गया",
    "I will sue you", "My lawyer will contact you", "I am reporting this to the DPB and MeitY", "I will go to the cyber crime police",
  ]

  for (const text of DATA_REQUESTS) {
    test(`data request: "${text}" (untagged, and as a reply to the Monday digest and to a statutory notice)`, () => {
      expect(classify(mail({ text })).cls).toBe("data_request")
      const mon = classify(mail({ recipients: MON, subject: digestSubject, text, outbound: outbound("monday", { ref: REF, matchedBy: "ref" }) }))
      expect(mon.cls).toBe("data_request")
      expect(mon.escalatedFrom).toBe("monday")
      const clk = classify(mail({ recipients: CLK, subject: "Re: [VERIDIAN DPDP · Statutory] 72-hour clock", text }))
      expect(clk.cls).toBe("data_request")
      expect(clk.escalatedFrom).toBe("clock")
    })
  }
  for (const text of GRIEVANCES) {
    test(`grievance: "${text}" (as a reply to the Monday digest and to a statutory notice)`, () => {
      for (const to of [MON, CLK]) {
        const r = classify(mail({ recipients: to, text }))
        expect(r.cls).toBe("grievance")
        expect(r.rule).toBe("escalation")
      }
    })
  }

  test("ordinary replies are not raised: thanks, a visit, non-stop, a signature", () => {
    for (const text of [
      "Thanks, noted.", "Can you stop by our office on Monday?", "Will stop by tomorrow", "Non-stop support, well done.", "Thanks for the update, we do not send invoices by post.",
      "Regards,\nAsha\nHead of Sales", "Yes, done.", "Received, will review this week.",
      "How do I stop this error from appearing on the report page?", "The second time this week the job list looked right. Good.",
      "We keep our data in Excel; please send the records you have for FY24.", "We will close our accounts on 31 March.", "Our nominee director will sign.",
      "I have not signed up yet.", "Hamara email band ho gaya hai", "मेरा ईमेल बंद हो गया है", "Please stop the app from crashing, I cannot open the page.",
    ]) {
      const r = classify(mail({ recipients: MON, subject: digestSubject, text }))
      expect(r.cls, text).toBe("monday")
      expect(r.escalatedFrom, text).toBeNull()
    }
    // Untagged, "stop by" is not a withdrawal either: it stays the safe default.
    expect(classify(mail({ text: "Can you stop by our office on Monday?" })).cls).toBe("review")
  })

  test("a phone keyboard types don’t with a typographic apostrophe (U+2019): it is the same as don't", () => {
    for (const text of [
      "Please don’t email me again", "Don’t send me these emails", "I don’t want to receive these", "I didn’t subscribe to this", "PLEASE DON’T CONTACT ME",
      "Don`t contact me", "do not contact me", "Don‘t contact me",
    ]) {
      const r = classify(mail({ recipients: MON, subject: digestSubject, text }))
      expect(r.cls, text).toBe("data_request")
      expect(r.escalatedFrom, text).toBe("monday")
    }
    expect(classify(mail({ recipients: MON, subject: digestSubject, text: "you haven’t replied to my request" })).cls).toBe("grievance")
    expect(classify(mail({ recipients: MON, subject: digestSubject, text: "Sorry, I haven’t replied earlier, thanks" })).cls).toBe("monday")
    // ... and a support word with one still reads as support
    expect(classify(mail({ text: "I can’t log in" })).cls).toBe("support")
  })

  test("a withdrawal typed into the subject of a reply that keeps our prefix is read; our own words in that subject are not", () => {
    const own = "[VERIDIAN DPDP · Monday] Acme: DPDP this week - 1 escalated to you"
    for (const subject of [`Re: ${own} UNSUBSCRIBE`, "Re: [VERIDIAN DPDP · Monday] Unsubscribe", "Re: [VERIDIAN DPDP · Monday] DELETE MY DATA", `Re: ${own} - please stop`]) {
      const r = classify(mail({ recipients: MON, subject, text: "" }))
      expect(r.cls, subject).toBe("data_request")
      expect(r.escalatedFrom, subject).toBe("monday")
    }
    expect(classify(mail({ recipients: MON, subject: `Re: ${own}`, text: "Noted, thanks." })).cls).toBe("monday")
    // A grievance word typed into an echoed subject is NOT read (ours says "escalated" and "Data Protection Board"); one in the body is.
    expect(classify(mail({ recipients: MON, subject: "Re: [VERIDIAN DPDP · Monday] complaint", text: "Noted." })).cls).toBe("monday")
    expect(classify(mail({ recipients: MON, subject: "Re: [VERIDIAN DPDP · Monday] x", text: "This is a complaint." })).cls).toBe("grievance")
    expect(matchEscalation("[VERIDIAN DPDP · Monday] x", "a complaint. Delete my data.")?.cls).toBe("data_request")
  })

  test("none of the subjects we really send contains a data_request word (the rules that are run on an echoed subject)", () => {
    const links: RenderLinks = { signIn: null, actions: null, unsubscribeUrl: "https://x.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=u1", appHome: "https://app.veridian-aios.com/app/" }
    const recipient = { membershipId: "m1", identityId: "i1", email: "owner@example.test", role: "owner" as const }
    const digest: Digest = {
      membershipId: "m1", identityId: "i1", orgId: "o1", orgName: "Acme & Co", orgProduct: "firm", email: "staff@example.test", level: "owner", roleKind: "owner",
      referralCode: "ref1", inviteCode: "join1", weekKey: "2026-W39", today: "2026-09-21", unsubscribed: false, statutoryOnly: false, alreadySentThisWeek: false,
      owners: [{ membershipId: "mo", email: "owner@example.test" }], coordinators: [], jobs: [], escalatedToMe: [],
    }
    const subjects = [
      renderDigest(digest, links, "monday_digest").subject, renderDigest(digest, links, "statutory").subject, renderDigest(digest, links, "escalation").subject,
      renderLeakClock({ breachId: "b1", orgId: "o1", orgName: "Acme & Co", becameAwareAt: "2026-09-27T10:00:00Z", deadlineAt: "2026-09-30T10:00:00Z", hoursLeft: 40, boardNotified: false, individualsNotified: false, scopePersonCount: 12, periodKey: "k", recipients: [recipient] }, recipient, links).subject,
      renderLeakClock({ breachId: "b1", orgId: "o1", orgName: "Acme & Co", becameAwareAt: "2026-09-27T10:00:00Z", deadlineAt: "2026-09-26T10:00:00Z", hoursLeft: -4, boardNotified: false, individualsNotified: false, scopePersonCount: 12, periodKey: "k", recipients: [recipient] }, recipient, links).subject,
      renderRightsClock({ requestId: "r1", ref: "RR-7", kind: "erasure", orgId: "o1", orgName: "Acme & Co", receivedAt: "2026-07-01T00:00:00Z", dueAt: "2026-09-29T00:00:00Z", daysLeft: 20, periodKey: "k", recipients: [recipient] }, recipient, links).subject,
      renderRightsClock({ requestId: "r1", ref: "RR-7", kind: "erasure", orgId: "o1", orgName: "Acme & Co", receivedAt: "2026-07-01T00:00:00Z", dueAt: "2026-09-01T00:00:00Z", daysLeft: -28, periodKey: "k", recipients: [recipient] }, recipient, links).subject,
      "Your VERIDIAN receipt -- Acme & Co (Rs 9,999)",
    ]
    expect(subjects.length).toBe(8)
    for (const s of subjects) {
      expect(matchKeywords(`[VERIDIAN DPDP · Monday] ${s}`, "", ["data_request"]), s).toBeNull()
      const r = classify(mail({ recipients: MON, subject: `Re: [VERIDIAN DPDP · Monday] ${s}`, text: "Noted, thanks." }))
      expect(r.cls, s).toBe("monday")
    }
  })

  test("a reply in a script the keyword rules cannot read is a review, never the class of its tag; Hindi and Marathi are read", () => {
    for (const text of ["என் தரவை நீக்கவும்", "আমার তথ্য মুছে ফেলুন", "મારો ડેટા કાઢી નાખો", "میرا ڈیٹا حذف کریں", "ధన్యవాదాలు"]) {
      for (const recipients of [MON, [replyToAddress("clock", REF)]]) {
        const r = classify(mail({ recipients, text }))
        expect(r.cls, text).toBe("review")
        expect(r.reason, text).toContain("written in a script the classifier has no keywords for")
      }
    }
    expect(classify(mail({ text: "என் தரவை நீக்கவும்" })).cls).toBe("review")
    expect(classify(mail({ recipients: MON, text: "धन्यवाद, मिल गया।" })).cls).toBe("monday")
    expect(classify(mail({ recipients: MON, text: "कृपया माझा डेटा हटवा" })).cls).toBe("data_request")
    expect(classify(mail({ recipients: MON, text: "Thanks.\n> என் தரவை நீக்கவும்" })).cls).toBe("monday")
  })

  test("a billing remark about the invoice is not a withdrawal: 'don't send me the invoice again' stays on the invoice thread", () => {
    const inv = (text: string) => classify(mail({ recipients: [replyToAddress("invoice", REF)], outbound: outbound("invoice", { ref: REF, matchedBy: "ref" }), text }))
    expect(inv("Don't send me the invoice again, I already paid.").cls).toBe("invoice")
    expect(inv("Please do not send me these invoices anymore.").cls).toBe("data_request")
  })

  test("`stop` counts as a line of its own, not as a syllable: 'bus stop', 'stopped working' and 'stop by' do not", () => {
    for (const text of ["the bus stop is near", "the login stopped working", "please stop by", "unstoppable"]) {
      expect(matchEscalation("", text), text).toBeNull()
    }
    expect(matchEscalation("", "Hello\nstop\nThanks")?.cls).toBe("data_request")
    expect(matchEscalation("Stop", "")?.cls).toBe("data_request")
  })
})

describe("review: a reply with nothing of the person's own above the quoted original is not filed under its tag", () => {
  const MON = [replyToAddress("monday", REF)]
  const attribution = "On Mon, 28 Sep 2026 at 06:00, VERIDIAN AI DPDP <dpdp@veridian-aios.com> wrote:"
  const quotedDigest = [attribution, "> Acme: DPDP this week - 1 escalated to you", "> Stop these weekly emails (statutory notices continue): https://x.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=abc"].join("\n")

  test("nothingAboveTheQuote: true only when there is text and none of it is the person's", () => {
    expect(nothingAboveTheQuote(`${quotedDigest}\n\nPlease delete my data.`)).toBe(true)
    expect(nothingAboveTheQuote("> quoted\n> also quoted")).toBe(true)
    expect(nothingAboveTheQuote("-----Original Message-----\nFrom: x\nunsubscribe")).toBe(true)
    expect(nothingAboveTheQuote("Thanks.\n\n" + quotedDigest)).toBe(false)
    expect(nothingAboveTheQuote("")).toBe(false)
    expect(nothingAboveTheQuote("   \n\n ")).toBe(false)
    expect(nothingAboveTheQuote("... ---")).toBe(false)
    expect(nothingAboveTheQuote("👍")).toBe(false)
    expect(nothingAboveTheQuote("धन्यवाद")).toBe(false)
  })

  test("a bottom-posted request under the quoted digest (Thunderbird's default) is a review, not a Monday reply", () => {
    const r = classify(mail({ recipients: MON, subject: "Re: [VERIDIAN DPDP · Monday] Acme: DPDP this week", text: `${quotedDigest}\n\nPlease delete my data.` }))
    expect(r.cls).toBe("review")
    expect(r.rule).toBe("escalation")
    expect(r.escalatedFrom).toBe("monday")
    expect(r.confidence).toBe("low")
    expect(r.reason).toBe("tag:mon; nothing above the quoted original (a reply typed below it cannot be read safely)")
  })

  test("an answer interleaved under the quoted lines, with nothing above, is a review too", () => {
    const text = `${attribution}\n> Stop these weekly emails\nYes, stop these and remove me from your list\n> Data Protection Board`
    expect(classify(mail({ recipients: MON, text })).cls).toBe("review")
    expect(classify(mail({ outbound: outbound("invoice"), text })).cls).toBe("review")
    expect(classify(mail({ recipients: [replyToAddress("clock", REF)], text })).cls).toBe("review")
  })

  test("a quoted-only forward is a review; the same words with a line of the person's own above stay under the tag", () => {
    expect(classify(mail({ text: "-----Original Message-----\nFrom: A\nSent: x\nTo: B\nSubject: Invoice INV-42\n\nPay now", subject: "Fwd: Invoice INV-42" })).cls).toBe("review")
    expect(classify(mail({ recipients: MON, text: "FYI\n" + quotedDigest })).cls).toBe("monday")
    expect(classify(mail({ recipients: MON, text: "Ok" })).cls).toBe("monday")
  })

  test("it changes nothing for the other paths: a legal tag, an auto reply, a bounce, an empty mail", () => {
    const quotedOnly = `${quotedDigest}\n\nsome answer`
    expect(classify(mail({ recipients: [replyToAddress("grievance", REF)], text: quotedOnly })).cls).toBe("grievance")
    expect(classify(mail({ recipients: MON, text: quotedOnly, headers: { "auto-submitted": "auto-replied" } })).cls).toBe("auto")
    expect(classify(mail({ recipients: MON, text: quotedOnly, senders: ["mailer-daemon@example.org"], headers: { "return-path": "<>" } })).cls).toBe("auto")
    expect(classify(mail({ recipients: MON, text: "" })).cls).toBe("monday")
  })

  test("a review of this kind is a legal-clock class: it gets a ticket with a due date and an acknowledgement", () => {
    const r = classify(mail({ recipients: MON, text: `${quotedDigest}\n\nstop` }))
    expect(LEGAL_CLOCK_CLASSES.includes(r.cls)).toBe(true)
    expect(r.strongAuto).toBe(false)
    expect(r.autoSignals).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Added in the adversarial review of the classifier (2026-09-29, second reviewer). The List-Unsubscribe mailto of every digest
// and notice is dpdp+dsr.<ref>@ with the SAME ref as the Monday / statutory row, so the lookup matches a Monday or clock row, not an
// acknowledgement. A mail client that adds Auto-Submitted / Precedence to that automatic unsubscribe, with no words in it, was filed
// as `auto` (logged, nobody told): a consent withdrawal that missed its clock without a trace.
// ---------------------------------------------------------------------------------------------------------------
describe("review: an automatic List-Unsubscribe mailto (legal tag, ref of a Monday / statutory row) is never hidden by an auto header", () => {
  const DSR = [replyToAddress("data_request", REF)]
  for (const [label, headers] of [
    ["Auto-Submitted: auto-generated", { "auto-submitted": "auto-generated" }],
    ["Precedence: bulk", { precedence: "bulk" }],
    ["X-Autoreply present", { "x-autoreply": "yes" }],
  ] as const) {
    for (const row of ["monday", "clock"] as const) {
      test(`${label}, empty subject and body, matched to a ${row} row: data_request under its tag, operator told`, () => {
        const r = classify(mail({ recipients: DSR, subject: "", text: "", headers, outbound: outbound(row, { ref: REF, matchedBy: "ref" }) }))
        expect(r.cls).toBe("data_request")
        expect(r.rule).toBe("tag")
        expect(r.autoSignals.length).toBeGreaterThan(0)
        expect(r.reason).toContain("auto-mail headers ignored for a legal tag that is not a reply to our own acknowledgement")
      })
    }
  }
  test("a reply to our OWN acknowledgement with the same headers is still auto (the auto-responder loop): the matched outbound row carries a ticket number", () => {
    const headers = { "auto-submitted": "auto-replied" }
    for (const cls of ["grievance", "data_request", "review"] as const) {
      const r = classify(mail({ recipients: [replyToAddress(cls, REF)], subject: "", text: "", headers, outbound: outbound(cls, { ref: REF, matchedBy: "ref", ticketNo: "G-2026-0001" }) }))
      expect(r.cls).toBe("auto")
      expect(r.autoHeadersIgnored).toBe(false)
    }
    // a ticket number alone (an acknowledgement row of any class) is enough to divert it
    expect(classify(mail({ recipients: DSR, text: "", headers, outbound: outbound("monday", { ref: REF, ticketNo: "D-2026-0001" }) })).cls).toBe("auto")
  })
  test("an outbound row that is NOT an acknowledgement (no ticket number) never stops a legal tag standing alone, whatever its class", () => {
    const headers = { "auto-submitted": "auto-replied" }
    // Only the ticket number makes an outbound row an acknowledgement. A row of a legal class without one (never produced by our senders) is not the loop.
    for (const row of ["monday", "clock", "invoice", "sales", "grievance", "data_request", "review"] as const) {
      for (const tag of ["grievance", "data_request", "review"] as const) {
        const r = classify(mail({ recipients: [replyToAddress(tag, REF)], subject: "", text: "", headers, outbound: outbound(row, { ref: REF, matchedBy: "ref" }) }))
        expect(r.cls, `${row} row, ${tag} tag`).toBe(tag)
        expect(r.rule).toBe("tag")
        expect(r.autoHeadersIgnored).toBe(true)
      }
    }
  })
  test("a legal tag with auto headers and NO words at all is a ticketed legal channel: the class stands, autoHeadersIgnored is set, and it is not escalated from anything", () => {
    const headerSets: Array<Record<string, string>> = [{ "auto-submitted": "auto-generated" }, { precedence: "bulk" }, { "x-autoreply": "" }, { "auto-submitted": "auto-replied", precedence: "auto_reply" }]
    for (const headers of headerSets) {
      const r = classify(mail({ recipients: DSR, subject: "", text: "", headers }))
      expect(r.cls).toBe("data_request")
      expect(r.rule).toBe("tag")
      expect(r.escalatedFrom).toBeNull()
      expect(r.autoHeadersIgnored).toBe(true)
      expect(r.strongAuto).toBe(false)
    }
    // without any auto header the flag stays false
    expect(classify(mail({ recipients: DSR, subject: "", text: "" })).autoHeadersIgnored).toBe(false)
    // and a NON-legal tag never sets it (it is diverted to auto instead)
    const mon = classify(mail({ recipients: [replyToAddress("monday", REF)], text: "", headers: { precedence: "bulk" } }))
    expect(mon.cls).toBe("auto")
    expect(mon.autoHeadersIgnored).toBe(false)
  })
  test("a machine-only signal still beats a legal tag: a bounce is a bounce", () => {
    const r = classify(mail({ recipients: DSR, text: "", contentType: "multipart/report", headers: { precedence: "bulk" } }))
    expect(r.cls).toBe("auto")
    expect(r.autoHeadersIgnored).toBe(false)
  })
  test("the same headers on a NON-legal tag are still diverted; words in the message still escalate", () => {
    const headers = { "auto-submitted": "auto-generated" }
    expect(classify(mail({ recipients: [replyToAddress("monday", REF)], text: "", headers, outbound: outbound("monday", { ref: REF, matchedBy: "ref" }) })).cls).toBe("auto")
    expect(classify(mail({ recipients: [replyToAddress("monday", REF)], text: "Please delete my data.", headers, outbound: outbound("monday", { ref: REF, matchedBy: "ref" }) })).cls).toBe("data_request")
  })
})

describe("review: an auto-reply subject is recognised at the START of the subject, not by three words in the middle of a person's", () => {
  test("ordinary mail whose subject merely contains the words is read, not filed as auto", () => {
    const inv = { recipients: [replyToAddress("invoice", REF)], outbound: outbound("invoice", { ref: REF, matchedBy: "ref" }) }
    const undelivered = classify(mail({ ...inv, subject: "Re: Undelivered invoice - not received", text: "We did not get the invoice email." }))
    expect(undelivered.cls).toBe("invoice")
    expect(undelivered.autoSignals).toEqual([])
    expect(classify(mail({ subject: "Support needed out of office hours", text: "Can we get help after 6pm?" })).cls).toBe("support")
    expect(classify(mail({ subject: "Do you support auto-reply templates? pricing?", text: "Interested in a demo." })).cls).toBe("sales")
    expect(classify(mail({ subject: "Our courier: delivery failure, need a receipt", text: "" })).autoSignals).toEqual([])
  })
  test("human subjects that merely contain or resemble the words are not auto, with or without a legal word in them", () => {
    for (const [subject, text, want] of [
      ["Undelivered invoice - not received", "We did not get the invoice email.", "invoice"],
      ["Support needed out of office hours", "Can we get help after 6pm?", "support"],
      ["Do you support auto-reply templates? pricing?", "Interested in a demo.", "sales"],
      ["Out of office hours: can you call us?", "Need help with login.", "support"],
      ["Out of the office hours support, please", "Need help with login.", "support"],
      ["Auto-replies not working - help", "Our templates are not sending.", "support"],
      ["Automatic replies for our helpdesk - pricing?", "Interested in a demo.", "sales"],
      ["Mail delivery problem - help", "Emails do not arrive.", "support"],
      ["Quick question about return mail for invoices", "please send a receipt", "invoice"],
    ] as const) {
      const r = classify(mail({ subject, text }))
      expect(r.cls, subject).toBe(want)
      expect(r.autoSignals, subject).toEqual([])
      expect(r.strongAuto).toBe(false)
    }
    // ... and a subject that DOES open with the words but carries a legal one is a data request, not a bounce (a header-class signal never hides it)
    const legal = classify(mail({ subject: "Undeliverable? please delete my data", text: "" }))
    expect(legal.cls).toBe("data_request")
    expect(legal.escalatedFrom).toBe("auto")
    expect(legal.strongAuto).toBe(false)
  })
  test("an auto-reply / bounce subject is also recognised behind a gateway's [tag] and after Re: / Fwd: (anchored, not searched for)", () => {
    for (const subject of ["[External] Out of Office: back Monday", "Re: [EXT] Automatic reply: hi", "FW: [SPAM?] Undeliverable: hi", "RE: RE: [Ext] Out-of-office"]) {
      const r = classify(mail({ subject, text: "" }))
      expect(r.cls, subject).toBe("auto")
      expect(r.autoSignals, subject).toEqual(["auto-reply style subject"])
    }
    // The tag does not open the door to a search: the words must follow it directly.
    expect(classify(mail({ subject: "[External] Question about Out of Office replies", text: "" })).autoSignals).toEqual([])
    expect(classify(mail({ subject: "[Invoice] Undelivered invoice", text: "" })).autoSignals).toEqual([])
  })
  test("the real thing still is auto, also behind Re: / Fwd: / AW: and an opening bracket", () => {
    for (const subject of [
      "Re: Automatic reply: Your message", "Fwd: Out of Office: back Monday", "AW: Automatische Antwort: Abwesend", "[Auto-Reply] Your message",
      "  Undeliverable: [VERIDIAN DPDP · Monday] Your week", "Undelivered Mail Returned to Sender", "Automatic reply: Re: [VERIDIAN DPDP · Monday] Acme: DPDP this week",
    ]) {
      const r = classify(mail({ subject, text: "" }))
      expect(r.cls, subject).toBe("auto")
      expect(r.autoSignals, subject).toContain("auto-reply style subject")
    }
  })
  test("words that would be a request still escalate an auto-reply subject", () => {
    expect(classify(mail({ subject: "Automatic reply: thanks", text: "Please delete my data." })).cls).toBe("data_request")
  })
})

describe("review: the class LABEL in the subject of our own acknowledgement is not a request", () => {
  // withSubjectPrefix(cls, ...) gives "[VERIDIAN DPDP · DATA REQUEST] ..." for an acknowledgement of a data request: two of the words the
  // data_request rules look for. Replies to it echo that subject.
  const ackSubject = (cls: MailClass) => `[VERIDIAN DPDP · ${cls === "data_request" ? "DATA REQUEST" : cls === "grievance" ? "GRIEVANCE" : "REVIEW"}] We received your message (ticket X-2026-0001)`
  for (const cls of ["data_request", "grievance", "review"] as const) {
    test(`an out-of-office reply to our ${cls} acknowledgement stays auto (nobody is told, no new ticket clock)`, () => {
      const r = classify(mail({
        recipients: [replyToAddress(cls, REF)], senders: ["ravi@corp.example"], subject: `Automatic reply: ${ackSubject(cls)}`, text: "I am out of office until 5 October.",
        headers: { "auto-submitted": "auto-replied" }, outbound: outbound(cls, { ref: REF, matchedBy: "ref", ticketNo: "X-2026-0001" }),
      }))
      expect(r.cls).toBe("auto")
      expect(r.escalatedFrom).toBeNull()
    })
    test(`matchEscalation over an echoed ${cls} acknowledgement subject with nothing typed finds nothing`, () => {
      expect(matchEscalation(`Re: ${ackSubject(cls)}`, "")).toBeNull()
    })
  }
  test("what a person types after the label is still read, in the subject of a reply", () => {
    expect(matchEscalation("Re: [VERIDIAN DPDP · DATA REQUEST] We received your message (ticket D-2026-0001) - please delete my data", "")?.cls).toBe("data_request")
    expect(matchEscalation("Re: [VERIDIAN DPDP · Monday] Acme: DPDP this week - Unsubscribe", "")?.cls).toBe("data_request")
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Second review of the classifier (2026-09-29). Every phrase below was run through the REAL classify() as a reply to the Monday digest
// and stayed `monday` (no D- / G- ticket, no due date, no acknowledgement). A benign corpus must stay where it was.
// ---------------------------------------------------------------------------------------------------------------
describe("review 2: more withdrawals, objections, rights requests and chasers, as people type them", () => {
  const MON = [replyToAddress("monday", REF)]
  const subject = "Re: [VERIDIAN DPDP · Monday] Acme: DPDP this week"
  const DATA_REQUESTS = [
    "I do not consent to this.", "I don't consent to this", "You added me without my consent", "Do not use my data for marketing.", "Stop using my personal data.",
    "Please do not process my data any further.", "Cease processing my information.", "Please remove my name.", "Kindly remove my number from your system.",
    "Remove my email id from the list", "Kindly unlist me", "Leave me alone.", "Please take my email off the mailing list", "Not interested, don't contact again.",
    "Never contact me again", "Don't call anymore", "I would like to exercise my rights under the DPDP Act.", "I am exercising my data rights",
    "mera email hata do", "mera number hata dijiye", "मेरा नंबर हटा दीजिए", "मेरा ईमेल सूची से निकाल दें", "कृपया मुझे मेल न भेजें", "आगे से मेल मत भेजिए",
    "नमस्ते, कृपया इसे बंद करें", "मुझे ये नहीं चाहिए",
  ]
  const GRIEVANCES = ["This is unacceptable, I will take this further", "That was completely unacceptable", "Where is my response?", "No action taken on my earlier email", "No steps have been taken"]
  for (const text of DATA_REQUESTS) {
    test(`data request: "${text}"`, () => {
      const r = classify(mail({ recipients: MON, subject, text, outbound: outbound("monday", { ref: REF, matchedBy: "ref" }) }))
      expect(r.cls).toBe("data_request")
      expect(r.escalatedFrom).toBe("monday")
    })
  }
  for (const text of GRIEVANCES) {
    test(`grievance: "${text}"`, () => {
      expect(classify(mail({ recipients: MON, subject, text })).cls).toBe("grievance")
    })
  }
  test("ordinary replies stay a Monday reply", () => {
    for (const text of [
      "Thanks, received.", "Ok noted", "Will check and revert", "धन्यवाद", "We do not use spreadsheets any more, only your app.", "We don't share screens in review calls.",
      "Please remove the duplicate entry from the job list.", "We will stop using paper registers from April.", "No action needed from your side.", "No action required, all done.",
      "The price is high for a small firm? Kindly share a quote.", "Call me tomorrow, any time works.",
      "Our name and number are in the footer.", "It takes a further two days to finish.", "Where is my login page? I found it.",
      "The auditor will exercise judgement on this.", "I consent to the terms, thanks.",
    ]) {
      const r = classify(mail({ recipients: MON, subject, text, outbound: outbound("monday", { ref: REF, matchedBy: "ref" }) }))
      expect(r.cls, text).toBe("monday")
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Third review of the classifier (owner decisions, 2026-09-29): a message the Worker cut short, our own words in a marker-less echo, and a
// satisfied "no complaints".
// ---------------------------------------------------------------------------------------------------------------
describe("review 3: a message the Worker cut short with too little of the person's own text is a review", () => {
  const MON = [replyToAddress("monday", REF)]
  const tooShort = ["", "   ", "Ok thanks", "Hi,\n\nRegards,\nAsha", "> quoted\n> also quoted", "-----Original Message-----\nFrom: x\nunsubscribe", "12345 ----- !!!"]

  test("readableLetters counts the person's own letters, in any script, and nothing else", () => {
    expect(TRUNCATED_MIN_LETTERS).toBe(20)
    expect(readableLetters("")).toBe(0)
    expect(readableLetters("12345 ---- !!!")).toBe(0)
    expect(readableLetters("> quoted words\nHello")).toBe(5)
    expect(readableLetters("Hello, world")).toBe(10)
    expect(readableLetters("Thanks.\n\nOn Mon, 28 Sep 2026 at 06:00, X <x@y.example> wrote:\nlots of quoted words here")).toBe(6)
    expect(readableLetters("मेरा डेटा हटाएं")).toBeGreaterThanOrEqual(12) // combining vowel signs count: Indic words are not undercounted
    expect(readableLetters("Stop these weekly emails (statutory notices continue): https://x.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=abc")).toBe(0)
  })

  for (const text of tooShort) {
    test(`truncated + ${JSON.stringify(text)} on a Monday reply is a review (legal-clock class), not a Monday reply`, () => {
      const r = classify(mail({ recipients: MON, text, truncated: true }))
      expect(r.cls).toBe("review")
      expect(r.rule).toBe("escalation")
      expect(r.escalatedFrom).toBe("monday")
      expect(r.confidence).toBe("low")
      expect(LEGAL_CLOCK_CLASSES.includes(r.cls)).toBe(true)
    })
  }

  test("the reason says why, and keeps where the class came from", () => {
    const r = classify(mail({ recipients: MON, text: "", truncated: true }))
    expect(r.reason).toBe("tag:mon; the message was cut short and too little of the person's own text was read to classify it")
    const byThread = classify(mail({ outbound: outbound("invoice", { ref: REF, matchedBy: "ref" }), text: "ok", truncated: true }))
    expect(byThread.reason).toBe(`thread:invoice(ref:${REF}); the message was cut short and too little of the person's own text was read to classify it`)
    expect(byThread.escalatedFrom).toBe("invoice")
  })

  test("without the flag the very same messages are unchanged", () => {
    for (const text of ["", "Ok thanks", "> quoted\nHello"]) {
      expect(classify(mail({ recipients: MON, text })).cls, text).toBe("monday")
      expect(classify(mail({ recipients: MON, text, truncated: false })).cls, text).toBe("monday")
    }
  })

  test("20 readable letters of the person's own text is enough to read; 19 is not", () => {
    const nineteen = "abcdefghij klmnopqrs" // 19 letters
    expect(readableLetters(nineteen)).toBe(19)
    expect(classify(mail({ recipients: MON, text: nineteen, truncated: true })).cls).toBe("review")
    expect(classify(mail({ recipients: MON, text: `${nineteen}t`, truncated: true })).cls).toBe("monday")
    expect(classify(mail({ recipients: MON, text: "Thanks, noted, will revert next week.", truncated: true })).cls).toBe("monday")
  })

  test("a keyword hit in what WAS read still wins over the truncation rule: a data request stays a data request", () => {
    const r = classify(mail({ recipients: MON, text: "Delete my data", truncated: true }))
    expect(r.cls).toBe("data_request")
    expect(r.escalatedFrom).toBe("monday")
    expect(classify(mail({ text: "pricing?", truncated: true })).cls).toBe("review") // a non-legal keyword class is raised: 7 letters cannot be trusted
    expect(classify(mail({ text: "pricing?", truncated: true })).escalatedFrom).toBe("sales")
  })

  test("it does not touch a legal class, a machine signal or our own mailbox", () => {
    expect(classify(mail({ recipients: [replyToAddress("grievance", REF)], text: "", truncated: true })).cls).toBe("grievance")
    expect(classify(mail({ recipients: [replyToAddress("grievance", REF)], text: "", truncated: true })).escalatedFrom).toBeNull()
    expect(classify(mail({ recipients: MON, text: "", truncated: true, contentType: "multipart/report" })).cls).toBe("auto")
    expect(classify(mail({ recipients: MON, text: "", truncated: true, senders: [MAILBOX] })).cls).toBe("auto")
  })

  test("nor a header-based auto signal that has real text behind it; with none it is a review, so a big message cannot hide a request behind a sender-chosen header", () => {
    const headers = { "auto-submitted": "auto-replied" }
    const empty = classify(mail({ recipients: MON, text: "", truncated: true, headers }))
    expect(empty.cls).toBe("review")
    expect(empty.rule).toBe("escalation")
    expect(empty.escalatedFrom).toBe("auto")
    expect(empty.autoSignals).toEqual(["Auto-Submitted=auto-replied"])
    expect(empty.reason).toBe("auto:Auto-Submitted=auto-replied; the message was cut short and too little of the person's own text was read to classify it")
    // untruncated, or truncated with a full vacation message: still auto
    expect(classify(mail({ recipients: MON, text: "", headers })).cls).toBe("auto")
    expect(classify(mail({ recipients: MON, text: "I am out of the office until the fifth of October.", truncated: true, headers })).cls).toBe("auto")
  })

  test("an untagged, unclassifiable message is a review anyway; the flag changes only the reason's route", () => {
    expect(classify(mail({ text: "", truncated: true })).cls).toBe("review")
  })
})

describe("review 3: our own words in a marker-less echo, in full, are boilerplate (drift test over the WHOLE rendered emails)", () => {
  const MON = [replyToAddress("monday", REF)]
  const links: RenderLinks = {
    signIn: "https://x.supabase.co/auth/v1/verify?token=abc", actions: { ob1: { done: "https://app.veridian-aios.com/act/#t1", cannot: "https://app.veridian-aios.com/act/#t2", neverHadAny: "https://app.veridian-aios.com/act/#t3" } },
    unsubscribeUrl: "https://x.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=u1", appHome: "https://app.veridian-aios.com/app/",
  }
  const recipient = { membershipId: "m1", identityId: "i1", email: "owner@example.test", role: "owner" as const }
  // Job TITLES are the organisation's own data ("Publish the grievance officer's details") and cannot be recognised as ours: neutral ones here.
  const job = (over: Partial<DigestJob> = {}): DigestJob => ({
    obligationId: "ob1", key: "k1", what: "Renew the registration certificate", part: 1, dueOn: "2026-09-25", daysLate: 0, late: false, requiredToday: false, isGroup: false,
    groupLabel: null, assigneeEmail: "staff@example.test", isMine: true, stuck: false, outsideParty: false, ...over,
  })
  const digest = (over: Partial<Digest> = {}): Digest => ({
    membershipId: "m1", identityId: "i1", orgId: "o1", orgName: "Acme & Co", orgProduct: "firm", email: "owner@example.test", level: "owner", roleKind: "owner",
    referralCode: "ref1", inviteCode: "join1", weekKey: "2026-W39", today: "2026-09-21", unsubscribed: false, statutoryOnly: false, alreadySentThisWeek: false,
    owners: [{ membershipId: "mo", email: "owner@example.test" }], coordinators: [{ membershipId: "mc", email: "coord@example.test" }], jobs: [], escalatedToMe: [], ...over,
  })
  const jobs: DigestJob[] = [
    job({ daysLate: 3, late: true, requiredToday: true }),
    job({ obligationId: "ob2", key: "k2", what: "Update the vendor list", daysLate: 20, late: true, isGroup: true, groupLabel: "the accounts team", assigneeEmail: null }),
    job({ obligationId: "ob3", key: "k3", what: "Review the retention schedule", stuck: true, isMine: false }),
    job({ obligationId: "ob4", key: "k4", what: "Confirm the processor list", daysLate: 9, late: true, outsideParty: true, isMine: false, assigneeEmail: "ca@firm.example" }),
    job({ obligationId: "ob5", key: "k5", what: "Check the notice text", isMine: false }),
  ]
  const escalated = (["stuck", "late_owner", "outside_party_silent", "late_coordinator", null] as const).map((reason, i) => ({
    obligationId: `e${i}`, what: "Renew the registration certificate", assigneeEmail: i % 2 ? null : "staff@example.test", daysLate: 4 + i, requiredToday: i % 2 === 0, stuck: reason === "stuck", outsideParty: reason === "outside_party_silent", reason,
  }))

  const leak = (hoursLeft: number, boardNotified: boolean, individualsNotified: boolean, scope: number | null): Rendered =>
    renderLeakClock({ breachId: "b1", orgId: "o1", orgName: "Acme & Co", becameAwareAt: "2026-09-27T10:00:00Z", deadlineAt: "2026-09-30T10:00:00Z", hoursLeft, boardNotified, individualsNotified, scopePersonCount: scope, periodKey: "k", recipients: [recipient] }, recipient, links)
  const rights = (kind: string, daysLeft: number): Rendered =>
    renderRightsClock({ requestId: "r1", ref: "RR-7", kind, orgId: "o1", orgName: "Acme & Co", receivedAt: "2026-07-01T00:00:00Z", dueAt: "2026-09-29T00:00:00Z", daysLeft, periodKey: "k", recipients: [recipient] }, recipient, links)

  const emails: Array<[string, Rendered]> = [
    ["owner digest (jobs, escalations, billing banner)", renderDigest(digest({ jobs, escalatedToMe: escalated, subscriptionState: "trial" }), links, "monday_digest")],
    ["owner digest with nothing escalated", renderDigest(digest({ jobs: [jobs[4]] }), links, "monday_digest")],
    ["coordinator digest (escalated to you as coordinator)", renderDigest(digest({ level: "staff", roleKind: "coord", jobs, escalatedToMe: escalated }), links, "monday_digest")],
    ["staff digest with nothing for them", renderDigest(digest({ level: "staff", roleKind: "staff", jobs: [] }), links, "monday_digest")],
    ["statutory-only digest", renderDigest(digest({ jobs, escalatedToMe: escalated, statutoryOnly: true }), links, "statutory")],
    ["leak clock (40 hours left, nobody told)", leak(40, false, false, 12)],
    ["leak clock (overdue, board and people told)", leak(-4, true, true, null)],
    ["leak clock (8 hours left, board told)", leak(8, true, false, 3)],
    ...["erasure", "access", "correction", "grievance", "nomination"].flatMap((kind): Array<[string, Rendered]> =>
      [20, -28].map((daysLeft): [string, Rendered] => [`rights clock ${kind} (${daysLeft} days)`, rights(kind, daysLeft)])),
  ]

  /** Lines that would still be read as the person's own words AND raise a data request or a grievance. */
  const raisingLines = (text: string): string[] => stripQuoted(text).split("\n").filter((line) => matchKeywords("", line, ["data_request", "grievance"]) !== null)
  /** One sentence per line (after a full stop or a semicolon). */
  const perSentence = (text: string): string => text.replace(/([.;])[ \t]+(?=\S)/g, "$1\n")

  test("there are emails of every kind in the corpus (so a renderer that stops producing one fails loudly here, not silently)", () => {
    expect(emails.length).toBe(5 + 3 + 10)
    const all = emails.map(([, e]) => e.text).join("\n")
    for (const needle of ["escalated to you below", "ESCALATED TO YOU AS OWNER", "ESCALATED TO YOU AS DPDP COORDINATOR", "escalates twice as fast", "Data Protection Board", "erasure request", "this notice repeats daily until it is", "action=unsubscribe"]) {
      expect(all, needle).toContain(needle)
    }
  })

  for (const [name, email] of emails) {
    test(`${name}: nothing in the whole text is read as a data request or a grievance once our own boilerplate is dropped`, () => {
      expect(raisingLines(email.text)).toEqual([])
      expect(matchEscalation("", email.text)).toBeNull()
    })
    test(`${name}: also with one sentence per line (an auto-responder that reflows the text leaves each sentence on a line of its own)`, () => {
      // The long paragraphs of these emails are single lines; split, each sentence must be recognised by ITSELF, not by a neighbour on its line.
      expect(raisingLines(perSentence(email.text))).toEqual([])
    })
    test(`${name}: echoed with no marker, on a Monday tag, it stays a Monday reply (no ticket, no due date, no acknowledgement)`, () => {
      const r = classify(mail({ recipients: MON, text: `Thanks.\n${email.text}` }))
      expect(r.cls).toBe("monday")
      expect(r.escalatedFrom).toBeNull()
      expect(classify(mail({ recipients: MON, text: `Thanks.\n${perSentence(email.text)}` })).cls).toBe("monday")
    })
  }

  test("a person's own sentence that shares words with our boilerplate is still read", () => {
    const own: Array<[string, MailClass]> = [
      ["Hi\nPlease stop these weekly emails.\nThanks", "data_request"],
      ["Please stop these weekly emails and delete my data", "data_request"],
      ["I will tell the Data Protection Board about this.", "grievance"],
      ["A erasure request was made by me and nobody answered.", "data_request"],
      ["Still to do: nothing, but I want to complain to the Data Protection Board", "grievance"],
      ["Your reply to my request escalates nothing. I will sue you.", "grievance"],
    ]
    for (const [text, want] of own) {
      const r = classify(mail({ recipients: MON, text }))
      expect(r.cls, text).toBe(want)
    }
  })

  test("the template-shaped footer line is still dropped (text and HTML variants) so the digest's own unsubscribe link raises nothing", () => {
    expect(matchKeywords("", "Stop these weekly emails (statutory notices continue): https://x.supabase.co/f?action=unsubscribe&t=1")).toBeNull()
    expect(matchKeywords("", "VERIDIAN AI — One Portal. One Truth. · Stop these weekly emails — you will still get statutory notices.")).toBeNull()
    expect(matchKeywords("", "Stop these weekly emails (statutory notices continue)")?.cls).toBe("data_request") // not the template: no colon and no link
  })
})

describe("review 3: a negated complaint is not a grievance", () => {
  const MON = [replyToAddress("monday", REF)]
  const NEGATED = [
    "No complaints from our side, thanks", "no complaint", "We have no complaints.", "There were no further complaints.", "no major complaint so far",
    "This is not a complaint, just a question.", "It isn't a complaint", "It’s not a complaint", "I am not complaining", "Nothing to complain about", "Working fine without any complaint",
    "Not my complaint, sorry",
  ]
  for (const text of NEGATED) {
    test(`"${text}" raises nothing (a reply to the Monday digest stays a Monday reply; untagged it stays unclassified)`, () => {
      expect(matchKeywords("", text, ["grievance"]), text).toBeNull()
      expect(classify(mail({ recipients: MON, text })).cls, text).toBe("monday")
      expect(classify(mail({ text })).cls, text).toBe("review")
    })
  }
  test("only the negated phrase is blanked: a real complaint in the same message, or a data request, still raises", () => {
    expect(classify(mail({ recipients: MON, text: "No complaints so far, but I have a complaint about billing." })).cls).toBe("grievance")
    expect(classify(mail({ recipients: MON, text: "I have a complaint. Also, no complaints about the rest." })).cls).toBe("grievance")
    expect(classify(mail({ recipients: MON, text: "No complaints, but please delete my data." })).cls).toBe("data_request")
    expect(classify(mail({ recipients: MON, text: "Not a complaint: withdraw my consent." })).cls).toBe("data_request")
  })
  test("a complaint ABOUT a missing channel, or an unresolved one, is left alone", () => {
    for (const text of ["There is no complaint redressal mechanism on your site.", "no complaint has been resolved", "You have no complaint handling process", "no complaint officer replied"]) {
      expect(matchKeywords("", text, ["grievance"])?.cls, text).toBe("grievance")
    }
  })
  test("every other grievance word is untouched: no response, breach, harassment ... still raise", () => {
    for (const text of ["no response from you", "there was a data breach", "I am being harassed", "this is a grievance", "I wish to complain to the Board", "This is a complaint."]) {
      expect(classify(mail({ recipients: MON, text })).cls, text).toBe("grievance")
    }
  })
})
