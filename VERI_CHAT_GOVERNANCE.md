# VERI Chat Governance

**Version 1.0 -- 2026-07-11. VERI's identity, its relationship to VERI Chat, and the VERI-Assisted Communication Protocol.**

Adopted from "VERI AI and VERI Chat.docx". Same discipline as sibling documents: **[ENFORCED]**/**[PARTIALLY ENFORCED]**/**[POLICY ONLY]**/**[NOT APPLICABLE YET]**, cited by file:line.

## The naming question -- resolved by checking history, not guessing

The source document proposes: VERI Chat is the enterprise communication platform; VERI ("VERI -- Your Assistant") is one participant within it, never the platform itself.

**Wave 37 already drew this exact line, in the opposite direction**, confirmed directly in code comments:
- `AppSidebar.tsx`: *"Wave 37 splits the single 'VERI Chat' link into its two sub-modules -- VERI AI (user &lt;-&gt; system) and VERI Chat (user &lt;-&gt; people, enterprise Slack/WhatsApp-style)."*
- `chat/page.tsx`: *"VERI Chat is now human/guest chat only -- the AI thread has its own dedicated surface at /veri-ai."*

Today: **"VERI Chat" = the human/guest multi-party messaging surface, and explicitly excludes VERI.** "VERI"/"VERI AI" = the assistant's own separate 1:1 thread, already using the exact welcome copy the new document asks for (`chat-service.ts`: *"I'm **VERI**, your assistant, reporting for work"*).

**Resolution (matches `VERIDIAN_DMP_DCF_CONSTITUTION.md`'s Decision 1)**: not a rename, not a reversal. VERI becomes an **invitable participant** in `conversations` of `type: 'group'` -- additive capability layered onto the existing multi-party messaging surface, which already supports real per-user attribution (`conversationParticipants`, `messages.senderId`) and external guest access. The dedicated 1:1 VERI AI thread is untouched -- it remains the default, always-available surface; group-conversation participation is opt-in per conversation, not a replacement.

## 1. VERI -- Your Assistant: Official System Identity

**[ENFORCED]** -- the "VERI -- Your Assistant" framing and welcome copy already exist in `chat-service.ts`. No change needed for the identity/naming itself.

## 2. VERI Chat: Official System Identity (multi-party platform)

**[ENFORCED, for humans; NEW this wave, for VERI's participation]** -- `conversations`/`messages`/`conversationParticipants` (schema.ts) already implement real multi-party chat: `type: 'group'` conversations, per-user `senderId` attribution, `guestAccessId` for authorized external participants. This is a genuinely mature, shipped platform -- not built from scratch here.

**What ships this wave**: `POST /api/conversations/[id]/invite-veri` (or equivalent) adds VERI as a recognized participant on a group conversation (a sentinel row/flag, not a fake `users` row -- reusing the existing `senderId: null` = "VERIDIAN AI" convention already used consistently across `messages`/`taskChatMessages`/`ai_assistants`). Once invited, VERI's involvement in that conversation follows the read/summarize/recommend permissions below -- it does not silently start generating replies to every message the way the 1:1 thread does.

## 3. VERI's Role Within VERI Chat (read, summarize, recommend -- never auto-act)

**[POLICY ONLY -> PARTIALLY ENFORCED, this wave]** -- prior to this wave, VERI had no role in multi-party conversations at all (architecturally excluded, per Wave 37). This wave wires the narrow, safe slice: once invited to a conversation, VERI can read messages (subject to the same RLS/permission checks every participant is subject to) and, on request, summarize or identify action items -- reusing `generateAiReply()`'s existing LLM-call machinery, `policy-enforcement-engine.ts`'s existing gate, and `structured-message.ts`'s existing (previously unconsumed) `summary` message type as the output shape. **Not shipped this wave**: proactive/unprompted participation (VERI jumping into a conversation without being asked), and the fuller "identify deadlines/recommend workflows/detect commitments" list -- those require the AI to reason over an entire conversation's history proactively, a materially bigger and riskier scope than "answer when addressed," and are tracked, not attempted alongside everything else in this wave.

## 4. VERI shall never auto-create/assign/send without approval

**[ENFORCED]** -- this is not new. `high-impact-action-detector.ts` + the confirmation gate already block auto-execution of high-impact actions; `ai-reply-gate.ts` (Phase 3) already blocks VERI from *claiming* it completed an action it didn't. What's genuinely new in this document is the **richness of the approval menu** -- see "VERI-Assisted Communication Protocol" below, which is the real, concrete, buildable piece of this document.

## 5. Dynamic Mode Pill & Dynamic Chain Requirement for new conversations

**[POLICY ONLY]** -- no conversation-creation flow currently requires a chain selection first. `conversations.contextEntityType`/`contextEntityId` is the closest existing building block (a conversation can already point at a project/policy/pms_issue), but nothing requires it, and nothing currently offers a 2-level Chain Selector before a new conversation starts. Deferred alongside the DMP-DCF's broader "no activity without a chain" rollout (`VERIDIAN_DMP_DCF_CONSTITUTION.md`, "Rollout scope") -- adding a mandatory pre-conversation gate is a real UX change to a live, actively-used messaging surface and deserves its own scoped wave with its own verification, not a rushed addition alongside everything else here.

---

## VERI-Assisted Communication Protocol -- the concrete, buildable piece of this document

The source document's real, novel, valuable ask is the approval-option richness: Approve Once / Edit & Approve / Reject / Approve Similar Communications / Approve for This Conversation / Approve for This Task / Approve for This Workflow / Always Approve for This Communication Type / Cancel -- plus quick shortcuts (Yes / Yes to All / Approve All for Task / Always Approve / No / Not Now / Review Before Sending) -- plus persistent, user-controlled, revocable approval preferences.

**[NOT APPLICABLE YET -> ENFORCED, this wave]** -- confirmed by direct grep before writing anything: zero existing "approval preference," "remember my choice," or "always approve" mechanism exists anywhere in this codebase. Today's confirmation dialog (`VeriComposer.tsx`) offers exactly two options, Confirm/Cancel, decided fresh every single time with no persistence. This is a real, concrete gap, not an exaggeration.

**What ships**: a new `approval_preferences` table (org/user-scoped, `scopeType`: `'communication_type' | 'conversation' | 'task' | 'workflow'`, `scopeId` nullable for type-level preferences, `actionCategory` reusing `high-impact-action-detector.ts`'s existing 9 categories, `decision`: `'always_approve' | 'always_reject'`, revocable) + an extended confirmation dialog offering the real menu instead of binary Confirm/Cancel, checking `approval_preferences` first (skip the dialog entirely if a matching, still-valid preference exists) before falling back to asking. **Not shipped this wave**: the full communication-type catalog (task updates/MoM/customer updates/vendor communications/etc., §"Assisted Communication Capabilities" in the source doc) as distinct dispatchable message types -- that's a content/workflow-authoring exercise for each communication type, this wave ships the underlying approval *mechanism* every one of those types would eventually use.

## Mandatory Governance Rules (never impersonate, never modify intent, never send unauthorized, always traceable)

**[ENFORCED]** -- covered by existing infrastructure: RLS + `requireAuth()` prevent unauthorized-recipient sends structurally; `audit_logs`/`orchestraExecutions` already make every AI-initiated action traceable; `policy-enforcement-engine.ts` already blocks prompt-injection attempts to make VERI act outside its authorized scope. No new mechanism needed -- this section of the source document describes guarantees this codebase already has for other reasons.

## How this differs from the source document

Adopted: the approval-menu richness and persistent-preference concept (genuinely new, genuinely valuable, genuinely absent -- built this wave), the governance-rules list (already true, reused rather than reproven).

Corrected: VERI's participation in VERI Chat is additive to Wave 37's real prior decision, not a silent reversal of it, and scoped narrowly (read/summarize on invitation, not proactive/unprompted participation) rather than the document's fuller list, which is tracked as follow-on work. The mandatory pre-conversation Dynamic Chain gate is deferred, not built alongside a live messaging surface's other changes without its own dedicated verification pass.
