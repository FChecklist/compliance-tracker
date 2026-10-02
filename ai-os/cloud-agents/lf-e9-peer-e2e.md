# Package lf-e9-peer-e2e (laptop app, repo projexa): laptop-to-laptop sync in a real browser

Read `lf-e9-COMMON.md` and `PREAMBLE.md`. Branch `claude/lf-e9-peer-e2e` from `origin/main`.

## Requirement (owner)
"Several laptops auto-sync": two laptops of the same organisation (and the same view class) exchange rows directly, with NO server, so a laptop that missed an update gets it from a neighbour. Only inside one organisation and one role class; rows are SIGNED by the server so a peer cannot forge or alter them; trust comes from a 24 h attestation token bound to the holder's own device key. Spec: `docs/local-first/CONTRACT.md` section 4, `src/lib/local-first/peer/*` (protocol, attest, auto-sync, scheduler, network, org-peer, reset-copy), `docs/local-first/ORG_KINDS.md`.

## State
`e2e/peer-sync.spec.ts` (config `playwright.peer.config.ts`) is ONE test that was written on a laptop that could not run it: two browser contexts on one origin, a real WebRTC data channel over loopback, signalling relayed by the test. It has never run. Everything else about peers has unit tests only (`peer/*.test.ts`, `src/lib/local-first/conformance`).

## Do
1. Make `e2e/peer-sync.spec.ts` pass in Chromium (fix app bugs it finds; WebRTC over loopback needs the right Chromium flags/ICE settings: configure them in the Playwright config only if the app code is not at fault, and say so).
2. Make the rows REAL: sign them with the backend's own signing code (`compliance-tracker/supabase/functions/projexa-sync/sign.ts`: `generateKeyRecord`, `createSigning`, `signItemV3`, `signToken`, holder binding `holderProofMessage`) so the test exercises the production verify path with a genuine ES256 key pair, genuine px3 signatures and a genuine attest token (copy the pieces you need into `e2e/support/lf-peer-sign.ts`; do not import across repos at runtime).
3. Then extend to these cases, each its own test, each asserting real values: (a) laptop B (no server at all) receives A's rows, verifies every signature and shows them in the on-laptop shell; (b) a row with changed data, or cut for ANOTHER view class, or signed by an unknown key is REFUSED and the refusal is visible to the code (not silent corruption); (c) organisation isolation: a peer of another organisation (valid token for ITS org) is refused and none of its rows land; (d) an expired attestation (>24 h) and a token copied without the holder's device key (cnf.jkt mismatch) are refused; (e) version precedence: a higher version replaces, an older one does not, a tombstone (delete) propagates, and a row B has edited locally (dirty, pending in its outbox) is NOT overwritten; (f) epoch / `reset_required` mismatch makes B take a fresh copy instead of mixing; (g) the auto-sync scheduler: B comes back online later and catches up from the peer with no server call (count the server calls: zero), and presence/announce works when both start at the same moment (the unit fix `fix(local-first/peer): two laptops starting together no longer miss each other` is the thing to prove in a browser); (h) organisation kinds (vendors, departments, org people, cost visibility) travel only between peers of the same role class.
4. Findings you cannot fix inside this package go in the report.

## Deliverables
`e2e/peer-sync.spec.ts` (fixed) plus `e2e/lf-peer-*.spec.ts`, helpers, app fixes with tests, and a note for the integrator on how to run it in CI (`playwright.peer.config.ts` or a widened `playwright.local-first.config.ts`).
