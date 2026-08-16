// PROJEXA Synthetic Load Test Harness.
// Full design/guardrails: docs/testing/PROJEXA_LOAD_TEST_PROTOCOL.md
// Run: bun run scripts/projexa-load-test.ts [--dry-run=N]
//   --dry-run=N runs only N personas x 1 task each, for harness validation
//   before committing to the full 100 x 5 = 500 task run.
import { db, organisations, users, products, projects, constructionBoqs, constructionCategories, orchestraExecutions, tasks } from "../src/lib/db";
import { eq, and, sql, gte, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { createTask } from "../src/lib/services/task-service";
import { callLLMJson, estimateCostUsd } from "../src/lib/llm-client";
import { writeFileSync, appendFileSync, mkdirSync } from "fs";

// ── Guardrails (docs/testing/PROJEXA_LOAD_TEST_PROTOCOL.md §5) ─────────────
const MAX_WALL_CLOCK_MS = 90 * 60 * 1000;
const MAX_PER_PERSONA_ITERATIONS = 8;
const CONCURRENCY_CAP = 5;
const CEREBRAS_BUDGET_USD = 3;
const GLM_BUDGET_USD = 1;
const ERROR_RATE_HALT_THRESHOLD = 0.3;
const ERROR_RATE_WINDOW = 50;

const GROQ_KEY = process.env.GROQ_API_KEY;
if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set");
// Groq's free tier for openai/gpt-oss-120b turned out to have a 200,000
// TPD (tokens/day) cap on top of RPM/TPM -- confirmed exhausted live during
// this run's persona-generation phase (a real finding, see results report).
// Per Boss's tiered budget ("free Groq and Cerebras first, then paid
// Cerebras up to $3"), generation now runs on Cerebras instead -- same
// gpt-oss-120b model, so "let these 100 users be created at GPT-OSS-120B"
// still holds; only the hosting provider changed.
const CEREBRAS_KEY_RAW = process.env.CEREBRAS_API_KEY;
if (!CEREBRAS_KEY_RAW) throw new Error("CEREBRAS_API_KEY not set");
// Reassigned to a definitely-string const: the guard above is enough at
// runtime, but TS's narrowing of CEREBRAS_KEY_RAW doesn't survive into the
// nested arrow-function closures below that reference it (confirmed via
// CI's tsc --noEmit -- `string | undefined` leaked through into
// callLLMJson's `apiKey: string` param despite the throw-guard).
const CEREBRAS_KEY: string = CEREBRAS_KEY_RAW;

// Retry wrapper for transient network/connection blips (seen repeatedly
// this session against both GitHub and Supabase/Postgres connections --
// not a logic bug, the local network here is genuinely flaky). Without
// this, a single blip partway through a 500-task run loses the whole run,
// not just the one task -- unacceptable for something that takes 30-90 min.
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      log(`Retry ${i + 1}/${attempts} for ${label} after error: ${msg.slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

// Cerebras rate limits for gpt-oss-120b are untested by us -- start with
// light spacing (well under Groq's old 8s floor, since Cerebras is a paid
// per-token API rather than a shared free RPM/TPM/TPD pool) and let
// withRetry's backoff absorb any 429s we do hit.
let lastCerebrasCallAt = 0;
async function throttleCerebras() {
  const wait = 1500 - (Date.now() - lastCerebrasCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCerebrasCallAt = Date.now();
}

const dryRunArg = process.argv.find((a) => a.startsWith("--dry-run="));
const DRY_RUN_PERSONAS = dryRunArg ? Number(dryRunArg.split("=")[1]) : null;
const TASKS_PER_PERSONA = DRY_RUN_PERSONAS ? 1 : 5;
const TOTAL_PERSONAS = DRY_RUN_PERSONAS ?? 100;

const runId = `loadtest-${Date.now()}`;
const orgSlug = `projexa-loadtest-${Date.now()}`;
mkdirSync("docs/testing", { recursive: true });
const logPath = `docs/testing/PROJEXA_LOAD_TEST_RUN_${runId}.log`;
const overflowPath = "docs/testing/PROJEXA_LOAD_TEST_OVERFLOW_QUEUE.md";

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(logPath, line + "\n");
}

const ROLES = [
  "Project Manager", "Site Engineer", "Site Supervisor", "Quantity Surveyor",
  "Procurement Manager", "Safety Officer", "Design/Architecture Lead", "MEP Engineer",
  "Finance/Accounts", "Contracts Manager", "Document Controller", "BIM Coordinator",
  "Client Relations", "Subcontractor Coordinator", "HR/Admin",
];

type Persona = { userId: string; name: string; role: string; context: string };
type GeneratedTask = { title: string; description: string; kind: "normal" | "edit" | "ambiguous" };

const startedAt = Date.now();
let totalLlmCalls = 0;
// Generation-phase calls (persona/task gen) now run on paid Cerebras and
// don't pass through the app's orchestra_executions logging, so their spend
// has to be tracked here and folded into the same $CEREBRAS_BUDGET_USD cap
// the execution phase checks via providerSpend() -- one unified budget,
// not two separate ones.
let generationCerebrasSpend = 0;
const recentOutcomes: boolean[] = []; // true = success, for the rolling error-rate window

function timeExceeded(): boolean {
  return Date.now() - startedAt > MAX_WALL_CLOCK_MS;
}

async function providerSpend(runOrgId: string, provider: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${orchestraExecutions.costUsd}), 0)` })
    .from(orchestraExecutions)
    .where(and(eq(orchestraExecutions.orgId, runOrgId), eq(orchestraExecutions.provider, provider)));
  return Number(row?.total ?? 0);
}

