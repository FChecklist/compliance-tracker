import type { ObligationRow } from "@/lib/dpdp-onepage/view-model"

// Wire shapes of the public.dpdp_* RPCs (WO-DPDP-011 Step 2 contract). The
// browser reaches the dpdp schema ONLY through these functions -- that
// schema is not exposed to PostgREST and 17 of its tables carry no RLS, so
// a direct supabase.from() against it would be a cross-tenant leak.

export type MyPageRowWire = Omit<ObligationRow, "due"> & { due: string }

export type ViewerKind = "owner" | "staff" | "go" | "coord" | "ca"

export type MyPagePayload = {
  org: { id: string; name: string; product: "firm" | "institution" }
  viewer: {
    email: string
    kind: ViewerKind
    caSub: "partner" | "manager" | null
    firstVisitSeenAt: string | null
    saidNotMeAt: string | null
    membershipId: string | null
  }
  rows: MyPageRowWire[]
}

export type OkPayload = { ok: true }

// WO-DPDP-011 Step 3 (drizzle/0605): the owner's RPCs.

/** One row of dpdp_areas_for_product -- the wizard's "who looks after what" table. */
export type AreaPayload = { area: string; jobs: string[]; isGroup: boolean }

/** One element of dpdp_complete_owner_first_visit's p_assignments. */
export type AreaAssignmentWire = { area: string; emails: string[]; na: boolean }

export type FirstVisitPayload = { ok: true; assigned: number; notApplicable: number }

/** One dpdp.event row as dpdp_org_history returns it (newest first). occurredAt is ISO-8601 UTC. */
export type HistoryEntryWire = { id: string; kind: string; summary: string; detail: string | null; actorLabel: string; occurredAt: string }
