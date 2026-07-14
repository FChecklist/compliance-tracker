// Prompt & Cache Management Framework, Phase 1 (2026-07-14). Deterministic
// SHA-256 over a static prompt prefix -- used to detect when a "static"
// layer has actually changed (a template edit, a version bump), not to
// implement caching itself. The actual cache lives on the provider's side
// (Anthropic's cache_control breakpoint); this fingerprint is metadata for
// recordPromptCacheMetric() to group calls by, so "did this fingerprint's
// hit rate change" is a real question someone can ask later.
import { createHash } from "node:crypto";

export function computeFingerprint(staticPrefix: string): string {
  return createHash("sha256").update(staticPrefix, "utf8").digest("hex");
}
