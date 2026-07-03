import type { UserRole } from "@/lib/supabase/auth-guard"

// Adapted from the mockup's 5-level classification system to this app's real
// 10-value role set (no "Company Secretary"/"Independent Director" roles
// exist here -- admin/veridian_admin stand in for board-level clearance).
export const CLASSIFICATION_LEVELS = ["public", "company_wide", "department", "confidential", "board_only"] as const
export type Classification = (typeof CLASSIFICATION_LEVELS)[number]

const LEVEL_RANK: Record<Classification, number> = {
  public: 0, company_wide: 1, department: 2, confidential: 3, board_only: 4,
}

// The clearance CEILING per role -- how sensitive a record can be before
// this role is locked out entirely, independent of Scope (which
// user_client_access.accessLevel already covers) and Rights (create/edit,
// covered by requireRole()).
const ROLE_CLEARANCE: Record<UserRole, Classification> = {
  veridian_admin: "board_only",
  admin: "board_only",
  branch_manager: "confidential",
  senior_professional: "confidential",
  manager: "department",
  team_member: "department",
  member: "company_wide",
  client_viewer: "company_wide",
  external_auditor: "confidential", // sees audit-relevant records, not board minutes
  viewer: "public",
}

// Wave 21 (module reusability): optional org-level override of the
// clearance ceiling, resolved once per request via
// module-rules-resolver.ts's resolveModuleRule('<module>',
// 'classification_ceiling_override', scope) and passed in here -- backward
// compatible, since omitting roleOverrides (every call site before this
// wave) is byte-for-byte identical to the pre-Wave-21 behavior. Kept sync
// deliberately: the async DB lookup happens once per request at the call
// site, not per record inside a hot loop.
export type UserRoleClearanceOverrides = Partial<Record<UserRole, Classification>>

export function canAccess(
  role: UserRole | string,
  classification: Classification,
  roleOverrides?: UserRoleClearanceOverrides
): boolean {
  const ceiling = roleOverrides?.[role as UserRole] ?? ROLE_CLEARANCE[role as UserRole] ?? "public"
  return LEVEL_RANK[classification] <= LEVEL_RANK[ceiling]
}
