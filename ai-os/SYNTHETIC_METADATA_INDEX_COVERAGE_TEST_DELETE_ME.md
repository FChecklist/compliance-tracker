# Synthetic Test File -- DELETE ME

This file exists ONLY to intentionally trigger a real failure of the
Metadata Index Coverage Check as a live synthetic test of branch
protection (`UMR-20260805-033159-4f47` corrective-action verification,
2026-08-05). It is a new top-level file directly under `ai-os/` that is
deliberately NOT registered in `ai-os/OS.yaml`'s `index`/`exempted` lists,
which the check requires.

This PR is intentionally never merged -- it exists to prove the merge
button is genuinely blocked while this check fails, then gets closed.
