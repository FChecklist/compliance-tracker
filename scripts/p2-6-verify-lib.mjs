// Pure, side-effect-free logic extracted out of
// scripts/p2-6-post-apply-verify.mjs so it can be imported by
// scripts/p2-6-post-apply-verify.test.ts (D58 falsification: this must be
// shown to fail on a planted bad case AND pass on a known-good case)
// WITHOUT that import also executing the live script's top-level DB calls.
// The .mjs verify script itself is a run-once-by-hand script with real
// side effects at module-load time, not an importable library -- this file
// is the importable part split out of it.
export function allChecksOk(results) {
  return Boolean(results?.v2_insert?.ok && results?.v2_update?.ok && results?.v3_read?.ok)
}
