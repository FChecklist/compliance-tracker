> **ARCHIVED / STALE — do not treat as current.** See docs/master/INDEX.md or ai-os/MASTER-TRACKER.yaml for current status.

# Audit — Wave 149: Intent Engine v1 (branch `wave149/intent-engine`)

**Auditor:** Security & Code Reviewer (cross-audit; not the implementer)
**Files reviewed:** `src/lib/intent-engine.ts`, `src/lib/intent-engine.test.ts`
**Mode:** AUDIT-ONLY — no application code modified.

---

## Scope & threat model

`classifyIntent()` is a pure string-classification helper. It is **not** an auth/RBAC
gate and contains no route, no I/O, no network, no persistence. The only
security-relevant surface is (a) regex construction from trigger phrases and
(b) whether user input can reach a regex *as a pattern* (ReDoS / regex injection).
User-supplied `text` is only ever used as the **test target** of a regex built from
**static, author-controlled** phrases — it is never interpolated into a pattern.
So the regex-injection / ReDoS-from-user-input class does not apply here. Findings
below are correctness/quality, not OWASP-class.

---

## 1. Is `classifyIntent()` genuinely deterministic (no LLM, no randomness)?

**PASS.** The function body (`intent-engine.ts` lines ~30-42) performs only:
`text.trim()`, an empty check, iteration over `Object.entries(TRIGGERS)`, and
`RegExp.prototype.test`. There is no `fetch`/network call, no `Math.random`,
no `Date`, no `crypto`, no async, no external module import beyond type-only
`bun:test` in the test file. `Object.entries` on a string-keyed object literal
yields insertion order, which is stable, so iteration order — and therefore
which intent wins on overlap — is deterministic. `confidence` is a constant
`"high"` on match and `null` otherwise; no scoring/probability is computed.

---

## 2. Is `toWordBoundaryRegex` correctly escaping regex metacharacters?

**PASS.** `intent-engine.ts`:

```ts
function toWordBoundaryRegex(phrase: string): RegExp {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${escaped}\\b`, "i")
}
```

The character class `[.*+?^${}()|[\]\\]` escapes the full standard set of JS
regex metacharacters: `. * + ? ^ $ { } ( ) | [ ] \`. The `]` and `\` are
correctly placed at the end of the class so the class itself is well-formed.
A phrase containing `.` or `?` would be backslash-escaped and matched
literally; it could neither break the regex (no `SyntaxError`) nor broaden
the match.

Caveat (informational, not a defect): **none of the current TRIGGERS actually
contain a metacharacter**, so the escaping path is unexercised by the live
data. The apostrophe in `"what's the status"` is not a regex metacharacter and
is correctly left literal. The escaping is correct by inspection; I am not
deducting for lack of a test, only noting that the test suite does not
explicitly cover a phrase like `"status?"` or `"v2.0 report"`.

Minor performance note (not security): `toWordBoundaryRegex` is called inside
the double loop on every `classifyIntent` invocation, rebuilding the same
~23 regexes each call. For a v1 routing gate called per-message this is fine;
if it ever moves into a hot loop, memoize the patterns at module load.

---

## 3. Does the "matches on word boundaries, not substrings" test actually prove its claim?

**PASS with a precision note.** Trace of the test
(`intent-engine.test.ts`, "matches on word boundaries, not substrings"):

- Input: `"statuses are unrelated to this sentence"`.
- The only `check_status` trigger that could conceivably fire on the word
  "status" is `"status of"` → regex `/\bstatus of\b/i`.
- `\b` before `status` **does** match at the start of `statuses` (boundary
  between start-of-string/whitespace and the word char `s`), so the leading
  boundary does *not* by itself prevent a hit inside `statuses`.
- What actually prevents the match is the **` of` suffix**: after `status`
  inside `statuses` comes `es are…`, not ` of`. So `/\bstatus of\b/` fails.
- The other `check_status` triggers (`"how is"`, `"is this done"`, `"what's
  the status"`, `"what is the status"`, `"check status"`, `"check the
  status"`) likewise do not occur in the input. Result: `unknown`. ✅

So the **assertion is correct and the test passes for the right outcome**.
However, the test's *stated rationale* ("word-boundary regex should still
match the phrase 'status of' correctly without false-firing on unrelated
words that merely contain 'status' as a substring") is slightly imprecise:
it is the multi-word ` of` suffix, not the `\b` anchors, that saves this
specific case. Because **every trigger in TRIGGERS is multi-word**, the
word-boundary anchors' main job (preventing a single-token trigger from
matching inside a longer token, e.g. trigger `"task"` inside `"multitasking"`)
is not actually exercised by any current trigger. The test is valid as far as
it goes; I'd recommend a future test with a contrived single-word trigger to
genuinely exercise `\b`, but this is a test-coverage nicety, not a defect.

---

## 4. Triggers likely to false-positive on ordinary unrelated sentences

**CONCERN — one genuine real-world false-positive risk:**

- **`"how is"`** (`check_status`). This is extremely common in ordinary
  English and will fire `check_status` on sentences that have nothing to do
  with task/compliance status, e.g.:
  - *"How is your day going?"*
  - *"How is the weather there?"*
  - *"How is she feeling now?"*
  - *"How is that even possible?"*
  All of these classify as `check_status` with `confidence: "high"`. This is
  not a contrived edge case — it is everyday phrasing. Recommend tightening
  to something like `"how is the status"` / `"how is it going"` scoped to a
  task, or dropping `"how is"` in favor of more specific variants.

Moderate / lower-risk (acceptable for v1, worth watching):

- **`"is this done"`** — could fire on casual *"Is this done cooking?"* but
  reasonably scoped; low risk.
- **`"status of"`** — broad-ish (*"the status of my order"*) but semantically
  on-target for a status intent; acceptable.
- **`"new task"` / `"new contact"` / `"new customer"`** — short but specific
  enough; low risk.
- **`"give me a summary"`** — specific; fine.

No trigger creates an injection or auth-bypass risk; the concern is purely
classification accuracy, which matters because Wave 150's routing gate will
act on this label. A broad `"how is"` is the one I'd ask Claude to revisit
before Wave 150 consumes it.

---

## 5. Zero existing call sites today

**CONFIRMED (within the files read).** `intent-engine.ts` exports
`classifyIntent`, `INTENT_LABELS`, and the `Intent` / `IntentClassification`
types. It imports nothing (no side-effect imports, no registration with any
router/store/registry). The only importer is the co-located test file
`intent-engine.test.ts` via `import { classifyIntent } from "./intent-engine"`.
Per the task brief, Wave 150 (not yet merged) is the first real consumer. The
module is self-contained and additive; merging it changes no existing
behavior. No `requireAuth()`/RBAC question arises because no route is added
or modified by this file.

---

## Summary

| Check | Verdict |
|---|---|
| Deterministic, no LLM/randomness | PASS |
| `toWordBoundaryRegex` metacharacter escaping | PASS (unexercised by current data) |
| Word-boundary test proves its claim | PASS (rationale slightly imprecise; outcome correct) |
| False-positive-prone triggers | CONCERN — `"how is"` is too broad |
| Zero existing call sites | CONFIRMED |
| OWASP-class issues (injection/auth/XSS/IDOR) | None — N/A for a pure classifier |

No security-blocking findings. The single substantive note is a classification
quality issue (`"how is"`), which is best addressed before Wave 150 wires this
into a routing gate but does not block merging the isolated module now.

**Overall verdict: APPROVE WITH NOTES**
