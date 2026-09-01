# Documentation Standards

**R46 P9 seq36** (platform.r43_queue, ref H.5). R-43 H.5 asked for a real
JSDoc / file-header / CHANGELOG standard; none existed as a written
standard anywhere in this repo before this file. **Scope, stated up front
exactly as the work order requires**: this standard applies to files
*created or materially changed* going forward, starting with R46 P9 (this
run). It is **not** a mandate to retrofit the existing ~264k-line codebase
— that is a separate, multi-session job with no user-visible value on its
own (v5 P-1's over-engineering warning applies directly here), and this
document does not claim otherwise anywhere below.

## 1. File header comment

Every file *created* in a queue-tracked run gets a header comment (the
existing convention this repo already uses informally — e.g.
`src/lib/segmentation/pipeline.ts`'s own header, `src/lib/ai/batch/analyse.ts`'s
own header — made explicit here rather than invented fresh) stating:

1. **Which run/seq created it** — e.g. `// R46 P9 seq33 (M26 P6) -- ...`.
2. **What it's for**, in one to three sentences — the *why*, not a restatement of the filename.
3. **Any real constraint or gotcha** a future reader needs before touching it (an
   authorization citation, a guardrail it must not weaken, a subtlety the code
   alone doesn't make obvious).

A file *materially changed* (not just a one-line fix) gets a comment at the
changed section citing the run/seq that changed it and why, in the same
style already used throughout this codebase's real history (see any file
under `src/lib/services/` for hundreds of real examples of this exact
pattern already in production use — this standard formalises an existing
norm, it does not invent a new one).

**Example, from this run** (`src/lib/ai/batch/analyse.ts`, R46 P9 seq33):
```ts
// R46 P9 seq33: report_definition artifacts now become real, immediately
// runnable rows (compliance.report_definitions) via this existing service --
// previously they only reached otherArtifacts (this file's return value),
// which the cron route (l2-phrase-promotion/run/route.ts) just serialised
// into a JSON response and discarded. ...
```

## 2. JSDoc on every exported function

Every function a *new or materially-changed* file exports gets a JSDoc
comment covering:
- **Purpose** — one line, what it does (not how).
- **Params** — only when a param's meaning isn't obvious from its name/type
  (a plain `orgId: string` needs no comment; a param whose valid values or
  side effects aren't obvious from the signature does).
- **Returns** — what the return value means, especially for a nullable/union
  return where the caller must branch on it.
- **Throws** — when the function can throw rather than return an error
  value, and under what condition.

This repo already uses inline `//` comments extensively for this purpose
(see `report-engine-service.ts`'s `CreateReportDefinitionInput` block, or
`analyse.ts`'s own `toReportDefinitionInput()` for a real, current example)
— a real `/** */` JSDoc block is preferred for new exported functions going
forward so IDE tooltips pick it up, but an equally thorough `//` block
immediately above the export satisfies this standard; the content bar is
the same either way, not the comment syntax.

**Example, from this run** (`analyse.ts`'s `toReportDefinitionInput`):
```ts
// A report_definition artifact's `definition` field is model output (free-
// form JSON), so this is a defensive mapper, not a trust boundary widening:
// createReportDefinition() below still runs validateReportDefinitionInput
// (M26/M27's own validation), ...
export function toReportDefinitionInput(
  artifact: Extract<Artifact, { kind: "report_definition" }>,
  promotedFromContext: string
): CreateReportDefinitionInput | null { ... }
```

## 3. CHANGELOG.md

Each repo (`compliance-tracker`, `projexa`) gets a root `CHANGELOG.md`,
newest entry first, grouped by queue seq, one line per change:

```
## R<run> P<phase> seq<N> -- <one-line summary> (PR #<number>, <date>)
```

**Real, current scope of the CHANGELOG files this PR creates**: seeded from
R46 P9 forward (2026-08-24/25), the first point either repo had a written
CHANGELOG at all — not a reconstruction of every PR in this codebase's
history. See each repo's own `CHANGELOG.md` header for the same scope note
restated there.

## Why this scope, not a full retrofit

R-43 H.5's own text authorises exactly this scope ("Apply to code written in
THIS run only. Do not retrofit 264k lines... Scope: files touched by R43").
Retrofitting the existing codebase would touch thousands of files with zero
functional change and real risk of drive-by errors in files nobody is
actively reviewing right now — the over-engineering v5 P-1 warns against.
This standard is written so the NEXT run can extend the CHANGELOG and keep
applying the header/JSDoc bar to whatever it touches, without ever implying
the bar was retroactively met everywhere.
