// VCEL Security Engine -- remaining engines (encryption/decryption/MFA/session/
// access-control are already real, implemented elsewhere -- see registry).
// Hash/signature use Node's built-in crypto module, not a hand-rolled
// implementation, per project convention for cryptographic primitives.
import { createHash, createHmac, createSign, createVerify, generateKeyPairSync } from "node:crypto"

// Hash Generation Engine
export function generateHash(input: string, algorithm: "sha256" | "sha512" = "sha256"): string {
  return createHash(algorithm).update(input).digest("hex")
}
export function generateHmac(input: string, secret: string, algorithm: "sha256" | "sha512" = "sha256"): string {
  return createHmac(algorithm, secret).update(input).digest("hex")
}

// Digital Signature Engine -- RSA sign/verify using Node's built-in crypto
export function generateSigningKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
}
export function signData(data: string, privateKeyPem: string): string {
  return createSign("RSA-SHA256").update(data).end().sign(privateKeyPem, "hex")
}
export function verifySignature(data: string, signatureHex: string, publicKeyPem: string): boolean {
  return createVerify("RSA-SHA256").update(data).end().verify(publicKeyPem, signatureHex, "hex")
}
