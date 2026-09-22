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
