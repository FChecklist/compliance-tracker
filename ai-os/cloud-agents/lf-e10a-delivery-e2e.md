# Package lf-e10a-delivery-e2e (laptop app, repo projexa): the delivery modules offline, in a real browser

Read `lf-e9-COMMON.md` and `PREAMBLE.md`. Branch `claude/lf-e10a-delivery-e2e` from `origin/main`.

## Requirement (owner)
"The whole software works on the laptop with no internet and with our server down": work progress, labour, materials and the schedule must open from the laptop's own database, let the person do their work offline, and send each edit exactly once when the connection is back. Only the BOQ screen has been proven in a browser.

## Your area (routes in `src/lib/local-first/shell/clusters/delivery.ts`, screens in `src/lib/local-first/shell/modules/`)
`/work-progress` (+ `?tab=entry|analytics|report`), `/work-progress/:id`, `/labour`, `/labour/:id`, `/labour/attendance/new`, `/labour/attendance/:date`, `/materials`, `/materials/:id`, `/materials/receipts/new`, `/materials/receipts/:id`, `/materials/issues/new`, `/schedule`, `/schedule/tasks/:id`. Local writes: `src/lib/local-first/local-writes.ts`, `modules/delivery-writes.ts`, the outbox (`outbox.ts`). Routes registered as `DeliveryServerOnlyScreen` must fall through to the server when online and show the calm "needs the server" state when offline (never a crash).

## Do
1. Build `e2e/support/lf-delivery-stub.ts`: a generic fixture-driven sync stub (manifest with the kinds of your area, `/heads`, `/pull`, `/changes`, `/ids`, `/push` that RECORDS every op and answers `applied` with a new version, `/release/*`, `/install`) in the real service's shapes, plus the page's `/api/*` answers the app needs. Seed realistic fixtures per kind (several rows, one with a long text, one with money, one soft-deleted) so assertions are on real VALUES.
2. One spec file `e2e/lf-delivery-*.spec.ts` with a test per screen: open it with the network OFF from the on-laptop shell after one online prepare, assert the specific values shown (quantities, names, dates, totals), assert the empty state and the "not synced yet" state where they exist, assert a viewer-role person sees it read-only (no write controls) while a member/manager can write.
3. For EVERY local write in your area (create/update of progress entries, attendance, material receipts/issues, schedule task changes...): type into the real inputs with real keystrokes (`page.keyboard.type`, not `fill` only: the keystroke crash class), save OFFLINE, assert the screen shows "waiting to sync" with the value, reload offline and assert the edit is still there (outbox + optimistic copy persisted), go online, assert the stub received EXACTLY ONE push op with the right `function_id` and the REAL registry's parameter names (see COMMON), and the waiting mark clears; then an op the server answers `conflict` and one it `rejected`s must surface to the person (`OutboxAttention`) without losing what they typed.
4. Console hygiene: no `pageerror`, no unexpected `console.error` (allow-list only `/favicon.ico` 404 and the deliberate offline network errors), no `[role=alert]` crash text, on every screen.
5. Find the bug class around `e.currentTarget` / stale closures in these screens and their siblings (grep first) and fix it with tests.

## Deliverables
`e2e/lf-delivery-*.spec.ts`, `e2e/support/lf-delivery-*.ts`, app fixes with tests, a table of every function id + params this area can enqueue with the real-registry check result.
