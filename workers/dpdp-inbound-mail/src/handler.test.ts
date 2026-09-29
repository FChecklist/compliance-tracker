// Tests for the dpdp-inbound-mail Email Worker. Run from this directory:
//   bun test
//
// The message object is a hand-built mock of Cloudflare's
// ForwardableEmailMessage: a real ReadableStream over the raw bytes, plus
// recorders for forward() and setReject(). postal-mime is NOT mocked -- the
// MIME in these tests is really parsed. Only the network (fetch) and the
// clock are replaced.
//
// What these tests cannot show: how the real workerd runtime behaves (CPU
// limits, forward() after reading message.raw, Email Routing itself). The
// README's "wrangler dev" and post-deploy checks cover that.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { isValidRef, parseRecipient } from "../../../supabase/functions/_shared/mail-taxonomy.ts"
import { DEFAULT_MAX_RAW_BYTES, handleInbound, readCapped } from "./handler.ts"
import type { Deps, Env, InboundEmailMessage, InboundMailPayload } from "./handler.ts"
import worker from "./index.ts"
import { FORWARD_ONLY_ROLES, resolveRecipient } from "./recipient.ts"

const SECRET = "test-secret-not-real"
const ENV: Env = {
  DPDP_INBOUND_URL: "https://example.supabase.co/functions/v1/dpdp-inbound-mail",
  DPDP_INBOUND_SECRET: SECRET,
  FALLBACK_FORWARD_TO: "operator@example.com",
}
const FIXED_NOW = new Date("2026-09-29T10:00:00.000Z")

// ---------- helpers ----------

type Tally = { pulled: number; cancelled: boolean }

function chunkedStream(bytes: Uint8Array, chunkSize: number, tally: Tally): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close()
          return
        }
        const end = Math.min(offset + chunkSize, bytes.length)
        controller.enqueue(bytes.subarray(offset, end))
        offset = end
        tally.pulled = end
      },
      cancel() {
        tally.cancelled = true
      },
    },
    { highWaterMark: 0 },
  )
}

type MockMessage = InboundEmailMessage & {
  forwarded: { to: string; headers: Headers | undefined }[]
  rejected: string[]
  tally: Tally
}

function mockMessage(opts: {
  raw: string | Uint8Array | ReadableStream<Uint8Array>
  to?: string
  from?: string
  rawSize?: number
  chunkSize?: number
  forwardImpl?: (to: string, headers?: Headers) => Promise<unknown>
}): MockMessage {
  const tally: Tally = { pulled: 0, cancelled: false }
  const bytes = typeof opts.raw === "string" ? new TextEncoder().encode(opts.raw) : opts.raw
  const raw = bytes instanceof Uint8Array ? chunkedStream(bytes, opts.chunkSize ?? 65536, tally) : bytes
  const forwarded: MockMessage["forwarded"] = []
  const rejected: string[] = []
  return {
    from: opts.from ?? "asha@example.org",
    to: opts.to ?? "dpdp@veridian-aios.com",
    headers: new Headers(),
    raw,
    rawSize: opts.rawSize ?? (bytes instanceof Uint8Array ? bytes.length : 0),
    setReject(reason: string) {
      rejected.push(reason)
    },
    async forward(to: string, headers?: Headers) {
      forwarded.push({ to, headers })
      if (opts.forwardImpl) return opts.forwardImpl(to, headers)
    },
    forwarded,
    rejected,
    tally,
  }
}

function mime(o: {
  from?: string
  to?: string
  subject?: string
  headers?: Record<string, string>
  body?: string
  contentType?: string
  extra?: string
} = {}): string {
  const lines = [
    `From: ${o.from ?? "Asha Rao <asha@example.org>"}`,
    `To: ${o.to ?? "dpdp@veridian-aios.com"}`,
    `Subject: ${o.subject ?? "Hello"}`,
    `Message-ID: <msg-1@example.org>`,
    `Date: Tue, 29 Sep 2026 15:30:00 +0530`,
    `MIME-Version: 1.0`,
    ...Object.entries(o.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    `Content-Type: ${o.contentType ?? "text/plain; charset=utf-8"}`,
    ``,
    o.body ?? "Hello there",
  ]
  return lines.join("\r\n") + (o.extra ?? "")
}

type Call = { url: string; init: RequestInit }

function recordingFetch(status = 200): { fetch: Deps["fetch"]; calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return new Response("{}", { status })
    },
  }
}

