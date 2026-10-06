// DPDP audit trail -- what is NEVER logged (owner spec 2026-10-06, item 2). PURE.
//
// Applied to every value BEFORE it is sealed or stored, so even a caller that passes a whole request body cannot leak a secret into the log. Two nets:
//   1. by NAME   any key that names a secret (password, otp, passcode, pin, card, cvv, bank / account number, IFSC, api key, token, secret, authorization,
//                cookie, fingerprint, private key, ...) is dropped and replaced by "[withheld]".
//   2. by SHAPE  any string that LOOKS like a secret is replaced by "[redacted]" wherever it appears: an AI link token (pxa_<64 hex>, or 64+ hex in a path),
//                a JWT, a bearer header value, a card-like number that passes the Luhn check, a 6-digit one-time code written as "otp 123456".
// It also caps depth and string length so a log row can never become a dump.

export const WITHHELD = "[withheld]"
export const REDACTED = "[redacted]"

// Names are compared lower-cased with camelCase split ("apiKey" -> "api key"); a word must stand alone (so "passed" or "occupied" are not secrets, "user_password" is).
const SECRET_KEY = /(?<![a-z])(pass(word|wd|code|phrase)?|otp|one[ _-]?time|pin|cvv|cvc|card|pan|aadhaar|aadhar|account[ _-]?(no|num\w*)|iban|ifsc|upi|routing|swift|api[ _-]?key|secret|token|authorization|cookie|credential|fingerprint|private[ _-]?key|signature|seal[ _-]?key|hmac|bearer)(?![a-z])/

export function isSecretKey(name: string): boolean {
  return SECRET_KEY.test(name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase())
}

const TOKEN_LIKE: RegExp[] = [
  /pxa_[0-9a-f]{32,}/gi,
  /\b[0-9a-f]{40,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(?:otp|passcode|code|pin)\s*(?:is|=|:)?\s*\d{4,8}\b/gi,
]

function luhn(digits: string): boolean {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

export function redactString(s: string, max = 2000): string {
  let out = s
  for (const re of TOKEN_LIKE) out = out.replace(re, REDACTED)
  out = out.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
    const digits = m.replace(/[ -]/g, "")
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? REDACTED : m
  })
  return out.length > max ? out.slice(0, max) + "...[cut]" : out
}

/** A deep copy with every secret removed or redacted. Arrays and objects are walked to `depth` levels (default 6); deeper values become "[deep]". */
export function scrub(value: unknown, depth = 6): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return redactString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (depth <= 0) return "[deep]"
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => scrub(v, depth - 1))
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      out[k] = isSecretKey(k) ? WITHHELD : scrub(v, depth - 1)
    }
    return out
  }
  return String(value)
}
