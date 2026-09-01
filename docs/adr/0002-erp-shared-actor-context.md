# 0002: One shared actor-context type instead of per-file redefinitions

- Status: Accepted, implemented 2026-08-15
- Related: VERIDIAN Review Framework, Architecture & Design / Engineering
  Principles, "Elimination of Duplicate Functionality" finding.

## Context

Most service-layer mutation functions need to know who is performing the
action, for two reasons: `logActivity()` needs a real `userId` to write an
audit-log row, and this codebase supports two distinct ways a call can be
authenticated -- a session-authenticated dashboard user (`dbUser`), or a
server-to-server caller authenticated by API key (`apiKey`), the latter
used by PROJEXA's `callVeridian()` proxy, which always calls with a shared
Bearer API key and never a session cookie.

Quantifying real duplication with `jscpd` across `src/lib/engines/` +
`src/lib/services/` (258 files) found overall duplication low (0.80%
duplicated lines, 30 clones) -- but a handful of those clone hits, followed
by hand, led to a real, larger duplicate-type cluster jscpd's line-based
clustering only partially surfaced: this exact "actor" type shape --
`{ orgId: string; userId: string } & ({ dbUser: ...; apiKey?: never } |
{ dbUser?: never; apiKey: {...} })` -- had been independently redefined in
22 separate files. Six used the same name (`ActorCtx`); five more used a
file-local name for the identical structure (`AccessReviewActorCtx`,
`RecordPaymentActorCtx`, `SellingActorCtx`, `FraudActorCtx`,
`GrcActorCtx`); a related, narrower shape (`ErpContext`, the `dbUser`-only
case) was separately redefined in 18 files. The different names for an
identical structure were themselves the signal the finding's gap
description called out: "some naming suggests undetected duplication
elsewhere."

## Decision

Added `src/lib/services/actor-context.ts` exporting canonical `ActorCtx`
and `ErpContext` types. All 22 files now import from there instead of
locally redefining. The five differently-named exports are kept as
one-line type aliases (e.g. `export type FraudActorCtx = ActorCtx`) so
every existing external import of those specific names still resolves --
this was a type-only change; no function signature, runtime behavior, or
external call site needed to change.

## First-principles rationale

A type that encodes an invariant (here: "exactly one of `dbUser`/`apiKey`
is present") is only doing its job if there is exactly one definition of
it -- 22 independently-typed copies can silently drift (one gets a third
field added, one gets the union order swapped, one gets narrowed) with no
compiler error to catch the divergence, because TypeScript's structural
typing makes near-identical-but-not-quite types interchangeable at call
sites until they aren't. Consolidating to one canonical definition turns
"these 22 types happen to currently agree" into "these 22 names are
provably the same type," which is the actual guarantee duplicate-detection
tooling is a proxy for -- the token-level clone count is a symptom;
type-level drift risk is the real problem this decision closes.

## Consequences

- Future changes to the actor-context shape (e.g. adding an `orgRole`
  field) are made once and apply everywhere, instead of requiring a
  22-file sweep that could easily miss one of the five differently-named
  copies.
- `src/lib/services/permission-service.ts` and its `ERP_ACTION_ROLES`
  table were explicitly not touched -- this ADR is about the actor
  *identity* shape, not the permission/role-check logic that consumes it.
- Does not address the two remaining smaller jscpd clone clusters (e.g.
  `email-intelligence-service.ts` <-> `ticket-intelligence-service.ts` <->
  `veri-meeting-service.ts` sharing ~12-15 line drafting-prompt-assembly
  blocks) -- left as-is: overall duplication is low (0.80%), and those
  clusters are prompt-construction logic specific enough to each feature
  that forcing a shared abstraction now would be premature; worth
  revisiting only if a fourth near-identical copy appears.
