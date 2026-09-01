# 0001: All chat-completion AI calls go through one client module

- Status: Accepted (already in effect; documented retroactively 2026-08-15)
- Related: VERIDIAN Review Framework, Architecture & Design / Engineering
  Principles, "Systems-First Engineering Principle" finding.

## Context

This codebase calls out to LLM providers (Groq, Cerebras, OpenRouter,
Anthropic) from many features: the AI Dev Team roster, chat, ticket/email
intelligence, meeting summaries, task orchestration, and more. Each of
those call sites needs the same underlying concerns handled correctly:
model/provider selection and failover, cost tracking against the Token
Usage Ledger, prompt-cache wiring, and JSON-mode/vision variants. If each
feature implemented its own `fetch()` to a provider, those concerns would
have to be reimplemented (or, more realistically, half-implemented)
independently at every call site -- and a fix to one (e.g. a cost-guard
change, or a new provider fallback) would not automatically apply
everywhere.

## Decision

Every chat-completion-shaped AI call goes through `src/lib/llm-client.ts`
(`callLLM` / `callLLMJson` / `callLLMVision`), and provider/model
selection for the three real orchestra layers (`task_oa`,
`user_assistant_oa`, `customer_account_oa`) goes through
`src/lib/orchestra-model-resolver.ts`, which itself calls `callLLM` --
it does not talk to providers directly. Nothing else in `src/` is allowed
to `fetch()` a chat-completion endpoint directly.

Embeddings (`src/lib/embeddings.ts`) and audio transcription
(`src/lib/whisper-client.ts`) are a different call shape (not
chat-completion turns, no cost-guard/JSON-mode/prompt-cache concerns in
the same form) and are intentionally kept as their own thin clients rather
than forced through `callLLM`'s chat-shaped interface.

## First-principles rationale

The actual constraint is: whatever handles cost accounting, provider
fallback, and prompt caching needs to see *every* real call, or the system
built around those concerns (the Token Usage Ledger, the cost-guard cap,
the floor-tier-escalation policy in `orchestra-model-resolver.ts`) is only
partially true. A single required entry point is the only way to make
that guarantee mechanically, rather than relying on every future call site
remembering to opt in. This is "systems-first" in the literal sense: the
system-level guarantee (accurate cost tracking, consistent failover) is
designed before any individual feature's call site is written, and every
call site is required to compose with it rather than reimplement it.

## Consequences

- A cost-guard or failover-policy change made once in `llm-client.ts` /
  `orchestra-model-resolver.ts` is correct everywhere, by construction --
  no per-feature audit needed.
- New chat-completion features have one obvious, minimal integration
  point (`callLLM`/`callLLMJson`/`callLLMVision`), not a decision to make
  from scratch.
- Audited 2026-08-15 (see `progress/task-20260718-075002-architecture---
  design--engineering-princ.md`): confirmed via `git grep` for direct
  provider-fetch usage that this is still true today -- the only files
  with real fetch calls to a provider are `llm-client.ts` itself,
  `orchestra-model-resolver.ts` (routes through `callLLM`), and the two
  intentionally-separate embeddings/transcription clients. Zero
  chat-completion call sites bypass the central module.
- Does not cover: embeddings and transcription cost/usage tracking, which
  are out of scope for this ADR and tracked separately if/when they need
  the same cost-guard treatment chat completions already get.
