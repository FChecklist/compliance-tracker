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

/** The share ask -- decision-makers only (WO-014 §3): CA partner, CA manager, owner/principal. */
export const SHARE_ASK = "Know a firm that needs this? Share VERIDIAN"

/** The ONLY address the share action ever hands out (WO-014 §3): the public website, never a private page. */
export const PUBLIC_SITE = "https://veridian-aios.com/"

/** Second line of every report footer (WO-014 §6), with the report date appended by the caller. */
export const PREPARED_WITH = "Prepared with VERIDIAN · veridian-aios.com"

/** Who may share with a referral code (WO-014 §3): the owner/principal, a CA partner, a CA manager. */
export type ShareRole = "owner" | "partner" | "manager"

/**
 * WO-014 §3's table: the share ask goes to CA partners, CA managers and
 * client owners/principals -- never to a coordinator, Grievance Officer,
 * staff, teacher, vendor or parent. dpdp_my_page's viewer.kind is "ca"
 * with caSub partner|manager for the CA roles (rpc-types.ts), so this is
 * the one place the two-field answer becomes one role, or null.
 */
export function shareRoleFor(viewer: { kind: string; caSub: "partner" | "manager" | null }): ShareRole | null {
  if (viewer.kind === "owner") return "owner"
  if (viewer.kind === "ca" && viewer.caSub === "partner") return "partner"
  if (viewer.kind === "ca" && viewer.caSub === "manager") return "manager"
  return null
}
