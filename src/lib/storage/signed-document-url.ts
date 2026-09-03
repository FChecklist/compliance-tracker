// R67 F-02 (R-018/R-021/R-030/R-035). One place that turns a stored Supabase
// Storage object path into a short-lived signed URL, extracted because the
// permits and drawings registers, their [id] detail routes and their new
// on-click document-url routes all need EXACTLY the same behaviour and the
// same failure posture -- and because a Next.js route.ts may only export HTTP
// method handlers, so this could not live beside the handlers that use it.
//
// THE FAILURE POSTURE IS THE POINT. Before this, the list handlers signed one
// URL per row with an unguarded `await admin.storage...`. A Storage
// misconfiguration -- a rotated service-role key, a renamed bucket, a network
// blip -- therefore turned "show me my permits" into a 500 with no permits in
// it, even though every row's real data (name, authority, expiry) had already
// been read successfully from Postgres. A document link is an ENRICHMENT of a
// row, never its precondition: losing the link must cost the reader the link,
// not the row. So every failure here resolves to null and is logged for the
// operator, and callers render a dash.
import { createClient } from "@supabase/supabase-js"

export const DOCUMENT_BUCKET = "compliance-documents"

// The register used to mint 5-minute URLs for every row, including the rows
// nobody would ever open. Now a URL is only ever minted because a human
// clicked something, so it is worth the longer TTL the object screens already
// use (see permits/[id]/route.ts's own SIGNED_URL_TTL_SECONDS).
export const DOCUMENT_URL_TTL_SECONDS = 3600

type StorageLike = {
  storage: {
    from(bucket: string): {
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null }>
    }
  }
}

// Constructed lazily, per call, and never at module scope: a register made
// entirely of external links (a 3D-walkthrough project whose rows are all
// Matterport URLs) must not touch Storage credentials at all, and a route
// that never signs anything must not fail to load because the service-role
// key is absent from that environment.
function getStorageAdminClient(): StorageLike {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as unknown as StorageLike
}

/**
 * A signed, time-limited URL for one stored document, or null.
 *
 * Returns null -- never throws -- for an empty path, a Storage client that
 * cannot be constructed, a rejected sign call, or a response carrying no URL.
 * `context` names the caller in the operator-facing log line so a silent null
 * is still traceable to the route that produced it.
 */
export async function signDocumentUrl(
  fileUrl: string | null | undefined,
  context: string,
  ttlSeconds: number = DOCUMENT_URL_TTL_SECONDS,
  clientFactory: () => StorageLike = getStorageAdminClient
): Promise<string | null> {
  if (!fileUrl) return null
  try {
    const admin = clientFactory()
    const { data } = await admin.storage.from(DOCUMENT_BUCKET).createSignedUrl(fileUrl, ttlSeconds)
    return data?.signedUrl ?? null
  } catch (error) {
    console.error(`[${context}] storage signing failed for "${fileUrl}" -- returning no document URL:`, error)
    return null
  }
}
