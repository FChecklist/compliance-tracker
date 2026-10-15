// DPDP audit trail -- field-level sealing (owner spec 2026-10-06, item 2). PURE: Web Crypto only (identical in Deno and bun).
//
// Personal values in an audit row (IP, user-agent, device id, e-mail, before/after of a personal field) are stored ENCRYPTED with AES-256-GCM. The key is an
// Edge Function secret (DPDP_AUDIT_SEAL_KEY, base64 of 32 random bytes) that is NOT the database login and is not in the database or the repository, so a copy
// of the database alone shows ciphertext. This is deliberately different from the older dpdp_payout_key pattern (pgcrypto + a Vault secret IN the database,
// drizzle/0723): that key sits beside the data it protects; the owner asked for a key apart from the DB login.
//
// FORMAT   aes1:<keyId>:<iv base64url, 12 bytes>:<ciphertext+tag base64url>
// AAD      "<orgId>|<field>" -- a sealed value copied into another org's row, or into another field, fails to open (the GCM tag covers it).
// KEY ID   the secret may carry several keys for rotation: DPDP_AUDIT_SEAL_KEY (current, id from DPDP_AUDIT_SEAL_KEY_ID, default "k1") and optionally
//          DPDP_AUDIT_SEAL_KEY_OLD / DPDP_AUDIT_SEAL_KEY_OLD_ID for opening rows sealed before a rotation.
// NEVER LOGGED  passwords, one-time codes, card / bank details, API keys and tokens, raw fingerprints: see scrub.ts, applied before anything is sealed.

export const SEAL_PREFIX = "aes1"
const IV_BYTES = 12

export type SealKey = { id: string; key: CryptoKey }
export type KeyRing = { current: SealKey; byId: Map<string, SealKey> }

function toB64Url(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
function fromB64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 32 random bytes as base64, for a new key (`openssl rand -base64 32` does the same). */
export function generateKeyB64(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
}

export async function importKey(b64: string, id = "k1"): Promise<SealKey> {
  const raw = Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0))
  if (raw.length !== 32) throw new Error("The audit seal key must be 32 bytes (base64 of 32 random bytes)")
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(id)) throw new Error("The audit seal key id must be 1-16 letters, digits, - or _")
  return { id, key: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]) }
}

/** Build the key ring from the secret values. Throws (fail closed) when there is no current key: nothing is ever written unsealed. */
export async function keyRingFrom(get: (name: string) => string | undefined): Promise<KeyRing> {
  const cur = (get("DPDP_AUDIT_SEAL_KEY") ?? "").trim()
  if (!cur) throw new Error("DPDP_AUDIT_SEAL_KEY is not set: refusing to write or read audit values")
  const current = await importKey(cur, (get("DPDP_AUDIT_SEAL_KEY_ID") ?? "").trim() || "k1")
  const byId = new Map<string, SealKey>([[current.id, current]])
  const old = (get("DPDP_AUDIT_SEAL_KEY_OLD") ?? "").trim()
  if (old) {
    const o = await importKey(old, (get("DPDP_AUDIT_SEAL_KEY_OLD_ID") ?? "").trim() || "k0")
    if (!byId.has(o.id)) byId.set(o.id, o)
  }
  return { current, byId }
}

export const aadFor = (orgId: string, field: string): BufferSource => new TextEncoder().encode(`${orgId}|${field}`) as unknown as BufferSource

export async function seal(ring: KeyRing, plain: string, orgId: string, field: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource, additionalData: aadFor(orgId, field) }, ring.current.key, new TextEncoder().encode(plain) as unknown as BufferSource))
  return `${SEAL_PREFIX}:${ring.current.id}:${toB64Url(iv)}:${toB64Url(ct)}`
}

export const isSealed = (v: unknown): v is string => typeof v === "string" && v.startsWith(`${SEAL_PREFIX}:`) && v.split(":").length === 4

/** Open a sealed value. Throws when the key is unknown, the value was altered, or it was moved to another org / field. */
export async function open(ring: KeyRing, sealed: string, orgId: string, field: string): Promise<string> {
  if (!isSealed(sealed)) throw new Error("Not a sealed audit value")
  const [, keyId, iv, ct] = sealed.split(":")
  const k = ring.byId.get(keyId)
  if (!k) throw new Error(`No audit seal key with id "${keyId}"`)
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64Url(iv) as unknown as BufferSource, additionalData: aadFor(orgId, field) }, k.key, fromB64Url(ct) as unknown as BufferSource)
  return new TextDecoder().decode(plain)
}
