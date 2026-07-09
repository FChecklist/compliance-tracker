# Follow-ups

Tracked deferrals from completed waves that are deliberate, not forgotten.
Each item names the wave that deferred it, why, and what "done" looks like.
Remove an item once it's picked up as a real wave (reference the wave here first).

## FOLLOWUP-1: Retrofit `high-impact-action-detector.ts` through the Guardrail Engine

- **Deferred by:** Wave 157 (`src/lib/guardrail-engine.ts`)
- **Why deferred:** `high-impact-action-detector.ts` is an already-audited, working safety gate (Wave 146). Refactoring it mid-wave to route through the new opt-in Guardrail Engine, purely to give the new framework a consumer, would change a live safety mechanism's execution path for zero functional gain. See `AUDIT_wave157_claude_items.md` section 5 for the full reasoning (auditor agreed the deferral is correct, on the condition it's tracked here rather than left as a comment-only promise).
- **What "done" looks like:** register each of `high-impact-action-detector.ts`'s existing categories (`delete`, `archive`, `payment`, `approval`, `rejection`, `compliance_submission`, `access_changes`, `data_export`, `configuration_changes`) as `registerGuardrail(leafKey, { phase: "process", check: ... })` calls, one per category, with behavior-preserving tests proving the detector's existing output is unchanged before/after the retrofit. Should ship as its own wave with its own audit, not bundled into unrelated work.