function payloadOf(call: Call): InboundMailPayload {
  return JSON.parse(call.init.body as string) as InboundMailPayload
}

const deps = (fetch: Deps["fetch"]): Partial<Deps> => ({ fetch, now: () => FIXED_NOW })

let logs: string[] = []
const realLog = console.log
beforeEach(() => {
  logs = []
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "))
  }
})
afterEach(() => {
  console.log = realLog
})

// ---------- happy path ----------

describe("happy path", () => {
  test("posts the parsed mail once, with the bearer, and does not forward", async () => {
    const msg = mockMessage({
      raw: mime({
        subject: "Pricing question",
        headers: {
          "In-Reply-To": "<out-9@veridian-aios.com>",
          References: "<out-1@veridian-aios.com> <out-9@veridian-aios.com>",
          "Reply-To": "Asha <asha.reply@example.org>",
        },
        body: "Hi,\r\nwhat is the price for 50 users?\r\nThanks",
      }),
      from: "Asha@Example.org",
    })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))

    expect(msg.forwarded).toHaveLength(0)
    expect(msg.rejected).toHaveLength(0)
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call.url).toBe(ENV.DPDP_INBOUND_URL!)
    expect(call.init.method).toBe("POST")
    expect(call.init.redirect).toBe("manual")
    expect(call.init.headers).toEqual({ "content-type": "application/json", authorization: `Bearer ${SECRET}` })

    const p = payloadOf(call)
    expect(p).toMatchObject({
      version: 1,
      received_at: "2026-09-29T10:00:00.000Z",
      envelope_from: "asha@example.org",
      envelope_to: "dpdp@veridian-aios.com",
      envelope_to_raw: "dpdp@veridian-aios.com",
      header_from: "Asha Rao <asha@example.org>",
      from_address: "asha@example.org",
      from_name: "Asha Rao",
      header_to: "dpdp@veridian-aios.com",
      reply_to: "Asha <asha.reply@example.org>",
      subject: "Pricing question",
      message_id: "<msg-1@example.org>",
      in_reply_to: "<out-9@veridian-aios.com>",
      references: "<out-1@veridian-aios.com> <out-9@veridian-aios.com>",
      auto_submitted: null,
      precedence: null,
      x_autoreply: null,
      x_auto_response_suppress: null,
      has_attachments: false,
      truncated: false,
    })
    expect(p.content_type).toContain("text/plain")
    expect(p.text).toBe("Hi,\nwhat is the price for 50 users?\nThanks")
    expect(p.raw_size).toBe(msg.rawSize)
  })

  test("plus-tagged reply address passes through untouched and stays parseable", async () => {
    const to = "dpdp+mon.k3f9x2ab7q@veridian-aios.com"
    const msg = mockMessage({ raw: mime({ to }), to })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    const p = payloadOf(calls[0])
    expect(p.envelope_to).toBe(to)
    const parsed = parseRecipient(p.envelope_to)
    expect(parsed.cls).toBe("monday")
    expect(parsed.ref && isValidRef(parsed.ref)).toBe(true)
  })

  test("auto-reply headers and a delivery-status content type reach the payload for the classifier", async () => {
    const bounce = [
      "From: Mail Delivery Subsystem <MAILER-DAEMON@example.org>",
      "To: dpdp@veridian-aios.com",
      "Subject: Undelivered Mail Returned to Sender",
      "Message-ID: <bounce-1@example.org>",
      "Auto-Submitted: auto-replied",
      "Precedence: bulk",
      "X-Autoreply: yes",
      "X-Auto-Response-Suppress: All",
      'Content-Type: multipart/report; report-type=delivery-status; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Your message could not be delivered.",
      "--b1",
      "Content-Type: message/delivery-status",
      "",
      "Reporting-MTA: dns; example.org",
      "--b1--",
      "",
    ].join("\r\n")
    const msg = mockMessage({ raw: bounce, from: "" })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    const p = payloadOf(calls[0])
    expect(msg.forwarded).toHaveLength(0)
    expect(p.envelope_from).toBe("")
    expect(p.from_address).toBe("mailer-daemon@example.org")
    expect(p.auto_submitted).toBe("auto-replied")
    expect(p.precedence).toBe("bulk")
    expect(p.x_autoreply).toBe("yes")
    expect(p.x_auto_response_suppress).toBe("All")
    expect(p.content_type).toContain("report-type=delivery-status")
    expect(p.text).toContain("could not be delivered")
  })

  test("payload.headers carries the allowlisted headers in classifier shape: lower-cased, presence-preserving, nothing else", async () => {
    const raw = [
      "From: Auto <noreply@example.org>",
      "To: dpdp@veridian-aios.com",
      "Cc: Someone <someone@example.org>",
      "Subject: Out of office",
      "Message-ID: <hdr-1@example.org>",
      "Return-Path: <>",
      "X-Autoreply:",
      "x-veridian-origin: dpdp-monday",
      "Precedence: Auto_Reply",
      "Received: from mail.example.org (mail.example.org [203.0.113.7]) by mx.example.net",
      "X-Mailer: SomeMailer 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "I am away.",
    ].join("\r\n")
    const msg = mockMessage({ raw })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    const p = payloadOf(calls[0])
    expect(p.headers).toEqual({
      "return-path": "<>",
      "x-autoreply": "",
      "x-veridian-origin": "dpdp-monday",
      precedence: "Auto_Reply",
      cc: "Someone <someone@example.org>",
    })
    expect(p.x_autoreply).toBe("") // present but empty: "" (null would mean absent)
    expect(p.auto_submitted).toBeNull()
    expect(Object.keys(p.headers)).not.toContain("received")
    expect(Object.keys(p.headers)).not.toContain("x-mailer")
  })

  test("decodes an RFC 2047 subject and keeps a Hindi body intact", async () => {
    const msg = mockMessage({
      raw: mime({ subject: "=?UTF-8?B?4KSu4KSm4KSm?= chahiye", body: "मेरा डेटा हटाएं" }),
    })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    const p = payloadOf(calls[0])
    expect(p.subject).toBe("मदद chahiye")
    expect(p.text).toBe("मेरा डेटा हटाएं")
  })

  test("reports attachments", async () => {
    const withAttachment = [
      "From: Asha <asha@example.org>",
      "To: dpdp@veridian-aios.com",
      "Subject: Invoice attached",
      "Message-ID: <att-1@example.org>",
      'Content-Type: multipart/mixed; boundary="m1"',
      "",
      "--m1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "See attached.",
      "--m1",
      'Content-Type: application/pdf; name="inv.pdf"',
      'Content-Disposition: attachment; filename="inv.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0xLjQK",
      "--m1--",
      "",
    ].join("\r\n")
    const msg = mockMessage({ raw: withAttachment })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    const p = payloadOf(calls[0])
    expect(p.has_attachments).toBe(true)
    expect(p.text).toBe("See attached.")
  })

  test("html-only mail is stripped to text (scripts, styles and tags gone, entities decoded)", async () => {
    const msg = mockMessage({
      raw: mime({
        contentType: "text/html; charset=utf-8",
        body:
          "<html><head><style>p{color:red}</style></head><body><script>alert('x')</script>" +
          "<p>Please&nbsp;delete my data</p><div>Regards &amp; thanks</div></body></html>",
      }),
    })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    const p = payloadOf(calls[0])
    expect(p.text).toBe("Please delete my data\nRegards & thanks")
  })

  test("the text excerpt is capped at 4096 UTF-8 bytes without splitting a character", async () => {
    const msg = mockMessage({ raw: mime({ body: "मदद ".repeat(3000) }) })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    const p = payloadOf(calls[0])
    const bytes = new TextEncoder().encode(p.text).length
    expect(bytes).toBeLessThanOrEqual(4096)
    expect(bytes).toBeGreaterThan(4000)
    expect(p.text).not.toContain("�")
  })

  test("the default export drives the same pipeline using the global fetch", async () => {
    const realFetch = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      seen.push(String(input))
      return new Response("{}", { status: 200 })
    }) as typeof fetch
    try {
      const msg = mockMessage({ raw: mime() })
      await worker.email(msg, ENV, {})
      expect(seen).toEqual([ENV.DPDP_INBOUND_URL!])
      expect(msg.forwarded).toHaveLength(0)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

// ---------- recipients ----------

describe("recipient handling", () => {
  test.each([
    ["grievance@veridian-aios.com", "dpdp+grv@veridian-aios.com", "grievance"],
    ["Grievance@VERIDIAN-AIOS.COM", "dpdp+grv@veridian-aios.com", "grievance"],
    ["partners@veridian-aios.com", "dpdp+prt@veridian-aios.com", "partner"],
    ["<partners@veridian-aios.com>", "dpdp+prt@veridian-aios.com", "partner"],
  ])("legacy alias %s is treated as %s", async (to, expected, cls) => {
    const msg = mockMessage({ raw: mime({ to }), to })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    expect(msg.rejected).toHaveLength(0)
    expect(calls).toHaveLength(1)
    const p = payloadOf(calls[0])
    expect(p.envelope_to).toBe(expected)
    expect(p.envelope_to_raw).toBe(to.toLowerCase().replace(/^<|>$/g, ""))
    expect(parseRecipient(p.envelope_to).cls).toBe(cls as never)
  })

  test.each([
    "sales@veridian-aios.com",
    "info@veridian-aios.com",
    "dpdp@evil.example",
    "dpdp@send.veridian-aios.com",
    "dpdp2@veridian-aios.com",
    "xdpdp@veridian-aios.com",
    "grievance+x@veridian-aios.com",
    "grievance@evil.example",
    "postmaster+x@veridian-aios.com",
    "abuse+x@veridian-aios.com",
    "postmaster@evil.example",
    "abuse@send.veridian-aios.com",
    "postmasters@veridian-aios.com",
    "not-an-address",
    "",
  ])("unknown recipient %p is refused at the SMTP level, not ticketed, not forwarded", async (to) => {
    const msg = mockMessage({ raw: mime(), to })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    expect(msg.rejected).toEqual(["Unknown recipient"])
    expect(calls).toHaveLength(0)
    expect(msg.forwarded).toHaveLength(0)
    expect(msg.tally.pulled).toBe(0)
  })

  test("an unknown plus-tag on the published mailbox is still accepted", async () => {
    const to = "dpdp+zzz.whatever@veridian-aios.com"
    const msg = mockMessage({ raw: mime({ to }), to })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    expect(msg.rejected).toHaveLength(0)
    expect(calls).toHaveLength(1)
  })
})

// ---------- RFC 2142 role mailboxes: accepted, forwarded natively, never ticketed ----------

describe("role mailboxes (postmaster@, abuse@)", () => {
  test("the allowlist is exactly the two RFC 2142 names this Worker was asked to take", () => {
    expect([...FORWARD_ONLY_ROLES].sort()).toEqual(["abuse", "postmaster"])
  })

  test.each([
    ["postmaster@veridian-aios.com", "postmaster"],
    ["abuse@veridian-aios.com", "abuse"],
    ["Postmaster@VERIDIAN-AIOS.COM", "postmaster"],
    ["<abuse@veridian-aios.com>", "abuse"],
  ])("%s is forwarded to the operator untouched, not read, not ticketed, not refused", async (to, role) => {
    const msg = mockMessage({ raw: mime({ to, subject: "Undelivered Mail Returned to Sender" }), to })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    expect(msg.rejected).toHaveLength(0)
    expect(calls).toHaveLength(0)
    expect(msg.tally.pulled).toBe(0)
    expect(msg.forwarded).toHaveLength(1)
    expect(msg.forwarded[0].to).toBe("operator@example.com")
    expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe(`role_mailbox:${role}`)
    expect(msg.forwarded[0].headers?.get("X-Veridian-Envelope-To")).toBe(to.toLowerCase().replace(/^<|>$/g, ""))
  })

  test("it needs no Edge Function configuration and does not care that the function is down", async () => {
    const to = "postmaster@veridian-aios.com"
    const noConfig = mockMessage({ raw: mime({ to }), to })
    await handleInbound(noConfig, { FALLBACK_FORWARD_TO: "operator@example.com" }, deps(recordingFetch().fetch))
    expect(noConfig.forwarded).toHaveLength(1)

    const down = mockMessage({ raw: mime({ to }), to })
    const { fetch, calls } = recordingFetch(500)
    await handleInbound(down, ENV, deps(fetch))
    expect(calls).toHaveLength(0)
    expect(down.forwarded).toHaveLength(1)
  })

  test("a bounce (empty envelope sender) and unparseable bytes are still forwarded, since nothing is parsed", async () => {
    const to = "abuse@veridian-aios.com"
    const junk = new Uint8Array(2000).map((_, i) => (i * 37) % 256)
    const msg = mockMessage({ raw: junk, to, from: "" })
    await handleInbound(msg, ENV, deps(recordingFetch().fetch))
    expect(msg.rejected).toHaveLength(0)
    expect(msg.forwarded).toHaveLength(1)
  })

  test("an oversized abuse report is forwarded exactly once (no second 'oversize' copy)", async () => {
    const to = "abuse@veridian-aios.com"
    const msg = mockMessage({ raw: mime({ to, body: "x".repeat(400_000) }), to })
    await handleInbound(msg, ENV, deps(recordingFetch().fetch))
    expect(msg.tally.pulled).toBe(0)
    expect(msg.forwarded).toHaveLength(1)
  })

  test("if the forward fails the handler throws, so the mail is not silently accepted", async () => {
    const to = "postmaster@veridian-aios.com"
    const msg = mockMessage({
      raw: mime({ to }),
      to,
      forwardImpl: async () => {
        throw new Error("destination address not verified")
      },
    })
    await expect(handleInbound(msg, ENV, deps(recordingFetch().fetch))).rejects.toThrow("destination address not verified")
    expect(msg.rejected).toHaveLength(0)
  })

  test("with no FALLBACK_FORWARD_TO the handler throws rather than accept and lose the mail", async () => {
    const to = "abuse@veridian-aios.com"
    const msg = mockMessage({ raw: mime({ to }), to })
    await expect(handleInbound(msg, { ...ENV, FALLBACK_FORWARD_TO: "" }, deps(recordingFetch().fetch))).rejects.toThrow(
      "FALLBACK_FORWARD_TO",
    )
    expect(msg.rejected).toHaveLength(0)
  })

  test("resolveRecipient marks the two roles forward_only and every ticketed address as ticket", () => {
    expect(resolveRecipient("postmaster@veridian-aios.com")).toMatchObject({ accepted: true, route: "forward_only", role: "postmaster" })
    expect(resolveRecipient("ABUSE@veridian-aios.com")).toMatchObject({ accepted: true, route: "forward_only", role: "abuse" })
    expect(resolveRecipient("dpdp@veridian-aios.com")).toMatchObject({ accepted: true, route: "ticket", role: null })
    expect(resolveRecipient("dpdp+grv.k3f9x2ab7q@veridian-aios.com")).toMatchObject({ accepted: true, route: "ticket" })
    expect(resolveRecipient("grievance@veridian-aios.com")).toMatchObject({ accepted: true, route: "ticket", legacyAlias: "grievance" })
    expect(resolveRecipient("postmaster+x@veridian-aios.com")).toEqual({ accepted: false })
  })
})

// ---------- the fallback: a mail is never lost ----------

describe("fallback forward", () => {
  test.each([500, 502, 503, 401, 403, 404, 302])(
    "Edge Function status %d -> the original is forwarded, once, with the reason",
    async (status) => {
      const msg = mockMessage({ raw: mime() })
      const { fetch, calls } = recordingFetch(status)
      await handleInbound(msg, ENV, deps(fetch))
      expect(calls).toHaveLength(1)
      expect(msg.forwarded).toHaveLength(1)
      expect(msg.forwarded[0].to).toBe("operator@example.com")
      expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe(`post_http_${status}`)
      expect(msg.forwarded[0].headers?.get("X-Veridian-Envelope-To")).toBe("dpdp@veridian-aios.com")
      expect(msg.rejected).toHaveLength(0)
    },
  )

  test("a network error -> forwarded", async () => {
    const msg = mockMessage({ raw: mime() })
    await handleInbound(msg, ENV, deps(async () => {
      throw new TypeError("fetch failed")
    }))
    expect(msg.forwarded).toHaveLength(1)
    expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("post_network_error")
  })

  test("a slow Edge Function that honours abort -> timeout -> forwarded", async () => {
    const msg = mockMessage({ raw: mime() })
    const started = Date.now()
    await handleInbound(
      msg,
      { ...ENV, POST_TIMEOUT_MS: "40" },
      deps(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
          }),
      ),
    )
    expect(Date.now() - started).toBeLessThan(2000)
    expect(msg.forwarded).toHaveLength(1)
    expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("post_timeout")
  })

  test("a fetch that ignores abort and never answers still times out -> forwarded", async () => {
    const msg = mockMessage({ raw: mime() })
    await handleInbound(msg, { ...ENV, POST_TIMEOUT_MS: 40 }, deps(() => new Promise(() => {})))
    expect(msg.forwarded).toHaveLength(1)
    expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("post_timeout")
  })

  test("missing configuration -> forwarded, and the network is not touched", async () => {
    const msg = mockMessage({ raw: mime() })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, { FALLBACK_FORWARD_TO: "operator@example.com" }, deps(fetch))
    expect(calls).toHaveLength(0)
    expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("config_missing")
  })

  test("a cleartext http URL never receives the secret -> forwarded", async () => {
    const msg = mockMessage({ raw: mime() })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, { ...ENV, DPDP_INBOUND_URL: "http://example.com/fn" }, deps(fetch))
    expect(calls).toHaveLength(0)
    expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("config_insecure_url")
  })

  test("http://localhost is allowed so wrangler dev can talk to a local stub", async () => {
    const msg = mockMessage({ raw: mime() })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, { ...ENV, DPDP_INBOUND_URL: "http://localhost:54321/functions/v1/x" }, deps(fetch))
    expect(calls).toHaveLength(1)
    expect(msg.forwarded).toHaveLength(0)
  })

  test("malformed MIME that parses into nothing -> forwarded, not ticketed as an empty mail", async () => {
    const junk = new Uint8Array(2000).map((_, i) => (i * 37) % 256)
    const msg = mockMessage({ raw: junk })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    expect(calls).toHaveLength(0)
    expect(msg.forwarded).toHaveLength(1)
    expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("parse_unusable")
  })

  test("a parser that throws -> forwarded", async () => {
    const msg = mockMessage({ raw: mime() })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, {
      ...deps(fetch),
      parse: async () => {
        throw new Error("boom")
      },
    })
    expect(calls).toHaveLength(0)
    expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("parse_failed")
  })

  test("a message stream that errors mid-read -> forwarded", async () => {
    let sent = false
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(new TextEncoder().encode("From: a@example.org\r\n"))
        } else {
          controller.error(new Error("stream broke"))
        }
      },
    })
    const msg = mockMessage({ raw: broken })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    expect(calls).toHaveLength(0)
    expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("read_failed")
  })

  test("if the annotated forward is refused, the bare forward is tried before giving up", async () => {
    const msg = mockMessage({
      raw: mime(),
      forwardImpl: async (_to, headers) => {
        if (headers) throw new Error("headers not accepted")
      },
    })
    await handleInbound(msg, ENV, deps(async () => new Response("", { status: 500 })))
    expect(msg.forwarded).toHaveLength(2)
    expect(msg.forwarded[0].headers).toBeDefined()
    expect(msg.forwarded[1].headers).toBeUndefined()
  })

  test("if the fallback forward also fails the handler throws, so the mail is not silently accepted", async () => {
    const msg = mockMessage({
      raw: mime(),
      forwardImpl: async () => {
        throw new Error("destination address not verified")
      },
    })
    await expect(handleInbound(msg, ENV, deps(async () => new Response("", { status: 500 })))).rejects.toThrow(
      "destination address not verified",
    )
    expect(msg.rejected).toHaveLength(0)
    expect(msg.forwarded).toHaveLength(2)
  })

  test("with no FALLBACK_FORWARD_TO set and the Edge Function down, the handler throws", async () => {
    const msg = mockMessage({ raw: mime() })
    const env = { ...ENV, FALLBACK_FORWARD_TO: "" }
    await expect(handleInbound(msg, env, deps(async () => new Response("", { status: 500 })))).rejects.toThrow(
      "FALLBACK_FORWARD_TO",
    )
    expect(msg.forwarded).toHaveLength(0)
  })
})

