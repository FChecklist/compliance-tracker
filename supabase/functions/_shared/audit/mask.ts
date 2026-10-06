// DPDP audit trail -- server-side masking (owner spec 2026-10-06, item 4). PURE: no Deno globals.
//
// A person's downloaded audit file must never contain a full value of anything that identifies someone. Masking happens HERE, on the server, before the
// file is built: the browser never receives a full value, so there is nothing to scrape out of the page or the network tab.
//
// Rules (owner-approved):
//   * e-mail      first 2 letters + *** + last 2 letters of the LOCAL part, then "@" and the FULL domain.   priya.shah@acme.in -> pr***ah@acme.in
//                 A local part of 4 letters or fewer is fully starred (nothing of it is shown).
//   * identifiers IP, mobile number, device id and any other identifier: first 3 + *** + last 3.            203.0.113.45 -> 203***.45
//                 Anything under 8 characters is fully starred.
//   * IPv6        the address is normalised first (lower case, zone id dropped, IPv4-mapped ::ffff:a.b.c.d treated as IPv4), then masked like any identifier.
//   * free text / names are not masked here (they are not identifiers); anything that could hold a secret never reaches the log at all (seal.ts scrub).

export type MaskKind = "email" | "ip" | "mobile" | "device" | "id" | "text"

/** All stars, one per character (an empty value stays empty). */
export function stars(n: number): string {
  return "*".repeat(Math.max(0, n))
}

/** first 3 + *** + last 3; under 8 characters, fully starred. */
export function maskIdentifier(value: string | null | undefined): string {
  const v = (value ?? "").trim()
  if (v === "") return ""
  if ([...v].length < 8) return stars([...v].length)
  const chars = [...v]
  return chars.slice(0, 3).join("") + "***" + chars.slice(-3).join("")
}

/** first 2 + *** + last 2 of the local part, "@", the whole domain. A short local part (4 or fewer) is fully starred. A value with no usable "@" is masked as an identifier. */
export function maskEmail(value: string | null | undefined): string {
  const v = (value ?? "").trim()
  if (v === "") return ""
  const at = v.lastIndexOf("@")
  if (at <= 0 || at === v.length - 1) return maskIdentifier(v)
  const local = [...v.slice(0, at)]
  const domain = v.slice(at + 1)
  if (local.length <= 4) return stars(local.length) + "@" + domain
  return local.slice(0, 2).join("") + "***" + local.slice(-2).join("") + "@" + domain
}

/** Normal form of an IP for masking: trims, lower-cases, drops an IPv6 zone id ("%eth0") and unwraps ::ffff:a.b.c.d. */
export function normaliseIp(value: string | null | undefined): string {
  let v = (value ?? "").trim().toLowerCase()
  if (v === "") return ""
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1)
  const pct = v.indexOf("%")
  if (pct >= 0) v = v.slice(0, pct)
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v)
  if (mapped) return mapped[1]
  return v
}

export function maskIp(value: string | null | undefined): string {
  return maskIdentifier(normaliseIp(value))
}

/** Mask by the kind recorded next to a sealed value. "text" is returned as is (not an identifier). */
export function maskByKind(kind: MaskKind | string, value: string | null | undefined): string {
  const v = value ?? ""
  switch (kind) {
    case "email": return maskEmail(v)
    case "ip": return maskIp(v)
    case "mobile":
    case "device":
    case "id": return maskIdentifier(v)
    default: return v
  }
}
