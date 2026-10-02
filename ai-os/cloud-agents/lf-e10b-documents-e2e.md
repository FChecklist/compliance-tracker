# Package lf-e10b-documents-e2e (laptop app, repo projexa): documents, change orders and design studio offline, in a real browser

Read `lf-e9-COMMON.md` and `PREAMBLE.md`. Branch `claude/lf-e10b-documents-e2e` from `origin/main`.

## Requirement (owner)
"The whole software works on the laptop with no internet and with our server down." Permits, drawings, documents, minutes of meetings, change orders and the design studio's timesheets must open from the laptop's own database, let the person work offline, and send each edit exactly once when the connection is back. None of these has been run in a browser.

## Your area
Documents cluster (`shell/clusters/documents.ts`): `/permits`, `/permits/:id`, `/drawings`, `/drawings/:id`, `/documents`, `/documents/:id`, `/moms`, `/moms/:id`. Design/change cluster (`shell/clusters/design-change.ts`): `/change-orders`, `/change-orders/new`, `/change-orders/:id`, `/design-studio`, `/design-studio/timesheets/new`, `/design-studio/timesheets/:id`, `/design-studio/review`, `/design-studio/cost-analysis`. Screens in `src/lib/local-first/shell/modules/` (`PermitsListScreen`, `DrawingObjectScreen`, `DocumentObjectScreen`, `DocumentDetailsEditor`, `MomObjectScreen`, `ChangeOrder*Screen`, `DesignStudio*Screen`...). Writes: `local-writes.ts`, the outbox; AI deletes become drafts the person confirms (`outbox-drafts.ts`). Routes registered as `DocumentsServerOnlyScreen` / `DesignChangeServerOnlyScreen` must fall through to the server when online and show the calm "needs the server" state offline (never a crash).

## Do
Exactly the steps of `lf-e10a-delivery-e2e.md` (stub in `e2e/support/lf-documents-stub.ts`, a spec per cluster `e2e/lf-documents-*.spec.ts`, real values asserted, role-based read-only vs write, real keystrokes, offline save then reload then online with EXACTLY ONE push op per edit using the REAL registry's parameter names, conflict/rejected surfaced without losing typed text, console hygiene, the `currentTarget`/stale-closure bug class), plus these area-specific checks: (a) a document/drawing/permit with a long text, an attachment-name with unicode and a null field renders; (b) the minutes screen (MoM form: see `src/lib/mom-form.ts`'s header, it was built around the test environment) accepts real typing and saves; (c) a change order with money columns hides them from a role below the money rank (`hidden_fields`/`redacted` in the pull answer) and does not send a write for a hidden field; (d) the design-studio timesheet create flow offline then sync; (e) deleting a document through the AI path becomes a DRAFT the person confirms, and the person's own delete (if the screen has one) goes through the outbox exactly once.

## Deliverables
As in e10a, with a table of every function id + params your area can enqueue and the real-registry check result.
