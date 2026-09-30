/// <reference types="bun-types" />
// Offline proof of mail-taxonomy.ts, the one place that says what kinds of mail dpdp@veridian-aios.com
// sends and receives and how a kind is written into (and read back out of) an address and a subject.
// Round trips for every class, malformed tags, the ref alphabet, subject-prefix idempotence and the
// operator-notification subject. Pure: no database, no network.
//
// Run (bunfig.toml sets the test root to src/, so this file is not found by a bare `bun test`; name it):
//   bun test --isolate supabase/functions/_shared/mail-taxonomy.test.ts
import { describe, expect, test } from "bun:test"
import {
  CLASS_LABEL, CLASS_TAG, LEGAL_CLOCK_CLASSES, MAILBOX, MAILBOX_DOMAIN, MAILBOX_LOCAL, MAIL_CLASSES, NOTIFY_CLASSES, REF_LENGTH,
  isValidRef, newRef, notificationSubject, outboundHeaders, parseRecipient, replyToAddress, subjectPrefix, withSubjectPrefix,
  type MailClass,
} from "./mail-taxonomy.ts"

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
const REF = "k3f9x2ab7q"

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const bytesOf = (values: number[]) => (n: number) => Uint8Array.from({ length: n }, (_, i) => values[i % values.length])

describe("constants", () => {
  test("the one public address", () => {
    expect(MAILBOX).toBe("dpdp@veridian-aios.com")
    expect(MAILBOX).toBe(`${MAILBOX_LOCAL}@${MAILBOX_DOMAIN}`)
  })
  test("eleven classes, each with a unique three-letter lower-case tag and a non-empty label", () => {
    expect(MAIL_CLASSES.length).toBe(11)
    expect(new Set(MAIL_CLASSES).size).toBe(11)
    const tags = MAIL_CLASSES.map((c) => CLASS_TAG[c])
    expect(new Set(tags).size).toBe(11)
    for (const t of tags) expect(t).toMatch(/^[a-z]{3}$/)
    const labels = MAIL_CLASSES.map((c) => CLASS_LABEL[c])
    expect(new Set(labels).size).toBe(11)
    for (const l of labels) expect(l.trim().length).toBeGreaterThan(0)
  })
  test("the tags are frozen: they are in every address ever sent, so a rename would orphan replies", () => {
    expect(CLASS_TAG).toEqual({
      monday: "mon", clock: "clk", sales: "sal", sales_chain: "sch", invoice: "inv", grievance: "grv",
      data_request: "dsr", partner: "prt", support: "sup", auto: "aut", review: "rev",
    })
  })
  test("legal-clock classes are grievance, data_request and review; only auto is not notified", () => {
    expect([...LEGAL_CLOCK_CLASSES].sort()).toEqual(["data_request", "grievance", "review"])
    expect([...NOTIFY_CLASSES].sort()).toEqual(MAIL_CLASSES.filter((c) => c !== "auto").sort())
    expect(NOTIFY_CLASSES).not.toContain("auto")
    for (const c of LEGAL_CLOCK_CLASSES) expect(NOTIFY_CLASSES).toContain(c)
  })
  test("clock (a statutory notice WE sent): tag clk, label Statutory, notified, and NOT a legal-clock class -- a reply is escalated by keyword instead", () => {
    expect(MAIL_CLASSES).toContain("clock")
    expect(CLASS_TAG.clock).toBe("clk")
    expect(CLASS_LABEL.clock).toBe("Statutory")
    expect(NOTIFY_CLASSES).toContain("clock")
    expect(LEGAL_CLOCK_CLASSES).not.toContain("clock")
  })
})

