// PROJEXA-BUILD-002 WP-09b: the ONE table of what the ai-work-link-exec bundle replaces (write-path gap report 2b, blockers B1 to B11).
//
// The exec function runs one link write in a Deno Edge Function through the real pipeline (src/lib/pipeline/link-exec-entry.ts). The pipeline's import
// graph also reaches modules that cannot run there or must not run for a link: the Next.js runtime, a model client, an email sender, a spreadsheet
// parser, the postgres-role database client. Rather than move code out of files other work packages are editing, the bundle MAPS each such module to a
// small stub in src/lib/pipeline/link-exec-stubs/ that throws `NOT_AVAILABLE_ON_EXEC` if it is ever CALLED. Importing a stub costs nothing and never
// fails, so a function that does not need the module is unaffected; a function that does gets one closed failure code, never a half-run.
//
// Two programs read this table and must agree: scripts/verify/awl-exec-closure.mjs (the register row AW-504: computes the closure with the table
// applied and fails when a forbidden module is still reachable) and scripts/build-ai-work-link-exec.ts (the bundler plugin that applies it). A module
// that is stubbed is NOT reachable; a module that is not stubbed and not forbidden is inside the bundle.
//
// Adding an entry is a review event: say in `why` what the real module was used for and why no link function needs it.

export const STUB_DIR = "src/lib/pipeline/link-exec-stubs"

/** Packages, matched against the import specifier. `stub` is a file name in STUB_DIR. */
export const PACKAGE_STUBS = [
  { test: /^next\/server$/, stub: "next-server.ts", why: "NextResponse and after(): route and request-scope APIs; the only use in the closure is a fire-and-forget rule trigger that a link write skips" },
  { test: /^next\/headers$/, stub: "next-headers.ts", why: "request cookies and headers: no request exists inside the exec function" },
  { test: /^next-intl(\/.*)?$/, stub: "next-intl.ts", why: "locale lookup for model prompts: no model runs here" },
  { test: /^resend$/, stub: "resend.ts", why: "email sending: a link write sends no email" },
  { test: /^xlsx$/, stub: "xlsx.ts", why: "spreadsheet parsing for BOQ import: not a link function" },
  { test: /^pdf-parse(\/.*)?$/, stub: "pdf-parse.ts", why: "PDF parsing for BOQ import: not a link function" },
  { test: /^mathjs$/, stub: "mathjs.ts", why: "the maths engine of the task engine: not a link function" },
]

/** Repo files (src/...), matched after resolution. `stub` is a file name in STUB_DIR, or a repo path when it contains a slash. */
export const FILE_STUBS = {
  "src/lib/db/index.ts": {
    stub: "db-index.ts",
    why: "the postgres-role (RLS bypass) database client; the exec function has no such credential and every link write runs through withTenantContext as app_runtime",
  },
  "src/lib/services/compliance-service.ts": {
    stub: "src/lib/services/service-error.ts",
    why: "every service imports ServiceError from it; the class lives in the leaf service-error.ts, and the rest of the file (email, rewards, the compliance list) is not needed",
  },
  "src/lib/pipeline/level1.ts": { stub: "level1.ts", why: "the Level 1 model lane; a link call never runs it (effectiveLevel1 is off for a link)" },
  "src/lib/ai/adapter.ts": { stub: "ai-adapter.ts", why: "the model adapter and its providers (a spawned CLI, OpenRouter); no model call on link traffic" },
  "src/lib/llm-client.ts": { stub: "llm-client.ts", why: "the model client" },
  "src/lib/embeddings.ts": { stub: "embeddings.ts", why: "the embedding provider; a link memory row is stored without an embedding (spec 9.11)" },
  "src/lib/task-execution-engine.ts": { stub: "task-execution-engine.ts", why: "the read-only dispatch engine (mathjs, model calls): its functions are not link writes" },
  "src/lib/ingest/parser.ts": { stub: "ingest-parser.ts", why: "spreadsheet and PDF parsing for BOQ import: not a link function" },
  "src/lib/email.ts": { stub: "email.ts", why: "the email sender" },
  "src/lib/services/automation-rule-service.ts": {
    stub: "automation-rule-service.ts",
    why: "the fire-and-forget automation-rule trigger after a progress or labour write (PMD-45 R-E, gap G10): a link write skips it. The real trigger is an un-caught dynamic import that needs next/server, and an unhandled rejection can end an Edge isolate",
  },
}

/** What must NEVER be reachable once the table is applied (the closure check fails on any of these). */
export const FORBIDDEN_PACKAGES = [
  [/^next($|\/)/, "next/*"],
  [/^next-intl($|\/)/, "next-intl"],
  [/^resend$/, "resend"],
  [/^xlsx$/, "xlsx"],
  [/^pdf-parse($|\/)/, "pdf-parse"],
  [/^mathjs($|\/)/, "mathjs"],
  [/^@anthropic-ai\//, "a model client (@anthropic-ai)"],
  [/^openai$/, "a model client (openai)"],
  [/^@google\/generative-ai$/, "a model client (google)"],
  [/^groq-sdk$/, "a model client (groq)"],
  [/^(node:)?child_process$/, "child_process (a spawned model CLI)"],
]
export const FORBIDDEN_FILES = [
  [/^src\/lib\/llm-client\.ts$/, "the model client (llm-client)"],
  [/^src\/lib\/ai\/providers\//, "a model provider (src/lib/ai/providers)"],
  [/^src\/lib\/ai\/adapter\.ts$/, "the model adapter (src/lib/ai/adapter.ts)"],
  [/^src\/lib\/embeddings\.ts$/, "the embedding provider (src/lib/embeddings.ts)"],
  [/^src\/lib\/pipeline\/level1\.ts$/, "the Level 1 model lane (level1.ts)"],
  [/^src\/lib\/task-execution-engine\.ts$/, "the task execution engine"],
  [/^src\/lib\/email(\/|\.ts$)/, "the email sender (src/lib/email)"],
  [/^src\/lib\/supabase\/auth-guard\.ts$/, "auth-guard (next/headers)"],
  [/^src\/lib\/services\/compliance-service\.ts$/, "compliance-service (resend)"],
  [/^src\/lib\/db\/index\.ts$/, "the postgres-role database client (DATABASE_URL)"],
]

/** The stub a package specifier is mapped to, as a repo-relative path, or null. */
export function packageStub(spec) {
  for (const p of PACKAGE_STUBS) if (p.test.test(spec)) return `${STUB_DIR}/${p.stub}`
  return null
}

/** The stub a resolved repo file (repo-relative, forward slashes) is mapped to, as a repo-relative path, or null. */
export function fileStub(relPath) {
  const e = FILE_STUBS[relPath]
  if (!e) return null
  return e.stub.includes("/") ? e.stub : `${STUB_DIR}/${e.stub}`
}
