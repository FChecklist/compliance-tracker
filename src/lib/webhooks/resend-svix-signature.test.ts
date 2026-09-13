/// <reference types="bun-types" />
// R-C17 (platform.sumeet_requirements, "Platform: Email Engine"). Real
// crypto round-trip tests, matching src/lib/webhooks/vercel-signature.test.ts's
// own convention -- signs with the SAME algorithm this module verifies, then
// asserts both directions (valid signature accepted, tampered/wrong-secret/
// wrong-id/stale/malformed signature rejected). No mocking: this is pure
// function, no DB/network involved.
import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { verifyResendSvixSignature, DEFAULT_TOLERANCE_SECONDS } from "./resend-svix-signature"

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw" // shape matches Svix's own documented example secret

function sign(id: string, timestamp: string, body: string, secret = SECRET): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  const signedContent = `${id}.${timestamp}.${body}`
  const sig = createHmac("sha256", secretBytes).update(signedContent).digest("base64")
  return `v1,${sig}`
}

function nowTimestamp(): string {
  return String(Math.floor(Date.now() / 1000))
}

describe("verifyResendSvixSignature", () => {
  test("accepts a correctly signed, fresh delivery", () => {
    const id = "msg_1"
    const timestamp = nowTimestamp()
    const body = JSON.stringify({ type: "email.received", data: { email_id: "email_abc" } })
    const signature = sign(id, timestamp, body)
    expect(verifyResendSvixSignature(body, { svixId: id, svixTimestamp: timestamp, svixSignature: signature }, SECRET)).toBe(true)
  })

  test("accepts when svix-signature carries multiple space-separated v1 entries and only one matches (secret rotation)", () => {
    const id = "msg_2"
    const timestamp = nowTimestamp()
    const body = JSON.stringify({ type: "email.received", data: { email_id: "email_xyz" } })
    const realSig = sign(id, timestamp, body)
    const decoySig = sign(id, timestamp, body, "whsec_" + Buffer.from("a-different-secret").toString("base64"))
    expect(
      verifyResendSvixSignature(body, { svixId: id, svixTimestamp: timestamp, svixSignature: `${decoySig} ${realSig}` }, SECRET)
    ).toBe(true)
  })

  test("rejects when any header is missing", () => {
    const id = "msg_3"
    const timestamp = nowTimestamp()
    const body = "{}"
    const signature = sign(id, timestamp, body)
    expect(verifyResendSvixSignature(body, { svixId: null, svixTimestamp: timestamp, svixSignature: signature }, SECRET)).toBe(false)
    expect(verifyResendSvixSignature(body, { svixId: id, svixTimestamp: null, svixSignature: signature }, SECRET)).toBe(false)
    expect(verifyResendSvixSignature(body, { svixId: id, svixTimestamp: timestamp, svixSignature: null }, SECRET)).toBe(false)
  })

  test("rejects a signature computed with the WRONG secret", () => {
    const id = "msg_4"
    const timestamp = nowTimestamp()
    const body = "{}"
    const wrongSecret = "whsec_" + Buffer.from("attacker-guessed-secret").toString("base64")
    const signature = sign(id, timestamp, body, wrongSecret)
    expect(verifyResendSvixSignature(body, { svixId: id, svixTimestamp: timestamp, svixSignature: signature }, SECRET)).toBe(false)
  })

  test("rejects a signature computed over a DIFFERENT body (tamper attempt)", () => {
    const id = "msg_5"
    const timestamp = nowTimestamp()
    const signedBody = JSON.stringify({ amount: 100 })
    const tamperedBody = JSON.stringify({ amount: 999999 })
    const signature = sign(id, timestamp, signedBody)
    expect(verifyResendSvixSignature(tamperedBody, { svixId: id, svixTimestamp: timestamp, svixSignature: signature }, SECRET)).toBe(false)
  })

  test("rejects a signature computed for a DIFFERENT svix-id (replay onto another delivery)", () => {
    const timestamp = nowTimestamp()
    const body = "{}"
    const signature = sign("msg_original", timestamp, body)
    expect(verifyResendSvixSignature(body, { svixId: "msg_replayed", svixTimestamp: timestamp, svixSignature: signature }, SECRET)).toBe(false)
  })

  test("rejects a stale delivery outside the tolerance window", () => {
    const id = "msg_6"
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - DEFAULT_TOLERANCE_SECONDS - 60)
    const body = "{}"
    const signature = sign(id, staleTimestamp, body)
    expect(verifyResendSvixSignature(body, { svixId: id, svixTimestamp: staleTimestamp, svixSignature: signature }, SECRET)).toBe(false)
  })

  test("rejects a non-numeric svix-timestamp", () => {
    const id = "msg_7"
    const body = "{}"
    expect(verifyResendSvixSignature(body, { svixId: id, svixTimestamp: "not-a-number", svixSignature: "v1,abc" }, SECRET)).toBe(false)
  })

  test("rejects a malformed svix-signature (no v1 prefix, or empty)", () => {
    const id = "msg_8"
    const timestamp = nowTimestamp()
    const body = "{}"
    expect(verifyResendSvixSignature(body, { svixId: id, svixTimestamp: timestamp, svixSignature: "" }, SECRET)).toBe(false)
    expect(verifyResendSvixSignature(body, { svixId: id, svixTimestamp: timestamp, svixSignature: "v2,somebase64" }, SECRET)).toBe(false)
  })
})
