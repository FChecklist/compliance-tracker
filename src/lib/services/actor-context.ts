// Shared actor-context types for the service layer.
//
// Every service-layer mutation needs to know WHO is performing it, for two
// reasons: audit logging (logActivity() needs a real userId) and the two
// legitimate ways a call can be authenticated in this codebase --
// (a) a session-authenticated dashboard user (dbUser), or
// (b) a server-to-server caller authenticated via API key (apiKey), most
//     commonly PROJEXA's callVeridian() proxy, which always calls with a
//     shared Bearer API key and never a session cookie.
//
// Before this file existed, ~20 service files each redefined this same
// shape independently -- most as `ActorCtx`, some under a file-local name
// (AccessReviewActorCtx, RecordPaymentActorCtx, SellingActorCtx,
// FraudActorCtx, GrcActorCtx). The differing names were themselves the
// signal: identical structure, disguised as unrelated code by four
// different labels. Consolidated here per the VERIDIAN Review Framework's
// Architecture & Design / Engineering Principles finding "Elimination of
// Duplicate Functionality" (2026-08-15) -- quantified first with jscpd
// across src/lib/engines/ + src/lib/services/ (0.80% duplicated lines
// overall; this exact-type duplication was the largest single real cluster
// jscpd's line/token clustering didn't fully surface on its own, found by
// following up on jscpd's erp-buying-service.ts <-> erp-*-service.ts
// constructor-boilerplate clone hits by hand). See docs/adr/0002-erp-shared-
// actor-context.md for the full rationale and file list.
import type { users } from "@/lib/db"

/** An actor performing a mutation: either a real signed-in dashboard user,
 * or a server-to-server caller authenticated by API key. Exactly one of
 * `dbUser` / `apiKey` is present -- enforced structurally, not by runtime
 * check. */
export type ActorCtx = { orgId: string; userId: string } & (
  | { dbUser: typeof users.$inferSelect; apiKey?: never }
  | { dbUser?: never; apiKey: { id: string; name: string } }
)

/** The narrower, older shape used by services that only ever accept a real
 * signed-in dashboard user (no API-key path). Kept distinct from `ActorCtx`
 * rather than folded into it -- callers that require a real `dbUser` should
 * keep that guarantee in the type, not re-check it at runtime. */
export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }
