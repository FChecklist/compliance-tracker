/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { verifyVercelSignature } from "./vercel-signature"

const SECRET = "whsec_test_secret_1234567890"

function sign(rawBody: string, secret = SECRET): string {
  return createHmac("sha1", secret).update(rawBody).digest("hex")
}

describe("verifyVercelSignature", () => {
  test("accepts a correctly HMAC-SHA1-signed raw body", () => {
    const body = JSON.stringify({ type: "deployment.succeeded", payload: { deployment: { id: "dpl_1" } } })
    expect(verifyVercelSignature(body, sign(body), SECRET)).toBe(true)
  })

  test("rejects a signature that doesn't match the body at all", () => {
    const body = JSON.stringify({ hello: "world" })
    expect(verifyVercelSignature(body, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", SECRET)).toBe(false)
  })

  test("rejects a signature computed with the wrong secret", () => {
    const body = JSON.stringify({ hello: "world" })
    expect(verifyVercelSignature(body, sign(body, "not-the-real-secret"), SECRET)).toBe(false)
  })

  test("rejects a missing signature header", () => {
    expect(verifyVercelSignature("{}", null, SECRET)).toBe(false)
    expect(verifyVercelSignature("{}", undefined, SECRET)).toBe(false)
    expect(verifyVercelSignature("{}", "", SECRET)).toBe(false)
  })

  test("rejects when the body is tampered with after signing (classic replay/tamper case)", () => {
    const original = JSON.stringify({ payload: { deployment: { id: "dpl_1" } } })
    const validSignature = sign(original)
    const tampered = JSON.stringify({ payload: { deployment: { id: "dpl_ATTACKER_CONTROLLED" } } })
    expect(verifyVercelSignature(tampered, validSignature, SECRET)).toBe(false)
  })

  test("is not fooled by a signature of the right length but wrong content", () => {
    const body = JSON.stringify({ a: 1 })
    const real = sign(body)
    const wrongSameLength = real.slice(0, -1) + (real.at(-1) === "0" ? "1" : "0")
    expect(verifyVercelSignature(body, wrongSameLength, SECRET)).toBe(false)
  })
})