describe("refs", () => {
  test("a ref is REF_LENGTH characters of the 32-glyph alphabet with no i, l, o or u", () => {
    expect(REF_LENGTH).toBe(10)
    for (const banned of "ilou") expect(ALPHABET).not.toContain(banned)
    expect(ALPHABET.length).toBe(32)
  })
  test("newRef with injected bytes is deterministic and wraps modulo 32", () => {
    expect(newRef(bytesOf([0]))).toBe("0000000000")
    expect(newRef(bytesOf([31]))).toBe("zzzzzzzzzz")
    expect(newRef(bytesOf([32]))).toBe("0000000000")
    expect(newRef(bytesOf([255]))).toBe("zzzzzzzzzz")
    expect(newRef(bytesOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe("0123456789")
    expect(newRef(bytesOf([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]))).toBe("abcdefghjk")
  })
  test("newRef asks for exactly REF_LENGTH bytes", () => {
    let asked = -1
    newRef((n) => { asked = n; return new Uint8Array(n) })
    expect(asked).toBe(REF_LENGTH)
  })
  test("the default random source gives valid, distinct refs", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const r = newRef()
      expect(isValidRef(r)).toBe(true)
      seen.add(r)
    }
    expect(seen.size).toBe(1000)
  })
  test("isValidRef accepts only the exact shape", () => {
    expect(isValidRef(REF)).toBe(true)
    expect(isValidRef("0000000000")).toBe(true)
    expect(isValidRef("zzzzzzzzzz")).toBe(true)
    for (const bad of ["", "k3f9x2ab7", "k3f9x2ab7qq", "K3F9X2AB7Q", "k3f9x2ab7i", "k3f9x2ab7l", "k3f9x2ab7o", "k3f9x2ab7u", " k3f9x2ab7q", "k3f9x2ab7q ", "k3f9x2ab7-", "k3f9x2ab7\n", "k3f9x2ab7q\n"]) {
      expect(isValidRef(bad)).toBe(false)
    }
  })
})

describe("replyToAddress <-> parseRecipient round trip", () => {
  test("every class, twenty refs each", () => {
    const next = rng(7)
    for (const cls of MAIL_CLASSES) {
      for (let i = 0; i < 20; i++) {
        const ref = newRef((n) => Uint8Array.from({ length: n }, () => Math.floor(next() * 256)))
        const address = replyToAddress(cls, ref)
        expect(address).toBe(`dpdp+${CLASS_TAG[cls]}.${ref}@veridian-aios.com`)
        expect(parseRecipient(address)).toEqual({ ours: true, cls, ref })
      }
    }
  })
  test("survives case changes, angle brackets and surrounding whitespace", () => {
    const a = replyToAddress("invoice", REF)
    expect(parseRecipient(a.toUpperCase())).toEqual({ ours: true, cls: "invoice", ref: REF })
    expect(parseRecipient(`<${a}>`)).toEqual({ ours: true, cls: "invoice", ref: REF })
    expect(parseRecipient(`  ${a}\n`)).toEqual({ ours: true, cls: "invoice", ref: REF })
  })
  test("replyToAddress refuses a ref that is not valid", () => {
    for (const bad of ["", "short", "K3F9X2AB7Q", "k3f9x2ab7i", "k3f9x2ab7qq"]) {
      let message = ""
      try { replyToAddress("monday", bad) } catch (e) { message = e instanceof Error ? e.message : String(e) }
      expect(message).toContain("invalid mail ref")
    }
  })
})

