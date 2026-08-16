// Prompt & Cache Management Framework, Phase 1 (2026-07-14).
//
// Deliberately thin: VERI Chat's real system prompt is already assembled
// by resolvePromptTemplate() + a single {{PURPOSE_CLAUSE}} substitution
// (chat-service.ts's generateAiReply) -- this module does not replace that
// resolution, it wraps the RESULT with a fingerprint so call sites can
// group/measure cache outcomes by which exact static-prefix version was
// sent, without re-deriving the assembly logic in a second place.
import { computeFingerprint } from "./fingerprint";

export type CompiledStaticPrefix = {
  staticPrefix: string;
  fingerprint: string;
};

// Takes the FINAL, already-substituted system prompt string (what
// generateAiReply already builds today) and returns it alongside its
// fingerprint. Pure and deterministic: the same string always produces the
// same fingerprint, which is the one property this whole framework depends
// on (see the framework's requirements doc, §6 "Determinism").
export function compileStaticPrefix(staticPrefix: string): CompiledStaticPrefix {
  return { staticPrefix, fingerprint: computeFingerprint(staticPrefix) };
}
