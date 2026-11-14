# WHY it is shaped this way

## 1. The owner's decisions, with dates

| Date | Decision | Effect |
|---|---|---|
| 2026-09-22 | The owner approved the earlier public sentence for claim `CLM-004` | That approval covers the old sentence only; the reworded one is not approved (see below) |
| 2026-11-14 (brief) | The method is **Identify, then Classify, then Prove**, as a complete lifecycle repeated every week, driven by the Monday e-mail, for schools, universities and CA or CS firms | The whole design; it replaced the earlier Discover, Act, Confirm draft (PR 2206) and its proposed migration 0760 |
| 2026-11-14 (brief) | Three fix, test, audit rounds, each with a fresh independent read-only auditor, wording kept honest, migrations kept as files until the owner says go | `icp/ROUND-LOG.md`; three rounds, then three more audits on the boss's request |
| 2026-11-14 | The owner answered **yes** to: merge PR 2207, run migrations 0761 to 0763, deploy | The go-live described in `05-LIVE-STATE-AND-OPEN-ITEMS.md` |
| 2026-11-14 | Keep the Monday e-mail block **off** until the boss says otherwise; leave `CLM-004` and PR 2206 as they are | The switch is `0`; both items wait for the owner |
| Standing rules | No paid steps; no Vercel deploy; payments only through the one existing seller and gateway (the product never moves money); never the words "compliant", "certified" or "guaranteed"; no personal data in prompts, URLs or logs | Kept throughout |

## 2. Design reasons

- **A count, never a rating.** A law cannot be "ticked compliant" by software. The page counts routine steps and says so.
- **Names of things, never people.** The register and every free-text field refuse e-mail-like and phone-like text, because the product must not become a store of the personal data it helps protect. The guard is a heuristic, so the wording says "built not to contain", not "contains none".
- **The file stays with the organisation.** Only a fingerprint, a name, a place and a date are kept, so VERIDIAN can say "recorded by you" but never "verified".
- **Append-only records.** The weekly record and evidence cannot be edited; History is hash-chained and the evidence pack re-checks the chain.
- **Each person sees only their own clients.** Showing a firm's whole client list to the firm's owner would let a person see clients they do not act for (see Audit 5).
- **Migrations before merge.** Merging to main auto-deploys the app, which would show new screens before the database functions exist. So the database changes (additive, ignored by the old app) go first, then the merge. See `04-HOW.md`.

## 3. The audit rounds and what each found

Each audit was a fresh, read-only, adversarial reviewer that did not write the code. Full detail and the fixes are in [`dpdp-app/docs/icp/ROUND-LOG.md`](../../dpdp-app/docs/icp/ROUND-LOG.md).

| Audit | Verdict | What it found (short) |
|---|---|---|
| 1 (register and classify, 0761) | FAIL | Staff could read the register; the weekly record stored an e-mail address; free text could carry contact details; children's-data rules too narrow (school exemption missing); a sign-off could tick another step; the mirror into older tables could downgrade a confirmed location |
| 2 (Prove, 0762) | FAIL (3 high) | The pack leaked legacy free text; older grievances could not be closed from the new screen; closing a breach made the late-report step green with no Board report; plus seven medium items (breach list, locked-account flag, truncation, fingerprint wording, time zone, overwrite) |
| 3 (Monday e-mail, 0763) | FAIL (2 high) | The client roll-up read a table no real flow fills and any organisation could write to; the overview still passed legacy free text; carry-over listed steps open for everyone every Monday |
| 4 | FAIL (2 high) | A firm could read any CA's clients by naming that CA as a member; the roll-up used an older client rule than the live "My clients"; the organisation hint swallowed refusals (a payment screen became another organisation) |
| 5 | FAIL (2 medium) | The "CA opened the firm" gate was not consent, so a firm owner could receive a CA's clients: the firm-wide roll-up was removed, each person is shown only their own clients |
| 6 | **PASS** | No high or medium defect. It compared the client function with the live "My clients" on randomised data (four seeds, 40 organisations): no organisation a person does not act for was ever shown, and every planted break was caught |

Audit 6 recorded low items that were not fixed (none can show a person another person's data): the 25-recipient cap is applied before clients are known; scoring is not bounded for very large firms (on a timeout the e-mail goes without the block and the Monday snapshot rolls back with it); a few untested caps; a source-text test for the sender.

Verification beyond the audits: tests on real Postgres run as WebAssembly (PGlite), checked by planting each fix's break and seeing the test fail; the dpdp-app build gate; CI green on the merged head.

## 4. Wording that differs from the brief

Where the brief's sentences were not yet true of the product, the public pages say what is true instead (no flow sends consent links to parents; no flow publishes a Grievance Officer page; some library controls are good practice, not a legal duty). The owner should look at the reworded sentence (`CLM-004`).
