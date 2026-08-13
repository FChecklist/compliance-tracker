# OCID-061 -- Universal Input/Intake Discovery & Mapping (Discovery Only)

**Parent:** OCID-021 (`UMR-20260802-173631-ca85`), OCID-020 (`UMR-20260802-165606-4413`) --
**provisional**. The incoming prompt for OCID-061 was truncated: it ends after the
"universal input runtime" heading with no deliverables, success criteria, PR, commit,
worker, review, merge, or lock fields, and names no explicit parent OCID/UMR the way
OCID-053 through OCID-060's prompts did. This registration follows the same natural
parent pairing used for every other registration this session, and independently matches
a concurrent session's own registration of this same OCID-061 id under the identical
provisional pairing (`UMR-20260804-044535-7214`, OCID-053 cross-reference table §7,
branch `worker/task-20260804-040750-register-ocid-053--universal-knowledge-g`, not yet
merged to `origin/main` at time of writing). **Correct the parent here if the Owner
clarifies otherwise once the rest of the prompt arrives.**

**Scope of this dispatch:** real discovery and design mapping only. No runtime built or
modified. A fresh PM decision, with real success criteria, is required before any
implementation.

---

## 1. Mode pill / cascading "Chain Selector" ("option chain")

**Verdict: REAL -- exists and is wired.**

- `src/components/veri-chat/VeriComposer.tsx:533` -- literal `{/* Mode pills */}` comment,
  rendering `FIXED_MODES` (imported from `veri-chat-context.tsx:23`, re-exported from the
  `@fchecklist/veridian-ui-kit` package) as pill buttons that set `composerMode`.
  `FIXED_LABELS` (`VeriComposer.tsx:31`): `{ discuss: "Discuss", chats: "Chats", todo: "To Do" }`.
- The cascading picker itself is named **Chain Selector** in-code, not "option chain" --
  `src/components/veri-chat/ChainSelector.tsx`. Its own header comment states it plainly:
  "the Chain Selector (mode pill + cascading path picker)". `ChainRows` (lines 120-235) and
  `ChainSelectorDialog` (lines 257-399).
- Wired into the composer inline (`VeriComposer.tsx:593`, `<ChainRows .../>`) and as a
  standalone pre-conversation dialog (`VeriComposer.tsx:106`, `<ChainSelectorDialog .../>`).
- Resolves to `{modePill, pathKeys}`, consumed centrally by `resolveDynamicChainId()`
  (`task-service.ts`) and read server-side in `task-execution-engine.ts:1890-1916` and
  `dialogue-script-executor.ts:157-162`. Test coverage: `ChainSelector.test.ts` (112 lines).
- The literal string "option chain"/`OptionChain` does not exist anywhere in `src/`
  (confirmed by grep, zero hits) -- the prompt's "option chain" maps onto this real "Chain
  Selector" mechanism, not a separate, differently-named one.

## 2. Free chat path

**Verdict: REAL -- exists and is wired.**

