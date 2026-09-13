// R-C17 (platform.sumeet_requirements, "Platform: Email Engine"). Resend
// Inbound signs every webhook delivery per Svix's standard webhook
// verification scheme (Resend's own inbound-webhook docs; Resend uses Svix
// as its webhook-delivery provider) -- there was no existing Svix
// verification anywhere in this codebase to reuse (searched first, per
// AGENTS.md Rule 12/CLAUDE.md's own index-check convention: the only prior
// webhook-signature precedent in this repo is
// src/lib/webhooks/vercel-signature.ts, which is Vercel's own different
// HMAC-SHA1-over-raw-body scheme, not Svix's), so this implements Svix's
// published algorithm directly rather than adding the `svix` npm package for
// one small, fully-specified function:
//
//   signed_content = "{svix-id}.{svix-timestamp}.{raw_body}"
//   secret         = base64-decode(secret string with its "whsec_" prefix
//                    stripped)
//   expected       = base64(HMAC-SHA256(secret, signed_content))
//   valid          = expected matches ANY of the (space-separated,
//                    "v1,<base64>"-prefixed) signatures in the
//                    svix-signature header -- Svix sends one signature per
//                    active signing secret, to support secret rotation
//                    without a delivery gap.
//
// Kept in its own module (not inlined in the route handler), matching
// vercel-signature.ts's own stated reason: Next.js route.ts files only
// recognize a fixed set of exports (GET/POST/etc. + segment config), so a
// reusable/testable helper like this can't safely live as an extra named
// export there.
import { createHmac, timingSafeEqual } from "node:crypto"

export type SvixHeaders = {
  svixId: string | null | undefined
  svixTimestamp: string | null | undefined
  svixSignature: string | null | undefined
}

// Svix's own recommended replay-protection window. A delivery timestamped
// further from "now" than this (either direction -- a clock-skewed past
// delivery, or a suspiciously future one) is rejected even with an
// otherwise-valid signature.
export const DEFAULT_TOLERANCE_SECONDS = 5 * 60

export function verifyResendSvixSignature(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS
): boolean {
  const { svixId, svixTimestamp, svixSignature } = headers
  if (!svixId || !svixTimestamp || !svixSignature) return false

  const timestampSeconds = Number(svixTimestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  const nowSeconds = Date.now() / 1000
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) return false

  const secretBytes = decodeSecret(secret)
  if (!secretBytes) return false

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  const expected = createHmac("sha256", secretBytes).update(signedContent).digest("base64")
  const expectedBuf = Buffer.from(expected, "base64")

  // svix-signature carries one or more space-separated "v1,<base64>"
  // entries (one per active signing secret during rotation) -- valid if
  // ANY entry matches.
  for (const part of svixSignature.split(" ")) {
    const [version, sig] = part.split(",")
    if (version !== "v1" || !sig) continue
    let candidateBuf: Buffer
    try {
      candidateBuf = Buffer.from(sig, "base64")
    } catch {
      continue
    }
    if (candidateBuf.length !== expectedBuf.length) continue
    try {
      if (timingSafeEqual(candidateBuf, expectedBuf)) return true
    } catch {
      continue
    }
  }
  return false
}

function decodeSecret(secret: string): Buffer | null {
  const withoutPrefix = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret
  try {
    return Buffer.from(withoutPrefix, "base64")
  } catch {
    return null
  }
}
