/// <reference types="bun-types" />
// Offline proof of classify.ts (the DPDP single-mailbox inbound classifier): every class, every rule
// ordering the design fixes, the auto-mail headers, Hindi / Hinglish samples, thread inheritance and
// the never-drop default. No database, no network, no clock: classify() is pure.
//
// Run (bunfig.toml sets the test root to src/, so this file, which lives beside the function, is not
// found by a bare `bun test`; name it): bun test --isolate supabase/functions/dpdp-inbound-mail/classify.test.ts
import { describe, expect, test } from "bun:test"
import { MAIL_CLASSES, MAILBOX, replyToAddress, type MailClass } from "../_shared/mail-taxonomy.ts"
import {
  autoSignals, bareAddress, classify, extractMessageIds, matchKeywords, normalizeMessageId, stripQuoted,
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
    ["monday", "monday"], ["sales", "sales"], ["sales_chain", "sales_chain"], ["invoice", "invoice"],
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

  test("a tag beats every keyword rule", () => {
    const r = classify(mail({ recipients: [replyToAddress("invoice", REF)], subject: "Please delete my data", text: "I want to withdraw consent. This is a complaint." }))
    expect(r.cls).toBe("invoice")
    expect(r.rule).toBe("tag")
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

  test("an aut tag together with a strong auto signal is auto", () => {
    const r = classify(mail({ recipients: [replyToAddress("auto", REF)], headers: { "auto-submitted": "auto-replied" } }))
    expect(r.cls).toBe("auto")
  })
})

describe("thread match (rule b)", () => {
  const INHERIT: Array<[MailClass, MailClass]> = [
    ["monday", "monday"], ["sales", "sales_chain"], ["sales_chain", "sales_chain"], ["invoice", "invoice"],
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

  test("a thread match beats keywords", () => {
    const r = classify(mail({ outbound: outbound("monday"), text: "please delete my data, this is a complaint" }))
    expect(r.cls).toBe("monday")
  })

  test("a thread match beats auto-mail headers, but the signals are still reported", () => {
    const r = classify(mail({ outbound: outbound("monday"), headers: { "auto-submitted": "auto-replied" }, subject: "Automatic reply: Monday" }))
    expect(r.cls).toBe("monday")
    expect(r.strongAuto).toBe(true)
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

describe("auto mail (rule c): strong signals always mean auto", () => {
  const STRONG: Array<[string, Partial<ClassifyInput>]> = [
    ["MAILER-DAEMON sender", { senders: ["MAILER-DAEMON@mx.example.org"] }],
    ["postmaster sender", { senders: ["Mail Delivery <postmaster@mx.example.org>"] }],
    ["empty Return-Path", { headers: { "return-path": "<>" } }],
    ["Auto-Submitted: auto-replied", { headers: { "auto-submitted": "auto-replied" } }],
    ["Auto-Submitted: auto-generated", { headers: { "auto-submitted": "auto-generated" } }],
    ["Auto-Submitted: auto-notified; with a comment", { headers: { "auto-submitted": "auto-notified; owner-email=x@y.z" } }],
    ["X-Autoreply", { headers: { "x-autoreply": "yes" } }],
    ["X-Autorespond", { headers: { "x-autorespond": "1" } }],
    ["Precedence: auto_reply", { headers: { precedence: "auto_reply" } }],
    ["multipart/report", { contentType: "multipart/report; report-type=delivery-status; boundary=abc" }],
    ["message/delivery-status via the header map", { headers: { "content-type": "message/delivery-status" } }],
    ["our own X-Veridian-Origin", { headers: { "x-veridian-origin": "inbound-notification" } }],
  ]
  for (const [name, over] of STRONG) {
    test(name, () => {
      const r = classify(mail(over))
      expect(r.cls).toBe("auto")
      expect(r.rule).toBe("auto")
      expect(r.strongAuto).toBe(true)
      expect(r.autoSignals.length).toBeGreaterThan(0)
    })
  }

  test("a strong signal beats every keyword: an out-of-office quoting our unsubscribe text is not a data request", () => {
    const r = classify(mail({ headers: { "auto-submitted": "auto-replied" }, text: "I am away. To unsubscribe from these emails, delete my data, withdraw consent." }))
    expect(r.cls).toBe("auto")
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

  test("presence alone is the signal for X-Autoreply and X-Veridian-Origin: an empty value counts", () => {
    expect(classify(mail({ headers: { "x-autoreply": "" } })).cls).toBe("auto")
    expect(classify(mail({ headers: { "x-veridian-origin": "" } })).cls).toBe("auto")
    expect(classify(mail({ headers: { "x-auto-response-suppress": "" } })).cls).toBe("auto") // weak, nothing else to read
  })

  test("a non-empty Return-Path is not a bounce", () => {
    expect(classify(mail({ headers: { "return-path": "<asha@example.org>" } })).cls).toBe("review")
  })
})

describe("auto mail (rule c): weak signals mean auto only when no keyword rule matches", () => {
  test("Precedence: bulk with nothing to read is auto (medium confidence)", () => {
    const r = classify(mail({ headers: { precedence: "bulk" } }))
    expect(r.cls).toBe("auto")
    expect(r.confidence).toBe("medium")
    expect(r.strongAuto).toBe(false)
  })
  test("Precedence: junk", () => {
    expect(classify(mail({ headers: { precedence: "junk" } })).cls).toBe("auto")
  })
  test("X-Auto-Response-Suppress alone", () => {
    expect(classify(mail({ headers: { "x-auto-response-suppress": "All" } })).cls).toBe("auto")
  })
  test("bulk plus a data-request keyword is still a data request", () => {
    const r = classify(mail({ headers: { precedence: "bulk" }, text: "Please delete my data." }))
    expect(r.cls).toBe("data_request")
    expect(r.reason).toContain("weak auto signal overridden")
  })
  test("X-Auto-Response-Suppress plus a grievance keyword is a grievance", () => {
    expect(classify(mail({ headers: { "x-auto-response-suppress": "DR, OOF" }, text: "This is my third complaint." })).cls).toBe("grievance")
  })
  test("bulk plus a sales keyword is sales (any keyword class blocks the demotion)", () => {
    expect(classify(mail({ headers: { precedence: "bulk" }, text: "What is your pricing?" })).cls).toBe("sales")
  })

  const SUBJECTS = [
    "Out of Office: back Monday", "Out-of-office", "Automatic reply: Your message", "Auto-reply", "Autoreply: thanks",
    "Undeliverable: [VERIDIAN DPDP · Monday] Your week", "Delivery Status Notification (Failure)", "Mail delivery failed: returning message to sender",
    "Returned mail: see transcript for details", "Failure notice", "Away from the office until 5 October",
    "Automatische Antwort: Abwesend", "Réponse automatique : absent", "Respuesta automática: fuera de la oficina",
  ]
  for (const subject of SUBJECTS) {
    test(`subject "${subject}" with no keyword is auto`, () => {
      const r = classify(mail({ subject, text: "" }))
      expect(r.cls).toBe("auto")
      expect(r.strongAuto).toBe(false)
    })
  }
  test("an out-of-office subject with a real request in the body is read, not dropped", () => {
    const r = classify(mail({ subject: "Automatic reply: hello", text: "Actually please erase my account." }))
    expect(r.cls).toBe("data_request")
  })
  test("a MAILER-DAEMON sender with an ordinary subject is strong auto", () => {
    const r = classify(mail({ senders: ["mailer-daemon@googlemail.com"], subject: "Hello", text: "" }))
    expect(r.strongAuto).toBe(true)
  })
})

describe("autoSignals()", () => {
  test("reports strong and weak separately", () => {
    const s = autoSignals({ senders: ["postmaster@x.example"], subject: "Out of office", headers: { precedence: "bulk", "auto-submitted": "auto-generated" } })
    expect(s.strong.length).toBe(2)
    expect(s.weak.length).toBe(2)
  })
  test("nothing for an ordinary human message", () => {
    expect(autoSignals({ senders: ["asha@example.org"], subject: "Question", headers: { "content-type": "text/plain" } })).toEqual({ strong: [], weak: [] })
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
  test("an inline (interleaved) answer is read", () => {
    expect(classify(mail({ text: "> Do you want the demo?\nYes, please delete my data first." })).cls).toBe("data_request")
  })
  test("only the first 4096 characters are read", () => {
    const filler = "lorem ipsum ".repeat(400).slice(0, 4090)
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
  // none of them may come out as auto. Auto is reachable only through self / strong / weak-with-no-keyword.
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
  test("200 random messages with no auto signal are never auto", () => {
    const next = rng(20260929)
    for (let n = 0; n < 200; n++) {
      const words = Array.from({ length: 1 + Math.floor(next() * 30) }, () => VOCAB[Math.floor(next() * VOCAB.length)])
      const r = classify(mail({ subject: words.slice(0, 4).join(" "), text: words.join(" ") }))
      // Subject words can spell an out-of-office; that is the weak signal, and it needs an empty keyword result.
      if (r.cls === "auto") {
        expect(r.rule).toBe("auto")
        expect(r.strongAuto).toBe(false)
        expect(matchKeywords(words.slice(0, 4).join(" "), words.join(" "))).toBeNull()
      }
    }
  })
  test("every class the classifier can return is a real MailClass, and each is reachable", () => {
    const seen = new Set<MailClass>()
    const samples: Partial<ClassifyInput>[] = [
      { recipients: [replyToAddress("monday", REF)] }, { recipients: [replyToAddress("sales", REF)] }, { recipients: [replyToAddress("sales_chain", REF)] },
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