describe("parseRecipient on the plain address and malformed tags", () => {
  const NOT_OURS = { ours: false, cls: null, ref: null }
  const OURS_UNTAGGED = { ours: true, cls: null, ref: null }
  test("the plain mailbox, in any case, is ours with no class and no ref", () => {
    expect(parseRecipient(MAILBOX)).toEqual(OURS_UNTAGGED)
    expect(parseRecipient("DPDP@Veridian-AIOS.com")).toEqual(OURS_UNTAGGED)
    expect(parseRecipient("<dpdp@veridian-aios.com>")).toEqual(OURS_UNTAGGED)
  })
  test("an empty or nonsense tag is ours but names nothing", () => {
    for (const a of ["dpdp+@veridian-aios.com", "dpdp+.@veridian-aios.com", "dpdp+zzz@veridian-aios.com", "dpdp+grvx.k3f9x2ab7q@veridian-aios.com"]) {
      const p = parseRecipient(a)
      expect(p.ours).toBe(true)
      expect(p.cls).toBeNull()
    }
  })
  test("a known tag with a missing or malformed ref keeps the class and drops the ref", () => {
    for (const a of [
      "dpdp+grv@veridian-aios.com", "dpdp+grv.@veridian-aios.com", "dpdp+grv.tooshort@veridian-aios.com",
      "dpdp+grv.K3F9X2AB7I@veridian-aios.com", "dpdp+grv.a.b@veridian-aios.com",
    ]) {
      expect(parseRecipient(a)).toEqual({ ours: true, cls: "grievance", ref: null })
    }
  })
  test("an unknown tag with a valid ref keeps the ref (the outbound lookup can still use it)", () => {
    expect(parseRecipient(`dpdp+zzz.${REF}@veridian-aios.com`)).toEqual({ ours: true, cls: null, ref: REF })
    expect(parseRecipient(`dpdp++grv.${REF}@veridian-aios.com`)).toEqual({ ours: true, cls: null, ref: REF })
  })
  test("extra dot segments after the ref are ignored", () => {
    expect(parseRecipient(`dpdp+grv.${REF}.extra@veridian-aios.com`)).toEqual({ ours: true, cls: "grievance", ref: REF })
  })
  test("other domains, sub-domains, look-alikes and other local parts are not ours", () => {
    for (const a of [
      `dpdp+grv.${REF}@example.com`, `dpdp+grv.${REF}@send.veridian-aios.com`, "dpdp@veridian-aios.com.evil.example",
      "xdpdp@veridian-aios.com", "dpdpx@veridian-aios.com", "info@veridian-aios.com", "grievance@veridian-aios.com",
    ]) {
      expect(parseRecipient(a)).toEqual(NOT_OURS)
    }
  })
  test("things that are not addresses are not ours and do not throw", () => {
    for (const a of ["", " ", "@", "dpdp@", "@veridian-aios.com", "dpdp", "a@b@c", "dpdp @veridian-aios.com", "<>", "\u0000", "dpdp+grv.k3f9x2ab7q@veridian-aios.com extra"]) {
      expect(parseRecipient(a)).toEqual(NOT_OURS)
    }
  })
  test("a display name is NOT stripped here (callers pass a bare address)", () => {
    expect(parseRecipient(`Asha <${replyToAddress("grievance", REF)}>`)).toEqual(NOT_OURS)
  })
  test("never throws on 1000 random strings built from address characters", () => {
    const next = rng(99)
    const chars = "dpdp+.@<> -_veridian-aios.comgrvk3f9x2ab7qMONZ\u0000éह"
    for (let i = 0; i < 1000; i++) {
      const s = Array.from({ length: Math.floor(next() * 40) }, () => chars[Math.floor(next() * chars.length)]).join("")
      const p = parseRecipient(s)
      expect(typeof p.ours).toBe("boolean")
      if (p.cls !== null) expect(MAIL_CLASSES).toContain(p.cls as MailClass)
      if (p.ref !== null) expect(isValidRef(p.ref)).toBe(true)
    }
  })
})

