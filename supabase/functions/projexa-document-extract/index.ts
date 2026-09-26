// PROJEXA-BUILD-001 U-36 (E-13): the extraction worker of "create a project from a document". The compliance-tracker route posts a
// workbook digest here and this function makes the model call, so no Vercel function is billed for the model work. The logic is in
// handler.ts (bun-testable); this file only wires Deno.serve and the environment. See handler.ts for the security model.
import { bearerMatches, handleProjexaDocumentExtract } from "./handler.ts"

// The shared bearer secret. Set it as a function secret and as the same-named server environment variable of the caller. Until it is
// set (or when it is shorter than 32 characters) bearerMatches() refuses every caller, so an unconfigured deploy is closed.
const CALLER_SECRET = Deno.env.get("PROJEXA_DOCUMENT_EXTRACT_SECRET") ?? ""

Deno.serve((req: Request) =>
  handleProjexaDocumentExtract(req, {
    verifyCaller: (r) => Promise.resolve(bearerMatches(r.headers.get("authorization"), CALLER_SECRET)),
    // BR-509: the owner has not named a model provider. While this is null every authenticated call answers 503 model_not_configured.
    // Wiring a provider means replacing null with a function that returns the model's reply text; nothing else in this file changes.
    model: null,
    // U-36b (BR-526, PMD-43): the spend cap. The handler refuses every model call while this is null, so wiring a model without a
    // ledger-backed budget cannot spend. Wiring one means passing a BudgetDeps from budget.ts (ledger over compliance.token_usage_ledger,
    // provider, model, capUsd: parseCapUsd(Deno.env.get("PROJEXA_EXTRACT_BUDGET_CAP_USD")), resolveAttribution: attributionFromHeaders).
    budget: null,
  }),
)
