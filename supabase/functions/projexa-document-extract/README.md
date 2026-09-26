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
| 400 `attribution_required` | the request does not name its organisation and user (see Spend cap) |
| 402 `budget_exhausted` | the recorded spend for this feature has reached the cap, or this call would carry it over (see Spend cap) |
| 413 `input_too_large` | the body is over `maxRequestChars` (200 000) |
| 502 `model_error` / `model_output_too_large` / `model_output_not_json` | the provider failed (its message is never returned), the reply is over `maxOutputChars` (80 000), or the reply is not JSON |
| 503 `model_not_configured` | no model is wired (today: always, for an authenticated caller) |
| 503 `budget_not_configured` / `budget_ledger_unavailable` / `model_price_unknown` | a model is wired but no budget is, the usage ledger cannot be read or written, or the model has no price: refused, never allowed (see Spend cap) |

Every response carries `Cache-Control: no-store`. No CORS headers are sent: the caller is a server, not a browser.

## Ceilings (COST_BUDGET.csv X-02)

`maxRequestChars` 200 000 and `maxOutputChars` 80 000 are enforced here and are the same numbers `document-extraction-schema.ts` uses (`EDGE_REQUEST_MAX_CHARS`, `EDGE_OUTPUT_MAX_CHARS`); `src/lib/services/projexa-document-extract.test.ts` holds the two equal. A request or a reply over its ceiling is refused, not cut short. The per-call money ceiling for the model is the owner's to set together with the provider (BR-509); until a provider exists the ceiling in COST_BUDGET.csv is 0.00, so any real call would be a violation.

## Spend cap (U-36b, register row BR-526, PMD-43, PMD-40)

Every model call is metered in the usage ledger, and no call is made once the recorded spend for this feature has reached the cap. Nothing here is switched on yet: the function has no model and no ledger connection (`index.ts` passes `model: null` and `budget: null`), and the handler refuses every call of a model that has no budget, so wiring a model alone cannot spend.

- **Cap**: 1.00 USD of estimated spend, from the environment variable `PROJEXA_EXTRACT_BUDGET_CAP_USD` (read through `parseCapUsd`, which returns 1.00 when the variable is unset or blank and 0, refusing every call, when it is not a plain non-negative number). The owner extends it by changing that value.
- **Refusal**: HTTP 402 with `{"ok":false,"code":"budget_exhausted"}`, answered before the model is called, when the recorded total has reached the cap, or when the total plus this call's estimate would be over it. A call that lands exactly on the cap is allowed; the next is refused. 402 is used because the error table has no quota status of its own and the call is refused for money, not for rate.
- **Estimate**: the input (system prompt plus user message) at 2 characters per token and the whole output ceiling (80 000 characters) at 2 characters per token, priced from the price table. It is an upper bound on purpose. The table is configuration (`DEFAULT_PRICE_TABLE`, or one passed in): a change of model is a new entry, not a code change. It holds the Groq floor-tier model `openai/gpt-oss-120b`; a test keeps it equal to `MODEL_PRICING` in `src/lib/llm-client.ts`.
- **Ledger rows**: one row per call in `compliance.token_usage_ledger`, the ledger the platform already uses for AI spend (no new table): `org_id`, `user_id`, `task_id` = the request id, `layer_key` = `projexa_document_extract`, `provider`, `model`, `prompt_tokens`, `completion_tokens`, `estimated_cost_usd`, `success`, `failure_reason`. The row is written before the call with the estimate and rewritten after it with the tokens the model returned and the cost computed from those tokens. When the model returns no counts the estimate stays and the row is flagged estimated. A call that fails keeps its estimate (the provider may have billed it). The cap is applied to the sum of `estimated_cost_usd` of the rows of the feature, per platform, and the same rows give the total per organisation and per user.
- **Who a call is for**: the caller sends `x-projexa-org-id`, `x-projexa-user-id` and optionally `x-projexa-request-id` (the caller is authenticated by the shared secret, so it is trusted to name them). A request without an organisation and user is 400 `attribution_required`. `attributionFromHeaders` in `budget.ts` reads them.
- **Fail closed**: a ledger that cannot be read or take the row, a total that is not a number, or a model with no price refuses the call. A failure to rewrite the row after the call does not discard the paid reply; the reservation row stays at its estimate, so the spend stays counted.
- **Concurrency**: the check writes its reservation first and then reads the total again with its own row included, so two concurrent calls cannot both slip under the cap. The limit: two calls that together would cross the cap can both be refused (a refusal that was not needed, never a spend that was not allowed). It needs a ledger whose insert and sum read committed rows, which is what `token_usage_ledger` gives; no database function or migration is needed.
- **Wiring** (not done): a `BudgetDeps` from `budget.ts` with a ledger over `token_usage_ledger` (three methods: sum the feature, insert the reservation, update it), the provider and model names, `capUsd`, and `resolveAttribution: (req) => attributionFromHeaders(req.headers, () => crypto.randomUUID())`. The compliance-tracker caller (`createEdgeExtractCaller`) sends no attribution headers yet; that is a change for the unit that wires the model.

## Security model

- The caller is the compliance-tracker server. `verifyCaller` is a constant-time comparison of the bearer against the function secret `PROJEXA_DOCUMENT_EXTRACT_SECRET`; a secret shorter than 32 characters, or unset, refuses every caller (an unconfigured deploy is closed).
- The document is data. It only ever appears inside the JSON of the user message, after a fixed lead line; the system prompt holds no document text and says that text inside the data is never an instruction. JSON encoding escapes quotes and line breaks, so a cell cannot end the data block.
- The model's answer is untrusted. The caller checks it against an exact schema and against the uploaded file's own rows before any write.
- Nothing about the document, the bearer or the model reply is logged: log lines carry an outcome and a status only.
- The function holds no database client and no Supabase key. It reads no table and writes nothing.

## Files

- `handler.ts`: the request handler, with `verifyCaller`, the model, the budget and the limits passed in. Its only import is `./budget.ts`, which has none, so both run under Deno and under bun unchanged. Run by `src/lib/services/projexa-document-extract.test.ts`.
- `budget.ts`: the spend cap: the pure rule `decideBudget`, the estimate, and the thin adapter `reserveBudget` / `settleBudget` over an injected ledger. Run by `src/lib/services/projexa-document-extract-budget.test.ts`.
- `index.ts`: `Deno.serve` and the environment (the secret), `model: null` and `budget: null`. Nothing else.

## Secrets

`PROJEXA_DOCUMENT_EXTRACT_SECRET`: at least 32 random characters. Set it as a function secret and as the same-named server environment variable of the caller (the compliance-tracker deployment). Not set anywhere yet. The caller also reads `NEXT_PUBLIC_SUPABASE_URL` (the project URL, already set) to build the function URL.

## Deploy

Not deployed. Deploy with `verify_jwt` **false**: the function does its own bearer check, and the caller sends the shared secret, not a Supabase JWT, so with `verify_jwt` on the platform would refuse the call before the handler sees it. The PM deploys through the Supabase MCP after the claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` is on `main`. No provider and no secret exist yet, so a deploy today answers 401 to everyone until the secret is set.

## Check it worked

With the secret set and no model wired: a call with the bearer answers `503 {"ok":false,"code":"model_not_configured"}`; a call without it answers `401`. Once a provider is wired (BR-509), the from-document route's own test (`src/app/api/v1/projexa/projects/from-document/route.test.ts`) shows the contract the function must keep.
