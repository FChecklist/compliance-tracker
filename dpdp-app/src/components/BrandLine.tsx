import "./onepage/dpdp-onepage-tokens.css"
import "./BrandLine.css"
import { BRAND_LINE_FULL, BRAND_LINE_SHORT, type ShareRole } from "@/lib/brand"
import type { DpdpClient } from "@/lib/client"
import { ShareVeridian } from "./ShareVeridian"

// WO-DPDP-014 §2/§3: the thin brand line at the very top of every private
// page -- /app/ in every phase (signed out, loading, the page), /act/,
// /unsubscribe/ and /p/. Everyone sees the line. Both wordings are in the
// DOM, from the constants; BrandLine.css shows the full one at 480 px and
// wider and the short one below that. The bar is in normal flow, so it
// scrolls away above the pinned section links.
//
// `share` is the ONLY way the share ask appears: /app/ passes it once the
// page has loaded and the viewer is a decision-maker (shareRoleFor in
// src/lib/brand.ts); the token pages never pass it, so a parent, a staff
// member on a one-click link or an unsubscribing address never sees
// "Share VERIDIAN".
export function BrandLine({ share }: { share?: { client: DpdpClient; orgId: string; role: ShareRole } | null }) {
  return (
    <div className="dpdp-onepage dpdp-brandline" role="region" aria-label="VERIDIAN brand line">
      <span className="dpdp-brandline__line">
        <span className="dpdp-brandline__accent" aria-hidden="true" />
        <span className="dpdp-brandline__full">{BRAND_LINE_FULL}</span>
        <span className="dpdp-brandline__short">{BRAND_LINE_SHORT}</span>
      </span>
      {share ? <ShareVeridian client={share.client} orgId={share.orgId} role={share.role} /> : null}
    </div>
  )
}
