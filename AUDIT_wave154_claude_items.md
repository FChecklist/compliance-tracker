# AUDIT — Wave 154 (Claude): Response Engine

**Branch audited:** `wave154/response-engine`
**Files audited:** `src/lib/response-engine.ts`, `src/lib/response-engine.test.ts`, `src/lib/llm-routing-gate.ts` (check_status wiring only)
**Requirements doc:** `TaskDocx_Evaluation.md` ("Response Engine")

> **Process note (not a finding against the code):** `TaskDocx_Evaluation.md` is **not present** in the repo — not at root, not under `docs/`, not under `history/`. I could not read it directly. The relevant requirements (the 9 predefined labels and the "maximum ~4 words + any specific requirement or observation" rule) are, however, quoted verbatim in the header comment of `src/lib/response-engine.ts`, so the audit below is grounded in the doc's actual stated requirements as embedded in the code. Recommend the repo owner commit the doc itself so future audits can read the source of truth.

---

## 1. Is the vocabulary genuinely deterministic (no LLM call, no randomness)?

**Verdict: PASS.**

- `formatShortReply` (`response-engine.ts`) is a pure lookup into the `RESPONSE_TEXT` record plus a `.trim()` on the optional detail. No I/O, no `Math.random`, no `Date.now`, no async.
- `renderShortReply` is a pure string template: `reply.detail ? \`${reply.text} — ${reply.detail}\` : reply.text`.
- `suggestResponseForTaskStatus` is a synchronous `switch` over a string with a `default` arm. No LLM import, no `llm-client`, no network.
- The module imports nothing from `./llm-client` or any model resolver. The only import in `llm-routing-gate.ts` from this module is the two pure functions `suggestResponseForTaskStatus` and `renderShortReply`.

This matches the doc's stated goal (software picks the label with zero LLM cost; an LLM, if ever invoked, only relays a label software already chose). Genuinely deterministic.

---

## 2. Does every predefined label stay within the "max ~4 words" rule?

**Verdict: PASS.** All 9 labels checked against `RESPONSE_TEXT`:

| Label key | Text | Word count |
|---|---|---|
| `yes` | `Yes` | 1 |
| `no` | `No` | 1 |
| `ok` | `OK` | 1 |
| `pending` | `Pending` | 1 |
| `completed` | `Completed` | 1 |
| `need_clarity` | `Need Clarity` | 2 |
| `require_input` | `Require Input` | 2 |
| `wrong_data` | `Wrong Data` | 2 |
| `incomplete_instructions` | `Incomplete Instructions` | 2 |

Every label is ≤ 2 words, well within the ~4-word cap. The test file (`response-engine.test.ts`, "covers every label…") also asserts `reply.text.split(" ").length <= 4` for all 9, so this is enforced, not just coincidental.

**Note on the `detail` field:** `detail` can be longer (e.g. `"GST filing (in progress)"`, `"${taskTitle} failed"`). This is **not** a violation — the doc explicitly allows "maximum 4 words **+ any specific requirement or observation**", and `detail` *is* that specific observation. The label stays short; the detail carries the concrete fact. Correct interpretation.

---

## 3. Does the status → label mapping in `suggestResponseForTaskStatus` make logical sense?

**Verdict: CONCERN (judgment call — two mappings are defensible but a stretch).**

- `completed → completed` — exact. ✅
- `pending → pending` — exact. ✅
- `in_progress → pending` (detail `"... (in progress)"`) — sensible; "in progress" is a sub-state of "not done yet / pending". The detail disambiguates, so no information is lost. ✅
- `default → pending` (detail = raw status) — safe catch-all; never throws, never lies about a known state. ✅

The two worth a real opinion:

