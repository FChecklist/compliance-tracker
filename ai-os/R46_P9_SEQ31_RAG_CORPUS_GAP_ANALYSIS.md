# R-46 P9 seq31 — RAG Corpus Real-State Audit (2026-08-25)

**Ref:** R-43 D.1 | **Queue row:** `platform.r43_queue` seq 31 (`depends_on: 30`)
**Verdict: PENDING — the specified table does not exist.** A different,
real, DERIVED embedding store exists for a different purpose (capability
retrieval, not a user-utterance corpus). Real source data for building the
real thing is smaller than the queue row's own estimate assumed. This
report is the honest, precise inventory the row asks for in place of either
inventing 1000 rows or fabricating a 150-row table with synthetic content.

## What R-43 D.1 asked for

`platform.rag_corpus(id, user_input, provenance, provenance_ref, category,
mode_pill, option, browser_action, server_action, ai_level, input_schema,
output_schema, guardrails)` — ~150 rows, every row citing a real source,
built from: one per real `function_id` in the registry (~80 estimated) |
one per real Sumeet requirement phrased as a user would say it (69
estimated) | the M25/M30 segmentation fixtures (~50 estimated) | every real
row already in `gap_log`.

## Real current state

**`platform.rag_corpus` does not exist.** Checked via
`information_schema.tables` for `platform`/`compliance` — no table by that
name, or matching that shape, anywhere in either schema.

### What DOES exist: `compliance.embeddings` (143 rows) — a different system
Columns: `id, entity_type, entity_id, content, content_hash, org_id,
created_at, embedding` (pgvector). Row breakdown by `entity_type`:

| entity_type | count |
|---|---|
| module | 110 |
| worker_agent | 27 |
| task | 5 |
| dynamic_chain | 1 |
| **total** | **143** |

Verified the 110 `module` rows are genuinely derived: `content` is each
row's own tool/capability description text, and the count exactly matches
`platform.module_registry`'s own row count (110, confirmed by direct
`count(*)`). The 27 `worker_agent` rows are similarly the AI Dev Team
roster's own capability descriptions (sample content: "Create Compliance
Item | Cross-Cutting > Data Access | Create a new compliance item. |
Input: {...}"). **This is real, wired, DERIVED-from-source infrastructure —
not fabricated.** But its purpose is semantic retrieval over the
*capability registry itself* (which tool/module is relevant to a query),
not the R-43 D.1 corpus (real or realistic *user phrasings* mapped to a
function_id/browser_action/server_action/ai_level, with guardrails
attached, for testing/tuning L0+L1 hit rates). Different shape, different
job. Building D.1's corpus is not "extend this table" — it needs its own
table with its own columns, per the spec.

### Real source inventory for building the real ~150-row corpus

| Source | Spec estimate | Real count found | Note |
|---|---|---|---|
| Registry `function_id`s | ~80 | **110** (`platform.module_registry`) | more real rows available than estimated |
| Sumeet requirements | ~69 | **16** (`platform.sumeet_coverage`) | far short of estimate — verified via direct `count(*)`, columns `id, module, requirement, serving_tables, table_rows, serving_ui, verdict, gap, spec_refs, updated_at` |
| M25/M30 segmentation fixtures | ~50 | **21** test cases in `src/lib/segmentation/segment.test.ts` (plus more in `classify.test.ts`/`validate.test.ts`/`executor.test.ts`, not yet tallied) | real, but not yet counted precisely across all 4 test files |
| `gap_log` rows | (unbounded, real usage) | **0** | confirmed empty via direct `count(*)` — zero real production/test traffic has hit the gap-log path yet, consistent with "zero customers, one tester" per this row's own gap note |

**Total real, provenanced rows available today: on the order of 110 + 16 +
21(+more) + 0 ≈ 147+, before dedup** — genuinely close to the ~150 target
the row asks for, which is reassuring: the number is achievable from real
data, this was not an unfounded estimate. But two things are not yet done:
(1) the actual `rag_corpus` table + migration does not exist, and (2) the
transformation step — turning a `module_registry` row's tool description
into "one row phrased as a user would say it," and a `sumeet_coverage`
requirement into the same — is itself real work (a mechanical rephrasing
pass per row, ideally reviewed, not a blind LLM bulk-generate that would
reintroduce exactly the "invented corpus" problem this row explicitly warns
against).

### L0/L1 hit-rate test oracle
Not run — there is no corpus yet to run it against. This is the seq's own
`test_oracle` requirement ("run the corpus through L0+L1 and report
l0_hit_rate, l1_success_rate...") and cannot honestly be reported without
the corpus existing first.

## Why this is reported, not built in this pass

Building `platform.rag_corpus` for real means: (1) a migration, (2) a real
transformation of 110 module rows + 16 sumeet rows + the segmentation test
fixtures into `user_input` phrasings with correct `provenance`/
`provenance_ref` citations — genuinely reviewing each one so the corpus
means something, not a mechanical LLM bulk-generate that would produce the
exact "looks like coverage, encodes nobody's behaviour" failure mode this
queue row itself was written to prevent, and (3) then actually running it
through L0+L1 and reporting real hit rates. That is real, multi-hour
content-authoring + wiring work, not a query-backed record achievable
inside this audit pass alongside seq30/seq32. Fabricating either the count
or the hit-rate numbers here would be exactly the false-DONE this task was
told not to produce.

## Scoped estimate for closing the gap

- Migration for `platform.rag_corpus` (the 13 columns per spec): ~30 min.
- Transform + review 110 module_registry rows into user-phrased entries
  with `provenance='module_registry'`, `provenance_ref=<module id>`: ~3-4
  hours for a real, non-mechanical pass (roughly 2 min/row reviewed).
- Transform + review 16 sumeet_coverage rows similarly: ~30-45 min.
- Pull the ~21+ segmentation test fixtures across all 4 test files, tally
  the real total, and adapt into corpus rows with `provenance='test_fixture'`: ~1 hour.
- `gap_log` source stays at 0 rows until real usage happens — not
  something this pass or any authoring pass can manufacture honestly.
- Run the assembled corpus through `classifyL0`/`provider.classify` and
  report real `l0_hit_rate`/`l1_success_rate`: ~1 hour once the corpus exists.

Total: roughly 1 real engineer-day, and it depends on seq30's guardrails
being real first per this row's own `depends_on: 30` — validating candidate
functions against a corpus that hasn't been hallucination-guarded yet would
produce hit-rate numbers that don't mean what they'd appear to mean.

## What this PR does and does not do

Does: add this one documentation file, with real counts pulled via
Supabase MCP `execute_sql` against `pcrjmlpuqsbocqfwoxod`
(platform/compliance schemas) on 2026-08-25. Does not: create
`platform.rag_corpus`, touch any runtime code, or run any migration.
