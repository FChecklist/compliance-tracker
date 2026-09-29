// WO-DPDP-014 §1: the ONE brand line, owner-approved 22 Sep 2026. These
// three strings are the only place the line is typed in the private app;
// every surface (BrandLine.tsx, ShareVeridian.tsx, the Monday email's
// render.ts) renders from them and brand.test.ts fails the build if any
// variant spelling (a differently-cased "VERy INDIAN", or the public-
// procurement phrase WO-014 §1 forbids) appears anywhere under src/ or in
// the email function. The public site's copy of the same
// three lines lives in data/veridian-facts.yaml (WO-DPDP-013, the facts
// file); brand.test.ts checks the two agree whenever that file is present.
//
// Plain TypeScript with no imports on purpose: src/lib/services/
// dpdp-timer-render.test.ts (the repo root's bun suite) imports this file
// straight across the tree to prove the email's constants are byte-identical.

/** The full line: the top bar at 480 px and wider, every email footer, every report footer. */
export const BRAND_LINE_FULL = "VERIDIAN · VERy INDIAN — Built for India's DPDP Act. For India, by India."

/** The short line: the top bar under 480 px. */
export const BRAND_LINE_SHORT = "VERIDIAN · VERy INDIAN · For India, by India"

/** The share ask -- every signed-in person (WO-DPDP-016 §1 widened WO-014 §3's decision-makers-only rule to "every email gets a default share link"). */
export const SHARE_ASK = "Know a firm that needs this? Share VERIDIAN"

/** The ONLY address the share action ever hands out (WO-014 §3): the public website, never a private page. */
export const PUBLIC_SITE = "https://veridian-aios.com/"

/** Second line of every report footer (WO-014 §6), with the report date appended by the caller. */
export const PREPARED_WITH = "Prepared with VERIDIAN · veridian-aios.com"

/** Who shares a referral code: everyone signed in (WO-DPDP-016 §1). "member" is anyone not owner/CA partner/CA manager -- coordinator, Grievance Officer, staff, teacher, vendor, parent all included, per the Owner's own instruction: "every email gets a default share link for refer". */
export type ShareRole = "owner" | "partner" | "manager" | "member"

/**
 * dpdp_my_page's viewer.kind is "ca" with caSub partner|manager for the CA
 * roles (rpc-types.ts); everything else falls through to "member" now --
 * this never returns null, matching dpdp__share_role (drizzle/0655), so
 * the two can never disagree about who gets a share button.
 */
export function shareRoleFor(viewer: { kind: string; caSub: "partner" | "manager" | null }): ShareRole {
  if (viewer.kind === "owner") return "owner"
  if (viewer.kind === "ca" && viewer.caSub === "partner") return "partner"
  if (viewer.kind === "ca" && viewer.caSub === "manager") return "manager"
  return "member"
}
