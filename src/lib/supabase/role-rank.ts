// The role hierarchy, as a LEAF module.
//
// WHY THIS IS NOT STILL INSIDE auth-guard.ts. It was, and the definitions
// below are moved here verbatim -- same values, same comments, no behaviour
// change; auth-guard.ts re-exports both names so every one of its ~20
// existing importers is untouched. The move exists because auth-guard.ts is
// a heavy module: it pulls in next/server, next/headers, the Supabase server
// client, the drizzle schema, and eight service modules (org licensing,
// invite links, join codes, subscription plans, session limits, org
// provisioning). Anything that needs only "is this role at least that role"
// -- a pure comparison over eleven string constants -- had to drag all of
// that in with it, which is both slow and, in a unit test that mocks
// "@/lib/db" down to a single fake client, a hard import failure partway
// through that graph.
//
// R68 Phase 6 hit exactly that: src/lib/services/memory-write-authorization.ts
// needs the REAL rank table (reusing this codebase's one role model is the
// whole point -- see that file's header), and re-declaring the ranks locally
// to avoid the import would have created a second, silently-driftable copy
// of the security-relevant part of it. Extracting the leaf is the version of
// "reuse it" that actually works.
//
// Nothing is imported here on purpose. Keep it that way.

// The DB enum (schema.ts userRoleEnum) has 11 values: the original 4, 6
// Wave 1 hierarchy roles, and stage_0. This type/ROLE_RANK previously only
// recognized the original 4 -- any user with one of the 6 newer roles
// (including veridian_admin, meant to be the MOST privileged) got
// `ROLE_RANK[role] ?? 0`, i.e. rank 0, and failed every requireRole() check
// including the lowest-bar ones. That's a real, live bug: those 6 roles
// existed in the DB and were assignable, but were functionally locked out
// of everything.
//
// GAP-STAGE0-ROLE-MISSING-FROM-ROLE-RANK: the same fix simply didn't extend
// to stage_0 when it was added later -- schema.ts's own comment on that enum
// value already specifies the intended rank ("Ranks 1 in ROLE_RANK
// (auth-guard.ts) -- same tier as viewer/client_viewer/external_auditor"),
// this was just never wired in. Confirmed via OCID-047's real API-level
// role/rights test execution: a real stage_0 user failed all 5 real routes
// tested, including the single lowest-bar action (rank 2, `member`).
export type UserRole = 'admin' | 'manager' | 'member' | 'viewer'
  | 'veridian_admin' | 'branch_manager' | 'senior_professional' | 'team_member' | 'client_viewer' | 'external_auditor'
  | 'stage_0'

export const ROLE_RANK: Record<UserRole, number> = {
  viewer: 1, client_viewer: 1, external_auditor: 1, stage_0: 1,
  member: 2, team_member: 2,
  senior_professional: 3, manager: 3,
  branch_manager: 4,
  admin: 5,
  veridian_admin: 6,
}