function recordOutcome(success: boolean) {
  recentOutcomes.push(success);
  if (recentOutcomes.length > ERROR_RATE_WINDOW) recentOutcomes.shift();
}

function errorRateExceeded(): boolean {
  if (recentOutcomes.length < ERROR_RATE_WINDOW) return false;
  const failures = recentOutcomes.filter((s) => !s).length;
  return failures / recentOutcomes.length > ERROR_RATE_HALT_THRESHOLD;
}

async function main() {
  log(`=== PROJEXA Load Test ${runId} starting === (personas=${TOTAL_PERSONAS}, tasksPerPersona=${TASKS_PER_PERSONA}, dryRun=${DRY_RUN_PERSONAS !== null})`);

  // ── 1. Setup: demo org, construction seed data, users ──────────────────
  const [org] = await withRetry("create org", () => db.insert(organisations).values({
    name: `PROJEXA Load Test ${runId}`, slug: orgSlug, plan: "pro", accountType: "company",
  }).returning());
  log(`Created org ${org.id} (slug=${orgSlug})`);

  const [product] = await withRetry("create product", () => db.insert(products).values({
    orgId: org.id, name: "Load Test Construction Product", slug: "loadtest-construction",
  }).returning());

  const [project] = await withRetry("create project", () => db.insert(projects).values({
    orgId: org.id, productId: product.id, name: "Phase 2 Tower Block (Load Test)",
    description: "Synthetic project for PROJEXA load testing",
  }).returning());

  const [boq] = await withRetry("create BOQ", () => db.insert(constructionBoqs).values({
    orgId: org.id, projectId: project.id, title: "Load Test BOQ v1", status: "approved", createdById: "loadtest-harness",
  }).returning());

  const [category] = await withRetry("create category", () => db.insert(constructionCategories).values({
    orgId: org.id, projectId: project.id, name: "Civil Works",
  }).returning());
  log(`Seeded construction project ${project.id}, BOQ ${boq.id}, category ${category.id}`);

  const personaSeeds: { role: string; index: number }[] = [];
  for (let i = 0; i < TOTAL_PERSONAS; i++) {
    personaSeeds.push({ role: ROLES[i % ROLES.length], index: i });
  }

  const userRows: (typeof users.$inferSelect)[] = [];
  for (const seed of personaSeeds) {
    const [u] = await withRetry(`create user ${seed.index}`, () => db.insert(users).values({
      orgId: org.id, name: `${seed.role.replace(/\W+/g, "")}_${seed.index}`,
      email: `loadtest.${seed.index}@${orgSlug}.veridiandemo.internal`,
      role: "member",
      // Synthetic test-only account -- never authenticates via password (no
      // login UI is exercised by this harness), so a fixed placeholder hash
      // is fine; NOT NULL in the live schema (users.passwordHash), caught
      // by the dry run before this reached the full 100-user run.
      passwordHash: "loadtest-synthetic-account-no-login",
    }).returning());
    userRows.push(u);
  }
  log(`Created ${userRows.length} synthetic users`);

  // ── 2. Persona generation (GPT-OSS-120B via Cerebras) ───────────────────
  const personas: Persona[] = [];
  for (let i = 0; i < userRows.length; i++) {
    const seed = personaSeeds[i];
    const u = userRows[i];
    if (generationCerebrasSpend >= CEREBRAS_BUDGET_USD) {
      log(`Cerebras generation budget ($${CEREBRAS_BUDGET_USD}) hit -- falling back to template context for remaining personas.`);
      personas.push({ userId: u.id, name: u.name, role: seed.role, context: `${seed.role} on the Phase 2 tower block project.` });
      continue;
    }
    try {
      const { data, usage } = await withRetry(`persona gen ${u.id}`, async () => {
        await throttleCerebras();
        return callLLMJson<{ context: string }>(
          "cerebras", "gpt-oss-120b", CEREBRAS_KEY,
          "You generate a realistic 1-2 sentence work context for a construction-company employee, given their role. Respond as JSON: {\"context\": \"...\"}",
          `Role: ${seed.role}. Company: mid-size construction firm running a tower-block project.`,
          { temperature: 0.7, maxTokens: 400 }
        );
      }, 4);
      totalLlmCalls++;
      generationCerebrasSpend += estimateCostUsd("gpt-oss-120b", usage) ?? 0;
      personas.push({ userId: u.id, name: u.name, role: seed.role, context: data.context });
    } catch (err) {
      log(`Persona generation failed for ${u.id}: ${err instanceof Error ? err.message : err}`);
      personas.push({ userId: u.id, name: u.name, role: seed.role, context: `${seed.role} on the Phase 2 tower block project.` });
    }
    if (timeExceeded()) { log("Wall-clock limit hit during persona generation -- halting."); break; }
  }
  log(`Generated ${personas.length} personas (${totalLlmCalls} LLM calls so far, Cerebras gen spend=$${generationCerebrasSpend.toFixed(4)})`);

  // ── 3. Task generation per persona ──────────────────────────────────────
  const allTasks: { persona: Persona; task: GeneratedTask }[] = [];
  for (const persona of personas) {
    if (generationCerebrasSpend >= CEREBRAS_BUDGET_USD) {
      log(`Cerebras generation budget ($${CEREBRAS_BUDGET_USD}) hit -- skipping task gen for remaining personas (they contribute 0 tasks, not a fabricated fallback).`);
      break;
    }
    try {
      const { data, usage } = await withRetry(`task gen ${persona.userId}`, async () => {
        await throttleCerebras();
        return callLLMJson<{ tasks: GeneratedTask[] }>(
          "cerebras", "gpt-oss-120b", CEREBRAS_KEY,
          `You generate realistic work-task requests for a construction-company employee, phrased the way they'd actually type them into an internal AI assistant. Generate exactly ${TASKS_PER_PERSONA} tasks. ~10% should be "edit" kind (a correction/follow-up to a prior request, e.g. "actually, change that to..."), ~5% "ambiguous" kind (vague or referencing something that may not exist in the system), the rest "normal". Respond as JSON: {"tasks": [{"title": "...", "description": "...", "kind": "normal"|"edit"|"ambiguous"}]}`,
          `Employee role: ${persona.role}. Context: ${persona.context}. Generate ${TASKS_PER_PERSONA} realistic tasks this person would ask a PROJEXA/construction AI assistant to help with (budget status, KPIs, progress summaries, risk detection, site diary, BOQ, procurement, etc. -- whatever fits this specific role). Keep each title/description brief (under 20 words) -- token budget is tight.`,
          { temperature: 0.8, maxTokens: 900 }
        );
      }, 4);
      totalLlmCalls++;
      generationCerebrasSpend += estimateCostUsd("gpt-oss-120b", usage) ?? 0;
      for (const t of (data.tasks ?? []).slice(0, TASKS_PER_PERSONA)) {
        allTasks.push({ persona, task: t });
      }
    } catch (err) {
      log(`Task generation failed for persona ${persona.userId}: ${err instanceof Error ? err.message : err}`);
    }
    if (timeExceeded()) { log("Wall-clock limit hit during task generation -- halting."); break; }
  }
  log(`Generated ${allTasks.length} tasks total (${totalLlmCalls} LLM calls so far, Cerebras gen spend=$${generationCerebrasSpend.toFixed(4)})`);

  // ── 4. Execution, with concurrency cap + budget/time/error guardrails ──
  let executed = 0, succeeded = 0, failed = 0, overflowed = 0;
  const personaIterationCount = new Map<string, number>();

  async function executeOne(entry: { persona: Persona; task: GeneratedTask }): Promise<void> {
    const { persona, task } = entry;
    const iterCount = (personaIterationCount.get(persona.userId) ?? 0) + 1;
    personaIterationCount.set(persona.userId, iterCount);
    if (iterCount > MAX_PER_PERSONA_ITERATIONS) {
      log(`Persona ${persona.userId} hit per-persona iteration cap (${MAX_PER_PERSONA_ITERATIONS}) -- skipping remaining tasks for this persona.`);
      return;
    }

    // Budget guardrail: check Cerebras/GLM spend before submitting -- if
    // both paid escalation tiers are already at their cap, this task still
    // gets CREATED (so the floor tier / structured dispatch can still
    // handle it for free), but if it needs escalation and both are capped,
    // task-execution-engine.ts's escalatedPlatformConfig() will still
    // resolve to GLM-5.2 (no in-process way to intercept that without
    // touching production routing code for a temporary test constraint --
    // see protocol doc). Instead: check spend AFTER, and once a cap is
    // crossed, queue all SUBSEQUENT unexecuted tasks to the overflow file
    // for Claude to resolve directly, rather than let the run silently
    // exceed the intended per-provider budget for the rest of the test.
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, persona.userId) });
    if (!dbUser) { log(`User ${persona.userId} not found -- skipping.`); return; }

    try {
      const result = await withRetry(`createTask for ${persona.userId}`, () => createTask(
        { orgId: org.id, actor: { dbUser } },
        { title: task.title, description: task.description }
      ));
      executed++;
      if ("needsConfirmation" in result && result.needsConfirmation) {
        const confirmed = await withRetry(`confirm task for ${persona.userId}`, () => createTask(
          { orgId: org.id, actor: { dbUser } },
          { title: task.title, description: task.description, confirmed: true }
        ));
        if ("status" in confirmed && confirmed.status !== "failed") { succeeded++; recordOutcome(true); }
        else { failed++; recordOutcome(false); }
      } else if ("status" in result && result.status !== "failed") {
        succeeded++; recordOutcome(true);
      } else {
        failed++; recordOutcome(false);
      }
    } catch (err) {
      failed++; recordOutcome(false);
      const cause = err instanceof Error && err.cause instanceof Error ? ` | cause: ${err.cause.message}` : "";
      log(`Task execution error for persona ${persona.userId} (${task.kind}): ${err instanceof Error ? err.message.slice(0, 150) : err}${cause}`);
    }
  }

  let cursor = 0;
  let haltedReason: string | null = null;
  while (cursor < allTasks.length) {
    if (timeExceeded()) { haltedReason = "wall-clock limit"; break; }
    if (errorRateExceeded()) { haltedReason = `error rate exceeded ${ERROR_RATE_HALT_THRESHOLD * 100}% over last ${ERROR_RATE_WINDOW} tasks`; break; }

    const cerebrasSpend = (await providerSpend(org.id, "cerebras")) + generationCerebrasSpend;
    const glmSpend = await providerSpend(org.id, "openrouter");
    if (cerebrasSpend >= CEREBRAS_BUDGET_USD && glmSpend >= GLM_BUDGET_USD) {
      const remaining = allTasks.slice(cursor);
      appendFileSync(overflowPath, `\n## Overflow batch from ${runId} (${remaining.length} tasks) -- both paid tiers capped\n\n`);
      for (const r of remaining) {
        appendFileSync(overflowPath, `- **${r.persona.role}** (${r.persona.userId}): "${r.task.title}" — ${r.task.description}\n`);
      }
      overflowed += remaining.length;
      haltedReason = `Cerebras ($${cerebrasSpend.toFixed(2)}) and GLM-5.2 ($${glmSpend.toFixed(2)}) both at/over their caps -- ${remaining.length} remaining tasks queued to ${overflowPath} for Claude to resolve directly`;
      break;
    }

    const batch = allTasks.slice(cursor, cursor + CONCURRENCY_CAP);
    await Promise.all(batch.map(executeOne));
    cursor += batch.length;

    if (cursor % 25 === 0 || cursor >= allTasks.length) {
      log(`Progress: ${cursor}/${allTasks.length} tasks (succeeded=${succeeded}, failed=${failed}), Cerebras spend=$${cerebrasSpend.toFixed(4)}, GLM spend=$${glmSpend.toFixed(4)}, LLM calls=${totalLlmCalls}`);
    }
  }

  if (haltedReason) log(`HALTED: ${haltedReason}`);
  log(`=== Run complete: executed=${executed} succeeded=${succeeded} failed=${failed} overflowed=${overflowed} totalLlmCalls=${totalLlmCalls} durationMs=${Date.now() - startedAt} ===`);
  log(`Demo org: ${org.id} (slug=${orgSlug}) -- query orchestra_executions/tasks WHERE org_id='${org.id}' for full results`);

  writeFileSync(`docs/testing/PROJEXA_LOAD_TEST_${runId}_SUMMARY.json`, JSON.stringify({
    runId, orgId: org.id, orgSlug, personasCreated: personas.length, tasksGenerated: allTasks.length,
    executed, succeeded, failed, overflowed, totalLlmCalls, durationMs: Date.now() - startedAt, haltedReason,
  }, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
