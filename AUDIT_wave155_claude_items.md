# AUDIT — Wave 155 (Claude implementation)

Branch: `wave155/guardrail-messages`
Scope: guardrail message quality + assumption-clarification system prompt.
Files reviewed (exactly once each):
1. `src/lib/high-impact-action-detector.ts`
2. `src/lib/high-impact-action-detector.test.ts`
3. `drizzle/0131_wave155_chat_system_prompt_v2.sql`

This is an audit-only task. No application code was modified.

---

## 1. HIGH_IMPACT_CATEGORY_GUIDANCE keys vs. HighImpactCategory

**Verdict: PASS**

The `HighImpactCategory` union (top of `high-impact-action-detector.ts`) declares exactly
nine members:

```
delete | archive | payment | approval | rejection |
compliance_submission | access_changes | data_export | configuration_changes
```

`HIGH_IMPACT_CATEGORY_GUIDANCE` (bottom of the same file) is typed
`Record<HighImpactCategory, string>`, so TypeScript enforces exact-key coverage at compile
time on an object literal (excess/missing keys are errors). Checking the literal anyway:

| HighImpactCategory member     | Present in GUIDANCE? | Spelling match? |
|-------------------------------|:--------------------:|:---------------:|
| delete                        | yes                  | exact           |
| archive                       | yes                  | exact           |
| payment                       | yes                  | exact           |
| approval                      | yes                  | exact           |
| rejection                     | yes                  | exact           |
| compliance_submission         | yes                  | exact           |
| access_changes                | yes                  | exact           |
| data_export                   | yes                  | exact           |
| configuration_changes         | yes                  | exact           |

All nine categories are present, no typos, no missing categories, no extra/spurious keys.
The keys also line up 1:1 with `HIGH_IMPACT_CATEGORY_LABELS` and with the `TRIGGERS` map
above them, so the detection path, the label path, and the guidance path all reference the
same category set.

---

## 2. Guidance message quality — polite + genuinely actionable per category

**Verdict: PASS (with one minor note)**

Each message states *why* the category is high-impact and *what* confirm vs. cancel means
for that specific category. They are not generic boilerplate with find-replace — each
opens with a category-specific consequence:

- **delete** — "Deletions can't be undone." → confirm = you're sure; cancel = double-check what you're removing. Specific and correct.
- **archive** — "Archiving hides this from active views but keeps the record." → confirm = proceed; cancel = you meant something else. Correctly distinguishes archive from delete (a common UX confusion).
- **payment** — "Payments move real money and can't be reversed automatically." → confirm only if amount and recipient are correct. Specific to payment's irreversibility and the two fields that matter (amount, recipient).
- **approval** — "Approving marks this as officially signed off." → confirm if reviewed; cancel to look again. Correct.
- **rejection** — "Rejecting will notify the requester and close this out." → confirm if right call; cancel to reconsider. Correctly flags the side-effect (notifying requester).
- **compliance_submission** — "Submissions go to the relevant authority and are hard to retract." → confirm only once verified. Specific to regulatory irreversibility.
- **access_changes** — "This changes who can see or do what." → confirm if person/role correct; cancel to review permissions. Correct.
- **data_export** — "This exports data outside the platform." → confirm if needed; cancel if unintentional. Correctly frames the data-leaving-platform risk.
- **configuration_changes** — "This changes shared settings for everyone." → confirm if sure; cancel to check impact. Correctly flags the blast radius (everyone).

All nine are distinct strings (the test asserts this and it holds by inspection), polite in
tone, and each ties the confirm/cancel semantics to that category's actual consequence
rather than a templated "This is a {category} action, confirm or cancel."

Minor note (not a defect): `payment` and `compliance_submission` phrase the action purely as
"Confirm only if …" and do not literally contain the word "cancel." The consequence of
*not* confirming (i.e., cancel = don't submit because amount/recipient or verification may
be wrong) is implied rather than spelled out. This is still actionable and the unit test
only requires `confirm` OR `cancel`, which both satisfy. No change required, but if the
team wants strict symmetry with the other seven messages, an explicit "or cancel to …"
clause could be appended to those two. This is a polish suggestion, not a blocker.

---

## 3. SQL migration — placeholder preservation + demote/promote transaction correctness

**Verdict: PASS**

`drizzle/0131_wave155_chat_system_prompt_v2.sql` is a single `DO $$ … END $$` PL/pgSQL
block, which executes inside one implicit transaction, so the demote and the promote are
atomic — either both happen or neither does.

