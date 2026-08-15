// VERIDIAN AI OS Full-Platform Synthetic Load Test Harness.
// Follow-up to scripts/projexa-load-test.ts (PROJEXA-only, 500 tasks,
// single orchestra layer). This test reuses the SAME demo company/org and
// its 100 existing synthetic personas (per Boss's explicit "use the same
// demo company" instruction, 2026-07-10), but targets 2000 items across
// FOUR real orchestra layers/entry points instead of one:
//   - task_oa            via createTask()           (general tasks, all
//                          business domains -- compliance, GST, CRM,
//                          meetings, PROJEXA, general ops)
//   - user_assistant_oa   via sendMessage() in an AI thread (VERI Chat)
//   - facilities_management_register_digitize_oa via parseAndExtractFromFile()
//                          (CSV asset-register uploads)
//   - customer_account_oa via extractDocumentContent() (vision document
//                          extraction -- small scale, see §doc mode below)
// meta_oa (platform-internal audit) and global_intelligence_oa (zero call
// sites anywhere in the codebase -- confirmed dormant, not a test gap) are
// intentionally out of scope, same conclusion as the PROJEXA run's report.
// page_agent_oa (real browser DOM control) is explicitly OUT of scope per
// Boss's decision 2026-07-10 -- service-layer only this run.
//
// Run: bun run scripts/veridian-full-load-test.ts [--dry-run=N]
import {
  db, organisations, users, tasks, orchestraExecutions,
  conversations, messages, documents,
} from "../src/lib/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { createTask } from "../src/lib/services/task-service";
import { createWorkflowThread, sendMessage } from "../src/lib/services/chat-service";
import { parseAndExtractFromFile } from "../src/lib/services/fm-register-digitization-service";
import { extractDocumentContent } from "../src/lib/services/document-extraction-service";
import { enableFmForOrg, isFmEnabledForOrg } from "../src/lib/services/fm-enablement-service";
import { callLLMJson, estimateCostUsd } from "../src/lib/llm-client";
import { writeFileSync, appendFileSync, mkdirSync } from "fs";

// ── Guardrails ───────────────────────────────────────────────────────────
// Same rigor as the PROJEXA run (Boss directive: "keep the same tightening
// of instructions"), scaled where the volume/mix genuinely requires it --
// budget caps are UNCHANGED per Boss's explicit confirmation 2026-07-10
// ("keep the same caps $3 / $1"); wall-clock and per-persona iteration caps
// are scaled up because this run is 4x the task volume across slower paths
// (vision extraction, multi-row FM batches), not because rigor is relaxed.
const MAX_WALL_CLOCK_MS = 150 * 60 * 1000; // 2.5h (was 90min for 500 tasks)
const MAX_PER_PERSONA_ITERATIONS = 25; // was 8 for ~5 tasks/persona; now ~20/persona across modes
const CONCURRENCY_CAP = 5;
const CEREBRAS_BUDGET_USD = 3; // unchanged per Boss's confirmation
const GLM_BUDGET_USD = 1; // unchanged per Boss's confirmation
const ERROR_RATE_HALT_THRESHOLD = 0.3;
const ERROR_RATE_WINDOW = 50;

const DEMO_ORG_ID = "obux019rsc5nzxjx93rrpc1j"; // same demo company as the PROJEXA run

const CEREBRAS_KEY_RAW = process.env.CEREBRAS_API_KEY;
if (!CEREBRAS_KEY_RAW) throw new Error("CEREBRAS_API_KEY not set");
// Reassigned to a definitely-string const -- see the identical comment in
// scripts/projexa-load-test.ts for why (TS narrowing doesn't survive into
// nested closures).
const CEREBRAS_KEY: string = CEREBRAS_KEY_RAW;

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
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

