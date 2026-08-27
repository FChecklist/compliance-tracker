# CRR file allowlist

CRR-015. This file is the frozen list of paths the CRR (Capture / Recall /
Reuse, R-70) project is permitted to modify. Do not create new API routes or
touch new files outside this list without adding a numbered point to
`platform.crr_spec` first (CRR-015's own rule). This file is append-only in
spirit: extend it when a later CRR phase genuinely needs a new path, don't
silently work outside it.

Derived from the real, verified touchpoints found while executing P1-DEFECT
(CRR-016 through CRR-035) plus the two files the original CRR brief named
directly (the extraction route and its service).

## Core embedding/retrieval pipeline

- `src/lib/embeddings.ts` — storeEmbedding/findSimilar, the one entity-agnostic
  embeddings primitive every consumer below calls.
- `src/lib/services/document-extraction-service.ts` — the real (non-placeholder)
  extraction implementation; CRR-076 (P3-BRIDGE) wires it to storeEmbedding.
- `src/app/api/documents/extract/route.ts` — CRR-034/035: deleted the dead
  PDF-placeholder branch, collapsing to a thin wrapper over the service above.
- `src/lib/db/schema.ts` — Drizzle schema; CRR-041+ (P2-SCHEMA) adds the
  `document_chunk` table here.

## Capability Registry callers of storeEmbedding/findSimilar (CRR-018/019 fixed all of these)

- `src/lib/services/capability-registry-service.ts`
- `src/lib/services/capability-backfill-service.ts`
- `src/lib/loops/capability-index-freshness-audit.ts`
- `src/lib/services/asset-vector-search-service.ts`
- `src/lib/services/worker-agent-service.ts`
- `src/lib/prompt-compiler/prompt-similarity.ts`

## Recall surface

- `src/app/api/search/semantic/route.ts` — the one real caller of
  `findSimilar` outside the Capability Registry; P6-RECALL builds the
  cheapest-first ladder on top of this.
- `src/lib/services/knowledge-base-service.ts` — referenced from embeddings.ts
  as a storeEmbedding call site; in scope for P6/P7 recall+reuse work.

## Project scaffolding

- `CRR_FILES.md` — this file.

13 files, all verified real touchpoints as of 2026-08-25 (P1-DEFECT close).