Step-by-step:

1. `SELECT id INTO tpl_id … WHERE template_key = 'chat.ai_thread_system'` — locates the
   template row.
2. Guarded by `IF tpl_id IS NOT NULL THEN` (defensive: if the template seed hasn't run,
   the block is a no-op rather than erroring).
3. `UPDATE compliance.prompt_versions SET label = NULL WHERE prompt_template_id = tpl_id
   AND label = 'production'` — demotes **every** currently-production-labeled version for
   this template to `NULL`. Demoting all matching rows (rather than a single row) is
   actually more robust than a single-row demote: if a prior data anomaly left two rows
   labeled `production`, this normalizes to zero before the insert.
4. `SELECT COALESCE(MAX(version),0)+1 INTO next_version` — picks the next version number.
5. `INSERT … VALUES (tpl_id, next_version, $tpl$…$tpl$, 'production')` — inserts the new
   version and promotes it in the same statement.

After the block runs, exactly one row for this template holds `label = 'production'` (the
newly inserted one), because step 3 zeroed out all prior production labels and step 5 sets
exactly one. The demote-old-then-promote-new invariant holds: only one version carries the
production label after this migration.

`{{PURPOSE_CLAUSE}}` is preserved verbatim inside the `$tpl$…$tpl$` dollar-quoted content
string, positioned at the end of the prompt body exactly where the original seed placed it.
Using `$tpl$` as the quoting tag avoids any collision with the `$$` block delimiter and
with the `{{ }}` mustache syntax, so the placeholder reaches the runtime untouched.

Note (not a defect): the `IF tpl_id IS NOT NULL` guard means that if
`chat.ai_thread_system` is absent from `prompt_templates`, the migration silently does
nothing. This is intentional idempotency/defensive behavior and matches the "don't fail
loudly on a missing seed" pattern, but it does mean a missing template would not surface
as an error. Acceptable for a content-version migration.

---

## 4. New system prompt — ask-before-assume vs. concise-and-practical

**Verdict: PASS**

The new production prompt content is:

> "You are VERIDIAN AI, a helpful assistant embedded in a compliance management platform.
> Keep replies concise and practical -- most replies should be a few words, not paragraphs;
> save longer answers for research or analysis questions. If you are about to assume
> something the user did not actually say, ask a short clarifying question instead of
> guessing. {{PURPOSE_CLAUSE}}"

**Ask-before-assume requirement (Task.docx):** satisfied explicitly — "If you are about to
assume something the user did not actually say, ask a short clarifying question instead of
guessing." This is a direct, unambiguous instruction to ask rather than assume, matching
the Task.docx ask-before-assume requirement.

**No contradiction with conciseness:** the clarifying-question instruction is itself
scoped to "a short clarifying question," which reinforces rather than fights the preceding
"keep replies concise and practical" instruction. A one-line clarifying question is itself
a concise reply, so the two sentences are consistent — asking a short question is the
concise response when an assumption would otherwise be needed. The "save longer answers
for research or analysis questions" carve-out also leaves room for the longer replies a
clarifying exchange might require, so there is no internal tension.

The prompt does not weaken or remove any prior instruction present in the original seed
(brevity was already partly there per the migration comment referencing Wave 154's Response
Engine); it adds the ask-before-assume clause as a new sentence. No contradiction detected.

---

## Summary

| Check                                                                 | Verdict |
|-----------------------------------------------------------------------|:-------:|
| GUIDANCE keys match HighImpactCategory exactly (no typos/missing)     | PASS    |
| Guidance messages polite + per-category actionable (not boilerplate) | PASS*   |
| SQL preserves {{PURPOSE_CLAUSE}} + correct demote/promote (one prod)  | PASS    |
| System prompt satisfies ask-before-assume, no conciseness conflict    | PASS    |

\* minor polish note on `payment` / `compliance_submission` not literally containing
"cancel" — actionable regardless, not a blocker.

No OWASP-class issues, no auth/RBAC surface (this wave touches no routes — it is a
deterministic detector map, a unit test, and a content-version SQL migration), no
injection vectors (the SQL uses a parameterized `WHERE template_key =` lookup and
dollar-quoted content with no string interpolation of user input), and no insecure
direct-object-reference concerns.

Overall verdict: APPROVE WITH NOTES
