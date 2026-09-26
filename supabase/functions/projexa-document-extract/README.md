# projexa-document-extract (PROJEXA-BUILD-001 U-36, E-13)

The extraction worker of "create a project and its BOQ from an uploaded workbook". The compliance-tracker route `POST /api/v1/projexa/projects/from-document` reads the workbook, turns every sheet into a small JSON digest and posts it here. This function is the only place a model is called for that path, so no Vercel function is billed for the model work (E-13). It returns the model's JSON. It does not judge that JSON: the caller validates it against the target schema (`src/lib/services/document-extraction-schema.ts`) before anything is created.

**No model is configured.** The owner has not named a provider (register row BR-509), so `index.ts` passes `model: null` and every authenticated call answers `503 model_not_configured`. Nothing else has to change to switch one on: replace `null` with a function that takes `{system, user, maxOutputChars, signal}` and returns the model's reply text.

## Request

`POST /functions/v1/projexa-document-extract` with `Authorization: Bearer <PROJEXA_DOCUMENT_EXTRACT_SECRET>` and a JSON body:

```json
{ "schema": "boq_project_v1", "fileName": "villa.xlsx",
  "sheets": [ { "name": "Civil", "rows": [ { "row": 4, "cells": ["1.01", "Excavation", "m3", "100", "250"] } ] } ] }
```

Rows carry their real 1-based worksheet row number (blank rows are left out). Cells are text with control, zero-width, bidirectional-control and Unicode tag characters already removed.

| Answer | When |
| --- | --- |
| 200 `{"ok":true,"schema":"boq_project_v1","output":<JSON>}` | the model replied with JSON (bare, or inside one code fence) within the output ceiling |
| 400 `bad_request` / `unknown_schema` | the body is not the shape above, or names another schema |
| 401 `{"ok":false,"code":"unauthorized"}` | no bearer, or a wrong one, or the secret is not set; always the same body |
| 405 `method_not_allowed` | any method but POST |
| 413 `input_too_large` | the body is over `maxRequestChars` (200 000) |
| 502 `model_error` / `model_output_too_large` / `model_output_not_json` | the provider failed (its message is never returned), the reply is over `maxOutputChars` (80 000), or the reply is not JSON |
| 503 `model_not_configured` | no model is wired (today: always, for an authenticated caller) |

Every response carries `Cache-Control: no-store`. No CORS headers are sent: the caller is a server, not a browser.

## Ceilings (COST_BUDGET.csv X-02)

`maxRequestChars` 200 000 and `maxOutputChars` 80 000 are enforced here and are the same numbers `document-extraction-schema.ts` uses (`EDGE_REQUEST_MAX_CHARS`, `EDGE_OUTPUT_MAX_CHARS`); `src/lib/services/projexa-document-extract.test.ts` holds the two equal. A request or a reply over its ceiling is refused, not cut short. The per-call money ceiling for the model is the owner's to set together with the provider (BR-509); until a provider exists the ceiling in COST_BUDGET.csv is 0.00, so any real call would be a violation.

## Security model

- The caller is the compliance-tracker server. `verifyCaller` is a constant-time comparison of the bearer against the function secret `PROJEXA_DOCUMENT_EXTRACT_SECRET`; a secret shorter than 32 characters, or unset, refuses every caller (an unconfigured deploy is closed).
- The document is data. It only ever appears inside the JSON of the user message, after a fixed lead line; the system prompt holds no document text and says that text inside the data is never an instruction. JSON encoding escapes quotes and line breaks, so a cell cannot end the data block.
- The model's answer is untrusted. The caller checks it against an exact schema and against the uploaded file's own rows before any write.
- Nothing about the document, the bearer or the model reply is logged: log lines carry an outcome and a status only.
- The function holds no database client and no Supabase key. It reads no table and writes nothing.

## Files

- `handler.ts`: the request handler, with `verifyCaller`, the model and the limits passed in. It has no import, so it runs under Deno and under bun unchanged. Run by `src/lib/services/projexa-document-extract.test.ts`.
- `index.ts`: `Deno.serve` and the environment (the secret), and `model: null`. Nothing else.

## Secrets

`PROJEXA_DOCUMENT_EXTRACT_SECRET`: at least 32 random characters. Set it as a function secret and as the same-named server environment variable of the caller (the compliance-tracker deployment). Not set anywhere yet. The caller also reads `NEXT_PUBLIC_SUPABASE_URL` (the project URL, already set) to build the function URL.

## Deploy

Not deployed. Deploy with `verify_jwt` **false**: the function does its own bearer check, and the caller sends the shared secret, not a Supabase JWT, so with `verify_jwt` on the platform would refuse the call before the handler sees it. The PM deploys through the Supabase MCP after the claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` is on `main`. No provider and no secret exist yet, so a deploy today answers 401 to everyone until the secret is set.

## Check it worked

With the secret set and no model wired: a call with the bearer answers `503 {"ok":false,"code":"model_not_configured"}`; a call without it answers `401`. Once a provider is wired (BR-509), the from-document route's own test (`src/app/api/v1/projexa/projects/from-document/route.test.ts`) shows the contract the function must keep.
