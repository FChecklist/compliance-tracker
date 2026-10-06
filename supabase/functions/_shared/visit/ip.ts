// Visitor-journey tracking -- what is kept of an IP address (owner spec 2026-10-06). PURE (Web Crypto only), runs in Deno and under bun test.
//
// Two things are derived from the address the server itself saw, and the raw address is stored nowhere:
//   * a SHORTENED form for people to read: IPv4 with the last octet zeroed (203.0.113.0), IPv6 cut to its /48 (2001:db8:abcd::);
//   * a KEYED HASH (HMAC-SHA256 with the secret DPDP_VISIT_KEY) of the full normalised address, so the same address is recognised when it comes back without anyone being
//     able to turn the hash back into an address (an unkeyed hash of an IPv4 address can be reversed by trying all 4 billion; a keyed one cannot without the key).
// No key = no hash (null): the code never falls back to an unkeyed hash.

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function v4Parts(s: string): number[] | null {
  const m = V4.exec(s)
  if (!m) return null
  const p = m.slice(1).map(Number)
  return p.every((n) => n >= 0 && n <= 255) ? p : null
}

/** IPv6 text -> 8 groups of 16 bits, or null. Handles "::" and an embedded IPv4 tail. */
function v6Groups(raw: string): number[] | null {
  let s = raw.toLowerCase().split("%")[0]!
  if (!s.includes(":")) return null
  const tail = s.lastIndexOf(":")
  const v4 = v4Parts(s.slice(tail + 1))
  if (v4) s = `${s.slice(0, tail + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`
  const halves = s.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  if (halves.length === 1 && head.length !== 8) return null
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0
  if (fill < 0 || (halves.length === 2 && fill < 1)) return null
  const all = [...head, ...Array(fill).fill("0"), ...rest]
  if (all.length !== 8) return null
  const out: number[] = []
  for (const g of all) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    out.push(parseInt(g, 16))
  }
  return out
}

export type NormalIp = { family: 4 | 6; text: string; parts: number[] }

/** The canonical form of an address: IPv4 dotted, IPv6 as 8 full groups; an IPv4-mapped IPv6 address (::ffff:a.b.c.d) is the IPv4 address. Null for anything else. */
export function normaliseIp(input: string | null | undefined): NormalIp | null {
  const raw = (input ?? "").trim().replace(/^\[|\]$/g, "")
  if (!raw || raw.length > 64) return null
  const four = v4Parts(raw)
  if (four) return { family: 4, text: four.join("."), parts: four }
  const g = v6Groups(raw)
  if (!g) return null
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    const p = [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255]
    return { family: 4, text: p.join("."), parts: p }
  }
  return { family: 6, text: g.map((x) => x.toString(16).padStart(4, "0")).join(":"), parts: g }
}

/** IPv4: last octet zeroed. IPv6: the /48 (first three groups) followed by "::". Null when the text is not an address. */
export function shortenIp(input: string | null | undefined): string | null {
  const ip = normaliseIp(input)
  if (!ip) return null
  if (ip.family === 4) return `${ip.parts[0]}.${ip.parts[1]}.${ip.parts[2]}.0`
  return `${ip.parts.slice(0, 3).map((x) => x.toString(16)).join(":")}::`
}

const hex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("")

/** HMAC-SHA256(key, normalised address) as 64 hex characters; null without a key or without a valid address. */
export async function hashIp(input: string | null | undefined, key: string | null | undefined): Promise<string | null> {
  const ip = normaliseIp(input)
  if (!ip || !key || key.length < 16) return null
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`ip:${ip.text}`)))
}