// ---------- size cap ----------

describe("oversized mail", () => {
  function bigMime(bytesOfAttachment: number): string {
    const chunk = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODk=\r\n"
    return [
      "From: Asha <asha@example.org>",
      "To: dpdp@veridian-aios.com",
      "Subject: Big one",
      "Message-ID: <big-1@example.org>",
      'Content-Type: multipart/mixed; boundary="m1"',
      "",
      "--m1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "This is the body text before the attachment.",
      "--m1",
      'Content-Type: application/octet-stream; name="big.bin"',
      'Content-Disposition: attachment; filename="big.bin"',
      "Content-Transfer-Encoding: base64",
      "",
      chunk.repeat(Math.ceil(bytesOfAttachment / chunk.length)),
      "--m1--",
      "",
    ].join("\r\n")
  }

  test("a 3 MiB mail is read only up to the cap, ticketed as truncated, AND fully forwarded", async () => {
    const raw = bigMime(3 * 1024 * 1024)
    const msg = mockMessage({ raw, chunkSize: 65536 })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))

    expect(msg.rawSize).toBeGreaterThan(3 * 1024 * 1024)
    expect(msg.tally.pulled).toBeLessThanOrEqual(DEFAULT_MAX_RAW_BYTES + 65536)
    expect(msg.tally.cancelled).toBe(true)
    expect(calls).toHaveLength(1)
    const p = payloadOf(calls[0])
    expect(p.truncated).toBe(true)
    expect(p.raw_size).toBe(msg.rawSize)
    expect(p.subject).toBe("Big one")
    expect(p.text).toContain("body text before the attachment")
    expect(msg.forwarded).toHaveLength(1)
    expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("oversize_full_copy")
  })

  test("the default read cap is 131072 bytes, and wrangler.toml states the same number", () => {
    expect(DEFAULT_MAX_RAW_BYTES).toBe(131072)
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")
    const line = toml.split(/\r?\n/).find((l) => /^\s*MAX_RAW_BYTES\s*=/.test(l))
    expect(line).toBeDefined()
    expect(Number(/"(\d+)"/.exec(line!)?.[1])).toBe(DEFAULT_MAX_RAW_BYTES)
  })

  test("with no MAX_RAW_BYTES set, a 100 KiB mail is read whole and a 200 KiB mail is cut at the cap", async () => {
    const small = mockMessage({ raw: bigMime(100 * 1024), chunkSize: 16384 })
    const smallFetch = recordingFetch()
    await handleInbound(small, ENV, deps(smallFetch.fetch))
    expect(payloadOf(smallFetch.calls[0]).truncated).toBe(false)
    expect(small.forwarded).toHaveLength(0)

    const large = mockMessage({ raw: bigMime(200 * 1024), chunkSize: 16384 })
    const largeFetch = recordingFetch()
    await handleInbound(large, ENV, deps(largeFetch.fetch))
    expect(large.tally.pulled).toBeLessThanOrEqual(131072 + 16384)
    expect(large.tally.cancelled).toBe(true)
    expect(payloadOf(largeFetch.calls[0]).truncated).toBe(true)
    expect(large.forwarded).toHaveLength(1)
    expect(large.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("oversize_full_copy")
  })

  test("an erasure request that carries a 300 KB scan keeps its words in the ticket AND is forwarded in full", async () => {
    // The words come first (as every mail client writes them), the scanned ID after. The head is what gets ticketed.
    const raw = bigMime(300 * 1024).replace(
      "This is the body text before the attachment.",
      "Please erase all of my personal data. My ID is attached.",
    )
    const msg = mockMessage({ raw, chunkSize: 16384 })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, ENV, deps(fetch))
    const p = payloadOf(calls[0])
    expect(p.truncated).toBe(true)
    expect(p.has_attachments).toBe(true)
    expect(p.text).toContain("Please erase all of my personal data")
    expect(msg.forwarded).toHaveLength(1)
    expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("oversize_full_copy")
  })

  test("MAX_RAW_BYTES is honoured", async () => {
    const msg = mockMessage({ raw: bigMime(40 * 1024), chunkSize: 4096 })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, { ...ENV, MAX_RAW_BYTES: "8192" }, deps(fetch))
    expect(msg.tally.pulled).toBeLessThanOrEqual(8192 + 4096)
    expect(payloadOf(calls[0]).truncated).toBe(true)
  })

  test("a mail exactly at the cap is not truncated and not double-delivered", async () => {
    const base = mime({ body: "x".repeat(10) })
    const pad = 8192 - new TextEncoder().encode(base).length
    const raw = base + "y".repeat(pad)
    expect(new TextEncoder().encode(raw).length).toBe(8192)
    const msg = mockMessage({ raw })
    const { fetch, calls } = recordingFetch()
    await handleInbound(msg, { ...ENV, MAX_RAW_BYTES: "8192" }, deps(fetch))
    expect(payloadOf(calls[0]).truncated).toBe(false)
    expect(msg.forwarded).toHaveLength(0)
  })

  test("if the Edge Function fails on an oversized mail, exactly one forward happens", async () => {
    const msg = mockMessage({ raw: bigMime(2 * 1024 * 1024) })
    const { fetch } = recordingFetch(500)
    await handleInbound(msg, ENV, deps(fetch))
    expect(msg.forwarded).toHaveLength(1)
    expect(msg.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("post_http_500")
  })

  test("readCapped stops and cancels once the cap is reached", async () => {
    const tally: Tally = { pulled: 0, cancelled: false }
    const stream = chunkedStream(new Uint8Array(100_000).fill(65), 1000, tally)
    const { bytes, truncated } = await readCapped(stream, 2500)
    expect(bytes.length).toBe(2500)
    expect(truncated).toBe(true)
    expect(tally.cancelled).toBe(true)
    expect(tally.pulled).toBeLessThanOrEqual(3000)
  })

  test("readCapped returns everything, untruncated, when the stream is smaller than the cap", async () => {
    const tally: Tally = { pulled: 0, cancelled: false }
    const { bytes, truncated } = await readCapped(chunkedStream(new Uint8Array(2000).fill(66), 700, tally), 5000)
    expect(bytes.length).toBe(2000)
    expect(truncated).toBe(false)
    expect(tally.cancelled).toBe(false)
  })
})