let lastCerebrasCallAt = 0;
async function throttleCerebras() {
  const wait = 1500 - (Date.now() - lastCerebrasCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCerebrasCallAt = Date.now();
}

const dryRunArg = process.argv.find((a) => a.startsWith("--dry-run="));
const DRY_RUN_PERSONAS = dryRunArg ? Number(dryRunArg.split("=")[1]) : null;
// Full run: 14 task-mode + 4 chat-mode items generated per persona (100
// personas -> 1400 + 400 = 1800), plus 150 FM-mode + 50 doc-mode items
// distributed round-robin across personas (templated, no generation LLM
// call needed) = 2000 total. Dry run scales every count down proportionally.
const TASK_ITEMS_PER_PERSONA = DRY_RUN_PERSONAS ? 2 : 14;
const CHAT_ITEMS_PER_PERSONA = DRY_RUN_PERSONAS ? 1 : 4;
const TOTAL_PERSONAS = DRY_RUN_PERSONAS ?? 100;
const FM_ITEMS_TOTAL = DRY_RUN_PERSONAS ? 2 : 150;
const DOC_ITEMS_TOTAL = DRY_RUN_PERSONAS ? 1 : 50;

const runId = `fullload-${Date.now()}`;
mkdirSync("docs/testing", { recursive: true });
const logPath = `docs/testing/VERIDIAN_FULL_LOAD_TEST_RUN_${runId}.log`;
const overflowPath = "docs/testing/VERIDIAN_FULL_LOAD_TEST_OVERFLOW_QUEUE.md";

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(logPath, line + "\n");
}

type Persona = { userId: string; name: string; role: string };
type GenItem = { mode: "task" | "chat"; title: string; description: string; kind: "normal" | "edit" | "ambiguous" };
type ExecItem =
  | { mode: "task"; persona: Persona; item: GenItem }
  | { mode: "chat"; persona: Persona; item: GenItem }
  | { mode: "fm"; persona: Persona; csv: string }
  | { mode: "doc"; persona: Persona };

const startedAt = Date.now();
let totalLlmCalls = 0;
let generationCerebrasSpend = 0;
const recentOutcomes: boolean[] = [];

