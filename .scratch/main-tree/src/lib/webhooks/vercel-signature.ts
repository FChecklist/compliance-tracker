import { createHmac, timingSafeEqual } from "node:crypto"

// GAP-D15-REMAINING-TRIGGERS (Priority 11). Verifies Vercel's
// `x-vercel-signature` webhook header exactly per Vercel's own documented
// algorithm (https://vercel.com/docs/headers/request-headers#x-vercel-signature):
// an HMAC-SHA1 hex digest of the RAW request body, keyed with the webhook's
// secret (shown once at webhook-creation time in the Vercel dashboard/API).
// Kept in its own module (not inlined in the route handler) so it's a plain
// importable/testable function -- Next.js route.ts files only recognize a
// fixed set of exports (GET/POST/etc. + segment config), so a reusable
// helper like this can't safely live as an extra named export there.
export function verifyVercelSignature(rawBody: string, headerSignature: string | null | undefined, secret: string): boolean {
  if (!headerSignature) return false
  const expected = createHmac("sha1", secret).update(rawBody).digest("hex")
  if (headerSignature.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(headerSignature), Buffer.from(expected))
  } catch {
    return false
  }
}