describe("subject prefix", () => {
  test("the exact visible prefix for every class", () => {
    for (const cls of MAIL_CLASSES) {
      expect(subjectPrefix(cls)).toBe(`[VERIDIAN DPDP · ${CLASS_LABEL[cls]}] `)
      expect(withSubjectPrefix(cls, "Your week")).toBe(`[VERIDIAN DPDP · ${CLASS_LABEL[cls]}] Your week`)
    }
  })
  test("applying it twice changes nothing (idempotent), for every class", () => {
    for (const cls of MAIL_CLASSES) {
      const once = withSubjectPrefix(cls, "Your week")
      expect(withSubjectPrefix(cls, once)).toBe(once)
      expect(withSubjectPrefix(cls, withSubjectPrefix(cls, once))).toBe(once)
    }
  })
  test("a subject that already carries a prefix of ANOTHER class is left alone, never stacked", () => {
    const monday = withSubjectPrefix("monday", "Your week")
    expect(withSubjectPrefix("invoice", monday)).toBe(monday)
  })
  test("surrounding whitespace is trimmed", () => {
    expect(withSubjectPrefix("support", "  Help needed \n")).toBe("[VERIDIAN DPDP · Support] Help needed")
    expect(withSubjectPrefix("support", `  ${withSubjectPrefix("support", "x")}  `)).toBe("[VERIDIAN DPDP · Support] x")
  })
  test("the statutory-notice class reads [VERIDIAN DPDP · Statutory]", () => {
    expect(subjectPrefix("clock")).toBe("[VERIDIAN DPDP · Statutory] ")
    expect(withSubjectPrefix("clock", "72-hour clock: data leak at Acme")).toBe("[VERIDIAN DPDP · Statutory] 72-hour clock: data leak at Acme")
    expect(replyToAddress("clock", REF)).toBe(`dpdp+clk.${REF}@veridian-aios.com`)
    expect(parseRecipient(`dpdp+clk.${REF}@veridian-aios.com`)).toEqual({ ours: true, cls: "clock", ref: REF })
  })
  test("an empty subject still gets the prefix", () => {
    expect(withSubjectPrefix("monday", "")).toBe("[VERIDIAN DPDP · Monday] ")
  })
  // KNOWN LIMITATION, pinned so a change is noticed and not silent: the guard is startsWith("[VERIDIAN DPDP"),
  // so a REPLY subject ("Re: [VERIDIAN DPDP · Monday] ...") is prefixed a second time. Nothing in the platform
  // prefixes a reply subject (every outbound message, including the acknowledgement, carries a subject written
  // for it), so this does not occur today. If a caller ever does, fix the guard in mail-taxonomy.ts and
  // update this test in the same change.
  test("KNOWN LIMITATION: a Re:/Fwd: subject that already contains the prefix is prefixed again", () => {
    expect(withSubjectPrefix("invoice", "Re: [VERIDIAN DPDP · Monday] x")).toBe("[VERIDIAN DPDP · Invoice] Re: [VERIDIAN DPDP · Monday] x")
  })
})

describe("outboundHeaders", () => {
  test("stamps the class and the ref, nothing else", () => {
    for (const cls of MAIL_CLASSES) {
      expect(outboundHeaders(cls, REF)).toEqual({ "X-Veridian-Class": cls, "X-Veridian-Ref": REF })
    }
  })
})

describe("notificationSubject", () => {
  test("[LABEL ticket] original subject", () => {
    expect(notificationSubject("grievance", "G-2026-0042", "my complaint")).toBe("[GRIEVANCE G-2026-0042] my complaint")
    expect(notificationSubject("data_request", "D-2026-0001", "Delete my data")).toBe("[DATA REQUEST D-2026-0001] Delete my data")
    expect(notificationSubject("sales_chain", "T-2026-0007", "Quote")).toBe("[Sales thread T-2026-0007] Quote")
    expect(notificationSubject("clock", "K-2026-0001", "Re: 72-hour clock")).toBe("[Statutory K-2026-0001] 72-hour clock")
  })
  test("one leading Re: / Fwd: / Fw: is removed, in any case", () => {
    expect(notificationSubject("grievance", "G-1", "Re: my complaint")).toBe("[GRIEVANCE G-1] my complaint")
    expect(notificationSubject("grievance", "G-1", "RE:   my complaint")).toBe("[GRIEVANCE G-1] my complaint")
    expect(notificationSubject("grievance", "G-1", "FWD: x")).toBe("[GRIEVANCE G-1] x")
    expect(notificationSubject("grievance", "G-1", "Fw: x")).toBe("[GRIEVANCE G-1] x")
    expect(notificationSubject("grievance", "G-1", "  re : x")).toBe("[GRIEVANCE G-1] x")
  })
  test("only one level is removed (Re: Re: keeps the second)", () => {
    expect(notificationSubject("grievance", "G-1", "Re: Re: x")).toBe("[GRIEVANCE G-1] Re: x")
  })
  test("a subject that merely contains 're' is untouched", () => {
    expect(notificationSubject("support", "H-1", "Reminder: password")).toBe("[Support H-1] Reminder: password")
    expect(notificationSubject("support", "H-1", "Fwdx: y")).toBe("[Support H-1] Fwdx: y")
  })
  test("an empty subject reads (no subject)", () => {
    expect(notificationSubject("review", "R-2026-0003", "")).toBe("[REVIEW R-2026-0003] (no subject)")
    expect(notificationSubject("review", "R-2026-0003", "   ")).toBe("[REVIEW R-2026-0003] (no subject)")
    expect(notificationSubject("review", "R-2026-0003", "Re:")).toBe("[REVIEW R-2026-0003] (no subject)")
  })
})