function timeExceeded(): boolean {
  return Date.now() - startedAt > MAX_WALL_CLOCK_MS;
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
async function providerSpend(orgId: string, provider: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${orchestraExecutions.costUsd}), 0)` })
    .from(orchestraExecutions)
    .where(and(eq(orchestraExecutions.orgId, orgId), eq(orchestraExecutions.provider, provider)));
  return Number(row?.total ?? 0);
}

// 1x1 transparent PNG -- deliberately minimal placeholder for doc-mode's
// vision-extraction calls. This tests pipeline mechanics (model routing,
// vision call succeeds, JSON parses, documents.extractedData gets written,
// orchestra_executions logs correctly) NOT extraction quality/accuracy --
// a real photographed document would obviously be needed to judge OCR
// quality, which is explicitly out of scope for a load/robustness test.
const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function synthesizeAssetCsv(n: number): string {
  const categories = ["HVAC", "Electrical", "Plumbing", "Fire Safety", "Furniture", "IT Equipment", "Elevators"];
  const conditions = ["Good", "Fair", "Needs Repair", "New"];
  const rows = ["Asset Name,Category,Location,Condition,Purchase Date"];
  for (let i = 0; i < n; i++) {
    const cat = categories[i % categories.length];
    const cond = conditions[i % conditions.length];
    rows.push(`${cat} Unit ${i + 1},${cat},Floor ${1 + (i % 5)}${i % 2 === 0 ? " East Wing" : " West Wing"},${cond},2024-0${1 + (i % 9)}-15`);
  }
  return rows.join("\n");
}

async function main() {
  log(`=== VERIDIAN Full-Platform Load Test ${runId} starting === (personas=${TOTAL_PERSONAS}, taskItems/persona=${TASK_ITEMS_PER_PERSONA}, chatItems/persona=${CHAT_ITEMS_PER_PERSONA}, fmItems=${FM_ITEMS_TOTAL}, docItems=${DOC_ITEMS_TOTAL}, dryRun=${DRY_RUN_PERSONAS !== null})`);

  const [org] = await withRetry("load demo org", () => db.select().from(organisations).where(eq(organisations.id, DEMO_ORG_ID)));
  if (!org) throw new Error(`Demo org ${DEMO_ORG_ID} not found -- did the PROJEXA run's org get cleaned up already?`);
  log(`Reusing demo org ${org.id} (${org.name})`);

  const userRows = await withRetry("load users", () => db.select().from(users).where(eq(users.orgId, DEMO_ORG_ID)));
  if (userRows.length === 0) throw new Error(`No users found for org ${DEMO_ORG_ID}`);
  const activeUsers = DRY_RUN_PERSONAS ? userRows.slice(0, DRY_RUN_PERSONAS) : userRows;
  log(`Reusing ${activeUsers.length} existing synthetic personas`);

  const personas: Persona[] = activeUsers.map((u) => ({
    userId: u.id, name: u.name, role: u.name.replace(/_\d+$/, "").replace(/([A-Z])/g, " $1").trim(),
  }));

  // ── FM branch enablement (one-time, idempotent) ─────────────────────────
  // Every synthetic persona from the PROJEXA run was created with role
  // "member" (realistic default), but enableFmForOrg requires "admin" --
  // a real company has at least one admin, so promote the first persona's
  // user, matching realistic org structure rather than a load-test-only
  // hack account.
  const fmAlready = await withRetry("check FM enabled", () => isFmEnabledForOrg(DEMO_ORG_ID));
  if (!fmAlready) {
    const [adminUser] = await withRetry("promote admin for FM enablement", () =>
      db.update(users).set({ role: "admin" }).where(eq(users.id, activeUsers[0].id)).returning()
    );
    await withRetry("enable FM branch", () => enableFmForOrg({ orgId: DEMO_ORG_ID, userId: adminUser.id, dbUser: adminUser }));
    log(`Promoted ${adminUser.id} to admin and enabled VERI FM & CS AI OS branch for org ${DEMO_ORG_ID}`);
  } else {
    log(`FM branch already enabled for org ${DEMO_ORG_ID}`);
  }

  // ── Generation: one Cerebras call per persona, asking for BOTH task-mode
  // and chat-mode items in a single JSON response (keeps LLM call count at
  // ~100, same order of magnitude as the PROJEXA run, instead of scaling
  // 1:1 with the 1800 generated items) ────────────────────────────────────
  const genItems: { persona: Persona; item: GenItem }[] = [];
  for (const persona of personas) {
    if (generationCerebrasSpend >= CEREBRAS_BUDGET_USD) {
      log(`Cerebras generation budget hit -- skipping generation for remaining personas.`);
      break;
    }
    try {
      const { data, usage } = await withRetry(`gen items ${persona.userId}`, async () => {
        await throttleCerebras();
        return callLLMJson<{ items: GenItem[] }>(
          "cerebras", "gpt-oss-120b", CEREBRAS_KEY,
          `You generate realistic requests a construction-company employee would send to VERIDIAN AI OS -- their company's all-in-one AI operating system covering compliance, GST filing, CRM (leads/clients), meeting intelligence, general task management, AND their PROJEXA construction-management product. Generate exactly ${TASK_ITEMS_PER_PERSONA} "task" mode items (things they'd ask the system to DO or track -- spanning compliance deadlines, GST reconciliation, CRM follow-ups, meeting action items, PROJEXA site/budget/progress work, general ops) and exactly ${CHAT_ITEMS_PER_PERSONA} "chat" mode items (a casual question or request they'd type straight into the AI chat assistant, not a formal task). ~10% of all items should be "edit" kind (a correction/follow-up, e.g. "actually, change that to..."), ~5% "ambiguous" kind (vague or referencing something that may not exist). Keep title/description brief (under 20 words each) -- token budget is tight. Respond as JSON: {"items": [{"mode": "task"|"chat", "title": "...", "description": "...", "kind": "normal"|"edit"|"ambiguous"}]}`,
          `Employee role: ${persona.role}. Company: mid-size construction firm using VERIDIAN AI OS for its whole business (not just construction). Generate ${TASK_ITEMS_PER_PERSONA} task-mode + ${CHAT_ITEMS_PER_PERSONA} chat-mode items fitting this role, spread realistically across compliance/GST/CRM/meetings/PROJEXA/general-ops -- not all PROJEXA.`,
          { temperature: 0.8, maxTokens: 3000 }
        );
      }, 4);
      totalLlmCalls++;
      generationCerebrasSpend += estimateCostUsd("gpt-oss-120b", usage) ?? 0;
      for (const it of data.items ?? []) genItems.push({ persona, item: it });
    } catch (err) {
      log(`Item generation failed for ${persona.userId}: ${err instanceof Error ? err.message : err}`);
    }
    if (timeExceeded()) { log("Wall-clock limit hit during generation -- halting."); break; }
  }
  log(`Generated ${genItems.length} task/chat items (${totalLlmCalls} LLM calls so far, Cerebras gen spend=$${generationCerebrasSpend.toFixed(4)})`);

  // ── Build the full execution queue: generated task/chat items + templated
  // FM/doc items, round-robin assigned across personas ────────────────────
  const execQueue: ExecItem[] = [];
  for (const { persona, item } of genItems) {
    execQueue.push(item.mode === "chat" ? { mode: "chat", persona, item } : { mode: "task", persona, item });
  }
  for (let i = 0; i < FM_ITEMS_TOTAL; i++) {
    const persona = personas[i % personas.length];
    execQueue.push({ mode: "fm", persona, csv: synthesizeAssetCsv(5 + (i % 10)) });
  }
  for (let i = 0; i < DOC_ITEMS_TOTAL; i++) {
    const persona = personas[i % personas.length];
    execQueue.push({ mode: "doc", persona });
  }
  log(`Execution queue built: ${execQueue.length} total items (task=${execQueue.filter((e) => e.mode === "task").length}, chat=${execQueue.filter((e) => e.mode === "chat").length}, fm=${execQueue.filter((e) => e.mode === "fm").length}, doc=${execQueue.filter((e) => e.mode === "doc").length})`);

  // ── Execution ────────────────────────────────────────────────────────
  let executed = 0, succeeded = 0, failed = 0, overflowed = 0;
  const byMode = { task: { s: 0, f: 0 }, chat: { s: 0, f: 0 }, fm: { s: 0, f: 0 }, doc: { s: 0, f: 0 } };
  const personaIterationCount = new Map<string, number>();
  const personaAiThread = new Map<string, string>();

  async function getAiThread(persona: Persona): Promise<string> {
    const cached = personaAiThread.get(persona.userId);
    if (cached) return cached;
    const id = await withRetry(`ai thread for ${persona.userId}`, () =>
      createWorkflowThread({ orgId: DEMO_ORG_ID, userId: persona.userId }, { title: "VERIDIAN Load Test" })
    );
    // sendMessage only triggers an AI reply if isAiThread=true, which
    // createWorkflowThread already sets -- confirmed via chat-service.ts.
    personaAiThread.set(persona.userId, id);
    return id;
  }

  async function executeOne(entry: ExecItem): Promise<void> {
    const iterCount = (personaIterationCount.get(entry.persona.userId) ?? 0) + 1;
    personaIterationCount.set(entry.persona.userId, iterCount);
    if (iterCount > MAX_PER_PERSONA_ITERATIONS) {
      log(`Persona ${entry.persona.userId} hit per-persona iteration cap (${MAX_PER_PERSONA_ITERATIONS}) -- skipping.`);
      return;
    }
    const dbUser = activeUsers.find((u) => u.id === entry.persona.userId);
    if (!dbUser) { log(`User ${entry.persona.userId} not found -- skipping.`); return; }

    try {
      if (entry.mode === "task") {
        const result = await withRetry(`createTask for ${entry.persona.userId}`, () => createTask(
          { orgId: DEMO_ORG_ID, actor: { dbUser } },
          { title: entry.item.title, description: entry.item.description }
        ));
        executed++;
        if ("needsConfirmation" in result && result.needsConfirmation) {
          const confirmed = await withRetry(`confirm task for ${entry.persona.userId}`, () => createTask(
            { orgId: DEMO_ORG_ID, actor: { dbUser } },
            { title: entry.item.title, description: entry.item.description, confirmed: true }
          ));
          if ("status" in confirmed && confirmed.status !== "failed") { succeeded++; byMode.task.s++; recordOutcome(true); }
          else { failed++; byMode.task.f++; recordOutcome(false); }
        } else if ("status" in result && result.status !== "failed") {
          succeeded++; byMode.task.s++; recordOutcome(true);
        } else {
          failed++; byMode.task.f++; recordOutcome(false);
        }
      } else if (entry.mode === "chat") {
        const threadId = await getAiThread(entry.persona);
        executed++;
        try {
          const result = await sendMessage(
            { orgId: DEMO_ORG_ID, userId: entry.persona.userId }, threadId,
            { content: `${entry.item.title} -- ${entry.item.description}` }
          );
          if (result?.message) { succeeded++; byMode.chat.s++; recordOutcome(true); }
          else { failed++; byMode.chat.f++; recordOutcome(false); }
        } catch (err) {
          // sendMessage's core work (message insert + AI reply generation)
          // completes BEFORE its trailing after()-wrapped background FDE
          // side-effect runs -- confirmed live (dry-run) via direct DB
          // read: the message+reply persisted despite this throw. after()
          // requires a real Next.js request scope, which a standalone
          // script never has, so this specific error is an environment
          // mismatch, not a functional failure -- do NOT retry (retrying
          // would just re-send the same message and create duplicates)
          // and do NOT count it against the error-rate guardrail.
          if (err instanceof Error && err.message.includes("was called outside a request scope")) {
            succeeded++; byMode.chat.s++; recordOutcome(true);
          } else {
            throw err;
          }
        }
      } else if (entry.mode === "fm") {
        const [docRow] = await withRetry(`doc row for fm ${entry.persona.userId}`, () => db.insert(documents).values({
          orgId: DEMO_ORG_ID, name: `Asset Register ${entry.persona.userId}.csv`, fileUrl: `loadtest/${createId()}.csv`,
          fileType: "text/csv", uploadedById: entry.persona.userId,
        }).returning());
        const result = await withRetry(`fm digitize for ${entry.persona.userId}`, () => parseAndExtractFromFile(
          { orgId: DEMO_ORG_ID, userId: entry.persona.userId, dbUser },
          { documentId: docRow.id, buffer: Buffer.from(entry.csv), fileName: "assets.csv", mimeType: "text/csv" }
        ));
        executed++;
        if (result?.batchId) { succeeded++; byMode.fm.s++; recordOutcome(true); }
        else { failed++; byMode.fm.f++; recordOutcome(false); }
      } else {
        const [docRow] = await withRetry(`doc row for extract ${entry.persona.userId}`, () => db.insert(documents).values({
          orgId: DEMO_ORG_ID, name: `Scanned Document ${entry.persona.userId}.png`, fileUrl: `loadtest/${createId()}.png`,
          fileType: "image/png", uploadedById: entry.persona.userId,
        }).returning());
        await withRetry(`doc extract for ${entry.persona.userId}`, () => extractDocumentContent(
          { orgId: DEMO_ORG_ID, userId: entry.persona.userId, documentId: docRow.id, fileBase64: PLACEHOLDER_PNG_BASE64, mimeType: "image/png" }
        ));
        executed++;
        // extractDocumentContent returns void by design (fire-and-forget
        // shape) -- verify success by re-reading the row it should have
        // updated rather than trusting a return value that doesn't exist.
        const [after] = await db.select().from(documents).where(eq(documents.id, docRow.id));
        if (after?.extractedData) { succeeded++; byMode.doc.s++; recordOutcome(true); }
        else { failed++; byMode.doc.f++; recordOutcome(false); }
      }
    } catch (err) {
      executed++; failed++; byMode[entry.mode].f++; recordOutcome(false);
      const cause = err instanceof Error && err.cause instanceof Error ? ` | cause: ${err.cause.message}` : "";
      log(`Execution error [${entry.mode}] for persona ${entry.persona.userId}: ${err instanceof Error ? err.message.slice(0, 150) : err}${cause}`);
    }
  }

  let cursor = 0;
  let haltedReason: string | null = null;
  while (cursor < execQueue.length) {
    if (timeExceeded()) { haltedReason = "wall-clock limit"; break; }
    if (errorRateExceeded()) { haltedReason = `error rate exceeded ${ERROR_RATE_HALT_THRESHOLD * 100}% over last ${ERROR_RATE_WINDOW} items`; break; }

    const cerebrasSpend = (await providerSpend(DEMO_ORG_ID, "cerebras")) + generationCerebrasSpend;
    const glmSpend = await providerSpend(DEMO_ORG_ID, "openrouter");
    if (cerebrasSpend >= CEREBRAS_BUDGET_USD && glmSpend >= GLM_BUDGET_USD) {
      const remaining = execQueue.slice(cursor);
      appendFileSync(overflowPath, `\n## Overflow batch from ${runId} (${remaining.length} items) -- both paid tiers capped\n\n`);
      for (const r of remaining) {
        const label = r.mode === "task" || r.mode === "chat" ? `"${r.item.title}"` : `${r.mode} item`;
        appendFileSync(overflowPath, `- **[${r.mode}]** ${r.persona.role} (${r.persona.userId}): ${label}\n`);
      }
      overflowed += remaining.length;
      haltedReason = `Cerebras ($${cerebrasSpend.toFixed(2)}) and GLM-5.2 ($${glmSpend.toFixed(2)}) both at/over their caps -- ${remaining.length} remaining items queued to ${overflowPath}`;
      break;
    }

    const batch = execQueue.slice(cursor, cursor + CONCURRENCY_CAP);
    await Promise.all(batch.map(executeOne));
    cursor += batch.length;

    if (cursor % 100 === 0 || cursor >= execQueue.length) {
      log(`Progress: ${cursor}/${execQueue.length} items (succeeded=${succeeded}, failed=${failed}), byMode=${JSON.stringify(byMode)}, Cerebras spend=$${cerebrasSpend.toFixed(4)}, GLM spend=$${glmSpend.toFixed(4)}, LLM calls=${totalLlmCalls}`);
    }
  }

  if (haltedReason) log(`HALTED: ${haltedReason}`);

  const summary = {
    runId, orgId: DEMO_ORG_ID, personasReused: personas.length,
    itemsGenerated: genItems.length, fmItems: FM_ITEMS_TOTAL, docItems: DOC_ITEMS_TOTAL,
    executed, succeeded, failed, overflowed, byMode, totalLlmCalls,
    durationMs: Date.now() - startedAt, haltedReason,
  };
  writeFileSync(`docs/testing/VERIDIAN_FULL_LOAD_TEST_${runId}_SUMMARY.json`, JSON.stringify(summary, null, 2));
  log(`=== Run complete: ${JSON.stringify(summary)} ===`);
  log(`Demo org: ${DEMO_ORG_ID} -- query orchestra_executions/tasks WHERE org_id='${DEMO_ORG_ID}' AND created_at > '${new Date(startedAt).toISOString()}' for this run's rows`);
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? err.stack ?? err.message : err}`);
  process.exit(1);
});