- Entry component: `src/components/veri-chat/VeriComposer.tsx`, free-text mode is
  `composerMode === "discuss"` (placeholder at line 520: "Ask me anything -- no task
  selection needed..."). Mounted globally in `AppShell.tsx:163,168` (not per-page).
- API route: `src/app/api/conversations/[id]/messages/route.ts` (`GET`/`POST` ->
  `getMessages()`/`sendMessage()` in `src/lib/services/chat-service.ts`).
- `sendMessage()` (`chat-service.ts:1023`) persists the message, checks deterministic
  routes, checks `dialogue-script-executor.ts` capability matches, then falls through to a
  genuine LLM call in `generateAiReply()` (`chat-service.ts:613`) via
  `resolveModelConfig(orgId, "user_assistant_oa")` (~line 668). Group-chat variant:
  `generateVeriGroupReply()` (line 908). This is genuinely LLM-backed, not a stub --
  consistent with `ai-os/boss/COMPLETED.yaml`'s prior `GAP-OCID038-VERICHAT-NOT-DISPATCH-WIRED`
  resolution, which independently cites the same two live call sites (lines 668/923).

## 3. Speech-to-text integration

**Verdict: PARTIAL -- real code, wired only to a separate feature, and not currently
operational even there.**

- `src/lib/whisper-client.ts` -- `transcribeAudio()` (line 57) makes a real `fetch` to
  `https://api.openai.com/v1/audio/transcriptions` (`whisper-1`). Fails loud
  (`WhisperConfigError`) if `OPENAI_API_KEY` is unset, matching this codebase's established
  fail-loud convention for required env vars.
- Wired into `voice-ticket-service.ts` (`transcribeAndExtractVoiceMemo()`, line 121) ->
  `src/app/api/voice-tickets/route.ts` (25MB cap) -> `src/app/(app)/voice-tickets/page.tsx`
  (a dedicated upload/record page with its own status machine).
- **Not wired into the free-chat/mode-pill composer**: zero mic/audio/`SpeechRecognition`
  references in `VeriComposer.tsx` (confirmed by grep). Voice input exists only as this
  separate, standalone Voice Tickets upload-and-transcribe flow -- a different surface from
  the chat composer the prompt's other three intake options live on.
- **Not currently operational even on its own path**: `whisper-client.ts`'s own
  2026-07-14 header comment confirms `OPENAI_API_KEY` is not provisioned in this codebase's
  secrets as of this wave (`GROQ_API_KEY`/`OPENROUTER_API_KEY`/`CEREBRAS_API_KEY` are the
  only LLM provider keys actually set) -- every real voice memo upload will fail loudly at
  the transcription step until that key is added.

## 4. API / webhook / integration entry points

**Verdict: REAL for outbound event delivery; PARTIAL for inbound intent submission --
no generic inbound "submit an intent" gateway exists.**

- Outbound (system -> external): `src/app/api/settings/webhooks/route.ts` -- org-registered
  webhook URL + secret against a fixed `VALID_EVENTS` list, backed by real
  `webhooks`/`webhookDeliveries` tables. This notifies external systems; it does not accept
  intents from them.
- Inbound found: `src/app/api/webhooks/vercel-deployment/route.ts` -- deployment-status
  webhook, unrelated to business-intent submission.
- Closest real inbound content-submission surface: `src/app/api/veri-chat/share-target/route.ts`
  -- backs the PWA Web Share Target so another app's native OS Share Sheet can POST text in
  (`importSharedContent()` in `veri-chat-service.ts`). Real and wired, but requires an
  authenticated session (`requireAuth()`) -- a browser Share Target endpoint, not a
  general-purpose external/API-key intake gateway.
- Other narrow real surfaces: `src/app/api/guest-chat/[token]/*` (token-based guest chat),
  `src/app/api/partner/[token]/route.ts`, `src/app/api/public/portal/[orgSlug]/*`
  (public ticket/KB routes) -- each real and purpose-specific, none a documented universal
  intent-submission gateway.

## 5. Canonical intent object / shared intent-resolution layer / "hidden runtime"

**Verdict: NOT FOUND -- confirmed real gap, not an undocumented existing mechanism.**

Repo-wide search (`src/`, `ai-os/`, root docs) for `canonical intent object`, `IntentObject`,
`intent resolution`, `hidden runtime`, `universal input`/`universal runtime`: zero real
matches in product code or architecture docs. The only near-hits:

- `Study_by_Claude.md:469` -- a section heading in a benchmark/gap-analysis comparison
  document ("Intent Resolution Pipeline & Intent Learning Loop"), describing an external
  CSV benchmark's wishlist item, not anything implemented in this repo.
- `ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19.md:206` -- uses "intent resolution" in the
  ordinary-English sense describing PROJEXA Copilot's `dispatchTool()`
  (`task-execution-engine.ts:90`), a fixed-`codeReference` tool dispatcher (checked directly:
  it takes a specific `codeReference` string per capability-tree node, not an arbitrary
  free-form intent) -- not a general-purpose intake normalizer either.

**Conclusion:** there is no shared/canonical intent-resolution layer in this codebase
today. Each of the four intake surfaces mapped above resolves independently to a different
backend shape:

| Surface | Resolves to | Resolved by |
|---|---|---|
| Chain Selector / mode pill | `{modePill, pathKeys}` | `resolveDynamicChainId()` (`task-service.ts`) |
| Free chat | LLM reply via `generateAiReply()` | `chat-service.ts` + `resolveModelConfig()` |
| Voice tickets | transcript + AI-suggested fields | `voice-ticket-service.ts` |
| Share-target / guest-chat / partner-portal | each its own shape | own per-surface service function |

There is no single point where these four converge into one canonical object before
downstream processing. Building one (a real "universal input runtime" / canonical intent
object) is unbuilt work, not a hidden-but-existing mechanism -- tracked as
`GAP-OCID-061-NO-CANONICAL-INTENT-OBJECT` in `ai-os/MASTER-TRACKER.yaml`.

## Next step

This dispatch authorized discovery/mapping only. Real implementation of a shared
intent-resolution layer requires a fresh PM decision with its own real success criteria,
once OCID-061's full (currently truncated) prompt arrives.
