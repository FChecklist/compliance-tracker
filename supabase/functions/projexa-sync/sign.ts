// PROJEXA LOCAL-FIRST SYNC: the signing layer of the projexa-sync Edge function. Pure (WebCrypto only, no Deno global), so bun tests it.
//
// WHY SIGN. A laptop may hand rows it pulled to ANOTHER laptop (peer sync, WebRTC). The receiver cannot trust the sender, so every row the server
// returns carries an ES256 signature over (organisation, project, kind, id, record version, updated_at, SHA-256 of the canonical row). A peer that alters one byte of a
// row, moves it to another project, or replays it into another organisation fails verification. The server's public keys are public; the private key lives
// only in platform.projexa_sync_key (service_role functions) and in this isolate's memory.
//
// WHAT A SIGNATURE DOES NOT DO. It proves the row is what the server sent; it does not prove it is still current (the receiver only takes a row newer than
// what it has, and its own server pull overwrites anything stale) and it does not make a peer authoritative for money or approvals (those are revalidated in
// Postgres on every write). A signed row is also already redacted for the SENDER's role, so rows only move between laptops of one view class (see 0678).
//
// The same canonicalisation and message layout is implemented on the laptop (projexa: src/lib/local-first/peer/verify.ts); both sides assert the same
// test vectors (TEST_VECTOR below, and the matching constant in the projexa test), so a drift between the two fails a test.

export type Jwk = JsonWebKey
export type KeyRecord = { kid: string; alg: "ES256"; public_jwk: Jwk; private_jwk: Jwk }

export const ITEM_MESSAGE_PREFIX = "px2"
export const ATTEST_TTL_SECONDS = 600

const te = new TextEncoder()

export function b64url(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
export function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/** JSON with object keys sorted at every level (arrays keep their order). `undefined` members are dropped like JSON.stringify drops them. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return "[" + value.map((v) => (v === undefined ? "null" : canonicalize(v))).join(",") + "]"
  const o = value as Record<string, unknown>
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort()
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}"
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(text))))
}

export function itemMessage(parts: { org: string; project: string; kind: string; id: string; version: number; updatedAt: string; dataHash: string }): string {
  return [ITEM_MESSAGE_PREFIX, parts.org, parts.project, parts.kind, parts.id, String(parts.version), parts.updatedAt, parts.dataHash].join("|")
}

export async function generateKeyRecord(): Promise<KeyRecord> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey)
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
  const kidBytes = new Uint8Array(12)
  crypto.getRandomValues(kidBytes)
  return { kid: "k" + b64url(kidBytes), alg: "ES256", public_jwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }, private_jwk: privateJwk }
}

export type Signing = {
  kid: string
  /** Base64url raw (r||s) ES256 signature of the message. */
  sign(message: string): Promise<string>
  /** Stable per-organisation channel name, not guessable without the private key. */
  channelId(orgId: string): Promise<string>
  /** Compact JWS (ES256) of a JSON payload. */
  signToken(payload: Record<string, unknown>): Promise<string>
  signItem(parts: { org: string; project: string; kind: string; id: string; version: number; updatedAt: string; data: unknown }): Promise<string>
}

export async function createSigning(rec: KeyRecord): Promise<Signing> {
  const key = await crypto.subtle.importKey("jwk", rec.private_jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
  const d = String(rec.private_jwk.d ?? "")
  const sign = async (message: string) => b64url(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(message))))
  return {
    kid: rec.kid,
    sign,
    async channelId(orgId) {
      return (await sha256Hex(`px-chan|${orgId}|${d}`)).slice(0, 32)
    },
    async signToken(payload) {
      const head = b64url(te.encode(JSON.stringify({ alg: "ES256", typ: "px-peer", kid: rec.kid })))
      const body = b64url(te.encode(JSON.stringify(payload)))
      return `${head}.${body}.${await sign(`${head}.${body}`)}`
    },
    async signItem(p) {
      const dataHash = await sha256Hex(canonicalize(p.data))
      return sign(itemMessage({ org: p.org, project: p.project, kind: p.kind, id: p.id, version: p.version, updatedAt: p.updatedAt, dataHash }))
    },
  }
}

export async function importPublic(jwk: Jwk): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
}

export async function verifyMessage(pub: CryptoKey, message: string, sigB64url: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromB64url(sigB64url), te.encode(message))
  } catch {
    return false
  }
}

/** Fixed vectors both sides assert: the canonical text and its hash for a row with nested keys, unicode, numbers and null. */
export const TEST_VECTOR = {
  value: { b: [1, 2.5, "x"], a: { z: null, y: "é\n\"", x: -0.5 }, c: true },
  canonical: '{"a":{"x":-0.5,"y":"é\\n\\"","z":null},"b":[1,2.5,"x"],"c":true}',
  sha256: "bcbc2a5c6e5947a6e1ed5e22aaa51395f6b040407127c6d9a870c7872ce8e565",
} as const