// ---------- privacy ----------

describe("logging", () => {
  test("logs never contain the body, subject, addresses or the secret, on any path", async () => {
    const raw = mime({
      subject: "SENTINEL-SUBJECT-91",
      from: "Sentinel Sender <sentinel.sender@example.org>",
      body: "SENTINEL-BODY-77 please erase my records",
    })
    const okMsg = mockMessage({ raw, from: "sentinel.sender@example.org" })
    await handleInbound(okMsg, ENV, deps(recordingFetch().fetch))
    const failMsg = mockMessage({ raw, from: "sentinel.sender@example.org" })
    await handleInbound(failMsg, ENV, deps(recordingFetch(500).fetch))
    const rejectMsg = mockMessage({ raw, to: "sentinel.probe@veridian-aios.com" })
    await handleInbound(rejectMsg, ENV, deps(recordingFetch().fetch))
    const roleMsg = mockMessage({ raw, from: "sentinel.sender@example.org", to: "postmaster@veridian-aios.com" })
    await handleInbound(roleMsg, ENV, deps(recordingFetch().fetch))
    expect(roleMsg.forwarded).toHaveLength(1)

    const all = logs.join("\n")
    expect(all.length).toBeGreaterThan(0)
    for (const secretish of ["SENTINEL", "sentinel", SECRET, "erase my records"]) {
      expect(all).not.toContain(secretish)
    }
    for (const line of logs) expect(() => JSON.parse(line)).not.toThrow()
  })
})