- **`failed → wrong_data`** — **stretch.** A task can fail for many reasons unrelated to bad input data: timeouts, infra outages, permission errors, upstream API 500s. Telling the user "Wrong Data" when the real cause was, say, a transient network failure is **misleading**. It is defensible only in the narrow sense that "Wrong Data" is the closest *negative-outcome* label in a 9-word vocabulary that has no generic "Failed"/"Error" label. The mitigating factor is the `detail` string (`"${taskTitle} failed"`) which carries the accurate fact; the label is the part that overstates. **Recommendation:** either add a `failed` label to the vocabulary (the doc's list is illustrative, not exhaustive — "such as…"), or map `failed → need_clarity` is worse, so at minimum keep `wrong_data` but consider that this is the weakest mapping in the set.

- **`cancelled → incomplete_instructions`** — **stretch.** Cancellation is frequently *user-initiated* ("I changed my mind", "no longer needed"), not a consequence of missing instructions. Mapping every cancellation to "Incomplete Instructions" implicitly blames the user's input when the cause may have been the user's own choice. Same mitigation as above: the `detail` (`"${taskTitle} cancelled"`) states the true fact, so the reply is `"Incomplete Instructions — X cancelled"`, which is internally contradictory (it says both "instructions were incomplete" and "X was cancelled" without linking them). This is the one reply a user could reasonably find confusing/accusatory.

Neither is a FAIL — both are the closest semantic fits available within a fixed 9-label vocabulary, and the `detail` always preserves the accurate event. But they are genuine stretches, not "obviously correct", and a future reviewer should not assume they're load-bearing. If the vocabulary is allowed to grow (the doc says "such as", implying the list is exemplary), a dedicated `failed` label would let `failed → failed` and `cancelled → cancelled` be exact, removing both stretches at once.

---

## 4. Does wiring this into `check_status` change existing behavior in a way that could break something?

**Verdict: PASS (purely a string-formatting change, same underlying data).**

In `llm-routing-gate.ts`, the `check_status` handler:
- Runs the **same** DB query it ran before (`withTenantContext` → `tasks.findFirst` by `userId`, `orderBy desc(createdAt)`). No query change.
- Returns the **same** `"No tasks yet"` string when no task exists. Unchanged branch.
- For the found-task branch, the only change is the reply *format*: `renderShortReply(suggestResponseForTaskStatus(latest.status, latest.title))` instead of whatever prose was there before. The underlying data is identical — `latest.status` and `latest.title`, nothing else.

So this is a string-formatting swap, not a logic change. The only regression surface would be a downstream consumer that **parsed the old prose string**. `tryDeterministicRoute` returns `reply` as an opaque string into the chat path; nothing in this module parses it back. Low risk. No new auth/RBAC surface is introduced or removed — `check_status` was already gated by `withTenantContext(ctx, …)` (tenant + userId scoping) and that is untouched. No OWASP-class issue (no injection, no IDOR, no auth change) — the handler already enforced tenant scoping before Wave 154 and still does.

---

## 5. Does the `check_status` handler still return a string (never null/undefined) for every real status, so it can't fall through to `handled:false`?

**Verdict: PASS.**

Trace of every return path in the `check_status` handler:
1. `if (!latest) return "No tasks yet"` → string. ✅
2. Otherwise `return renderShortReply(suggestResponseForTaskStatus(latest.status, latest.title))`.
   - `suggestResponseForTaskStatus` has a `default` arm, so **every** `latest.status` value (including future/unknown statuses) yields a `ShortReply` with a non-empty `text` (the `default` returns `formatShortReply("pending", …)`).
   - `renderShortReply` always returns a string: `reply.text` is always non-empty (every `RESPONSE_TEXT` value is a non-empty literal), and the `detail ?` branch only chooses between two string forms — never `undefined`.

Therefore the handler returns a string for **all** inputs. It never returns `null`, so `tryDeterministicRoute`'s `if (reply === null) return { handled: false }` is never triggered by `check_status`. The `handled: false` fall-through is reserved for *unregistered* intents (no handler in `HANDLERS`), which is correct — `check_status` is registered and always produces a real reply. No accidental fall-through to the LLM path for a status lookup.

---

## Summary

| # | Check | Verdict |
|---|---|---|
| 1 | Deterministic (no LLM, no randomness) | PASS |
| 2 | All 9 labels ≤ ~4 words | PASS |
| 3 | status → label mapping logic | CONCERN (`failed→wrong_data`, `cancelled→incomplete_instructions` are stretches) |
| 4 | Wiring doesn't break existing behavior | PASS |
| 5 | `check_status` always returns a string, no false `handled:false` | PASS |

No OWASP-class issues. No auth/RBAC regression (tenant scoping unchanged). No injection surface (no string is interpolated into SQL, commands, or HTML; `detail` only flows into a chat reply string). The two CONCERNs are semantic-quality judgments on label mapping, not security or correctness defects — the `detail` field always preserves the accurate event, so no information is lost and no user is given a factually wrong *event*, only an arguably-misleading *label* in two specific statuses.

**Overall verdict: APPROVE WITH NOTES.**

Notes for follow-up (non-blocking):
1. Commit `TaskDocx_Evaluation.md` to the repo so the requirements source-of-truth is auditable directly, not only via code comments.
2. Consider adding a `failed` label to the vocabulary so `failed → failed` and `cancelled → cancelled` (or a dedicated `cancelled` label) become exact mappings, eliminating both stretches in §3. The doc's "such as" wording permits extending the list.
3. Optional: add a test asserting `suggestResponseForTaskStatus` never returns a `ShortReply` with empty `text` for any string input (fuzz a few odd values) to lock in the §5 guarantee.
