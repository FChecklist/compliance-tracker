import { workerAgents, tasks, taskExecutionPlan, taskAgentExecutions, taskChatMessages, dynamicChains, entityRelationships, computationEngines } from "@/lib/db";
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped";
import { eq, and, asc, desc, ne, inArray, sql } from "drizzle-orm";
import { escalatedPlatformConfig } from "@/lib/orchestra-model-resolver";
import { resolveModel as resolveMotherRouterModel } from "@/lib/ai-router/mother-router";
import { callLLMJson } from "@/lib/llm-client";
import { buildPurposeClause, isToolAllowedForDomain, DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai";
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine";
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver";
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger";
import { searchAssistantMemories, recordAssistantMemory } from "@/lib/services/assistant-memory-service";
import { assertValidDispatchOutput } from "@/lib/dispatch-output-validator";
import { detectHighImpactAction } from "@/lib/high-impact-action-detector";
import { checkPreCallEscalation, detectLowConfidenceResponse, type EscalationSignal } from "@/lib/floor-tier-escalation";
import { evaluateGuardrails, recordGuardrailViolation } from "@/lib/guardrail-engine";
import { registerAllGuardrails, TASK_FREE_TEXT_PLANNING_LEAF } from "@/lib/guardrail-registrations";
import { runTaskReflection } from "@/lib/loops/task-reflection";
import { nextEscalationRung } from "@/lib/escalation-ladder";
import { evaluateMonitoringRules } from "@/lib/monitoring-engine";
// Priority 5 (10-priority5-software-orchestrator-tracker.yaml, dispatch
// agent 2): the Software Orchestrator's classification decision + the
// capability-memory CRUD layer it's built on. classifyExecutionWithReliability
// is the pure X/Y/A/B decision (see software-coverage-service.ts's header);
// the rest are capability-learning-service.ts's find-or-create/lookup/write
// primitives, reused as-is rather than duplicated here.
import { classifyExecutionWithReliability } from "@/lib/services/software-coverage-service";
import {
  findOrCreateCapability, findApprovedPackage, recordExecutionOutcome, recordPackageUsage,
  type TaskCapability, type InstructionPackage,
} from "@/lib/services/capability-learning-service";
// Priority 12 (OPEN-07 point 1): the Dynamic-Chain/Chat -> FDE side of the
// cross-catalog bridge -- see capability-bridge-service.ts's own header.
import { findFdeMatchesForCapability } from "@/lib/services/capability-bridge-service";
import { resolvePackageVariablesOrThrow, MissingInformationError } from "@/lib/services/package-variable-resolver";
// Priority 6 (UMR <-> Software Orchestrator integration): NOVEL-classified
// tasks get one more check against the Universal Metadata Registry before
// falling through to free-text AI planning -- queryByKeywords() is the
// tsvector-GIN-backed search asset-query-service.ts exposes (see that
// file's own header), reused as-is here rather than duplicated.
// buildNovelUmrHint() is the pure decision half (see its own comment,
// below the executeTask() call site that uses it) -- kept in this file
// rather than asset-query-service.ts/asset-routing-engine.ts since it's
// specific to how task-execution-engine.ts phrases a planning-prompt hint,
// not a generic UMR query concern.
import { queryByKeywords, type PlatformAsset } from "@/lib/services/asset-query-service";
// VCEL Calculation Auditability + Version Control (VERIDIAN Review
// Framework gap closure, 2026-07-18): invokeEngine() is the thin
// invoke-and-audit wrapper every engine dispatch now goes through (see
// engine-invocation.ts's own header); CalculationBreakdown is the optional
// step-by-step shape an engine's output may carry (breakdown.ts).
import { invokeEngine } from "@/lib/engines/engine-invocation";
import type { CalculationBreakdown } from "@/lib/engines/breakdown";
import type { CalculationMessage } from "@/lib/structured-message";
// dispatchTool()/dispatchEngine() (Wave 4's original tool/engine
// dispatchers) were split out to their own modules for file-size/
// responsibility reasons (this file was ~2583 lines) -- see
// tool-dispatch.ts's and engine-dispatch.ts's own header comments. Both are
// still called from inside this file (executeStructuredDispatch,
// executeEngineDispatch, and the free-text planning loop below), so both
// need a real local import; dispatchTool is additionally re-exported below
// so its two external call sites (services/fde-service.ts,
// app/api/v1/projexa/assistant/route.ts) don't need to change their import
// path.
import { dispatchTool } from "@/lib/services/task-execution/tool-dispatch";
export { dispatchTool } from "@/lib/services/task-execution/tool-dispatch";
import { dispatchEngine } from "@/lib/services/task-execution/engine-dispatch";

registerAllGuardrails();

/**
 * Real task execution engine (Wave 4's biggest remaining gap): given a
 * freshly-created task, asks the LLM to break it into a short plan against
 * the org's actual worker agent roster, records that plan, and -- for the
 * handful of global read-only agents this engine knows how to actually run
 * (see DISPATCHABLE_TOOLS below) -- executes them for real against the
 * org's real data and records the output. Posts a one-message summary to
 * the task's chat and marks the task completed/failed.
 *
 * Deliberately read-only: a free-text task's LLM-generated plan is not a
 * trustworthy source of arguments for a *write* action (create/update a
 * real compliance item) without a human confirming first, so only the
 * read-only global agents are auto-dispatched. Plan steps referencing any
 * other agent (write tools, customer/client/user-tier agents) are still
 * recorded as a real row in task_execution_plan, just not auto-invoked --
 * this is disclosed in the /orchestra UI rather than silently faked.
 *
 * Failure is handled gracefully at every level -- a failed dispatch marks
 * that one step failed without failing the whole task, and an LLM/config
 * error marks the task `failed` with an explanatory chat message rather
 * than leaving it silently stuck in `pending` forever.
 *
 * Wave 77 (AI_OS_CERTIFICATION.md §1.1): when the task carries an
 * assistantId, this is now the first real consumer of assistant_memories --
 * relevant memories are vector-searched and injected into the planning
 * prompt, and a new memory is recorded summarizing the outcome, closing the
 * write-then-read loop for that assistant's future tasks.
 */

// Structured dispatch: the worker agent is already known (a human clicked it
// via the chain selector, re-verified server-side in task-service.ts), so
// there's no LLM discretion to guard against -- deliberately does NOT run
// isToolAllowedForDomain() here (that allowlist exists to stop an LLM from
// picking an inappropriate tool; it has nothing to check when a human
// already picked the exact tool by name). The free-text/LLM-planning path
// below is completely unchanged and still enforces it.
// Wave 172 (area 12 "Loop Engineering", remaining_work item 1): the single
// real touchpoint every tasks.status -> 'completed'/'failed' transition now
// goes through -- there were 3 separate inline `db.update(tasks).set(...)`
// call sites (structured dispatch, engine dispatch, free-text LLM planning)
// plus markTaskOutcome's own, all writing the same terminal transition with
// no shared hook. Takes the already-open tx (never opens a second
// withTenantContext -- see task-reflection.ts's own header for why nesting
// would just race a second pooled connection for no reason). elapsedMs is
// derived from the task's own created_at, returned by the same UPDATE
// statement -- zero extra queries.
async function updateTaskStatusAndReflect(
  db: TenantDb,
  orgId: string,
  taskId: string,
  status: "completed" | "failed",
  failureReason?: string | null
): Promise<void> {
  const [row] = await db
    .update(tasks)
    .set({ status, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning({ createdAt: tasks.createdAt, title: tasks.title, dynamicChainId: tasks.dynamicChainId });
  if (!row) return;
  const elapsedMs = Date.now() - row.createdAt.getTime();
  await runTaskReflection(db, {
    orgId,
    sourceType: "task",
    sourceId: taskId,
    outcome: status === "completed" ? "success" : "failure",
    summary: row.title,
    failureReason: failureReason ?? null,
    elapsedMs,
  });
  if (row.dynamicChainId) {
    await enforceChainMonitoringRules(db, taskId, row.dynamicChainId, elapsedMs);
    if (status === "completed") {
      await recordChainWorkerAgentEdges(db, orgId, taskId, row.dynamicChainId);
    }
  }
}

// GAP-DCMD (Priority 10, next real slice after Wave 173's approval-workflow
// edge, PR #227): the second real entity_relationships graph edge type for
// dynamic_chains -- `dynamic_chain -> worker_agent`, relationshipType
// 'executed_by'. This is what turns "which chains has this agent executed"
// from an unanswerable question into a real, already-exposed query: GET
// /api/v1/brain/entity-relationships?entityType=worker_agent&entityId=<id>
// (entity-relationships/route.ts, built Wave 153) calls getNeighbors(),
// which is generic over relationshipType -- no new API surface needed, this
// migration-free change alone makes the existing endpoint answer a question
// it couldn't before.
//
// Hooked into the same chokepoint as enforceChainMonitoringRules above
// (updateTaskStatusAndReflect, called from every real completion path:
// executeStructuredDispatch, executeEngineDispatch, and the free-text
// planning path) so it fires no matter which dispatch branch a chain-
// selected task took, without duplicating call sites. Only runs on
// "completed" (not "failed") -- an agent that failed a task didn't
// meaningfully execute the chain's work, so recording 'executed_by' would
// overstate what happened.
//
// Deliberately an upsert-by-(chain,agent) pair, not one row per task
// completion: unlike the approval edge (whose target -- a specific
// approval_workflow_instance -- is unique per edge), the same agent will
// legitimately complete the same chain many times, and a fresh row per
// completion would flood the graph with duplicates that answer nothing new.
// metadata.taskCount/lastTaskId/lastExecutedAt accumulate on the single
// edge instead, mirroring this file's own established
// find-then-insert-or-update discipline (see approvalPreferences' schema
// comment for the same reasoning applied elsewhere in this codebase).
// Wrapped in try/catch, matching recordChainTriggeredApprovalEdge's
// non-fatal precedent -- a graph-edge write failing must never fail the
// task completion it's attached to.
async function recordChainWorkerAgentEdges(db: TenantDb, orgId: string, taskId: string, dynamicChainId: string): Promise<void> {
  try {
    const steps = await db
      .selectDistinct({ workerAgentId: taskExecutionPlan.workerAgentId })
      .from(taskExecutionPlan)
      .where(and(eq(taskExecutionPlan.taskId, taskId), sql`${taskExecutionPlan.workerAgentId} IS NOT NULL`));

    const now = new Date();
    for (const { workerAgentId } of steps) {
      if (!workerAgentId) continue;
      const existing = await db.query.entityRelationships.findFirst({
        where: and(
          eq(entityRelationships.orgId, orgId),
          eq(entityRelationships.sourceType, "dynamic_chain"),
          eq(entityRelationships.sourceId, dynamicChainId),
          eq(entityRelationships.targetType, "worker_agent"),
          eq(entityRelationships.targetId, workerAgentId),
          eq(entityRelationships.relationshipType, "executed_by"),
        ),
      });
      if (existing) {
        const prevCount = typeof (existing.metadata as { taskCount?: number } | null)?.taskCount === "number"
          ? (existing.metadata as { taskCount: number }).taskCount
          : 1;
        await db.update(entityRelationships)
          .set({
            metadata: { taskCount: prevCount + 1, lastTaskId: taskId, lastExecutedAt: now.toISOString() },
            updatedAt: now,
          })
          .where(eq(entityRelationships.id, existing.id));
      } else {
        await db.insert(entityRelationships).values({
          orgId,
          sourceType: "dynamic_chain",
          sourceId: dynamicChainId,
          targetType: "worker_agent",
          targetId: workerAgentId,
          relationshipType: "executed_by",
          metadata: { taskCount: 1, lastTaskId: taskId, lastExecutedAt: now.toISOString() },
        });
      }
    }
  } catch (err) {
    console.error(`[task-execution-engine] Failed to record dynamic_chain->worker_agent graph edge(s) for chain ${dynamicChainId}, task ${taskId}:`, err);
  }
}

// tree4-unified/50-completion-plan area 6 remaining_work ("Per-Dynamic-Chain
// monitoring rules ENFORCEMENT layer"): the one real chain-scoped task-
// completion chokepoint -- updateTaskStatusAndReflect above is called from
// every real completion path (executeStructuredDispatch, executeEngineDispatch,
// the free-text planning path, and markTaskOutcome's early-failure path), so
// wiring here covers a chain-selected task no matter which dispatch branch
// it took. Skipped entirely for the majority of tasks that carry no
// dynamicChainId (no chain selected) -- zero extra queries for them.
async function enforceChainMonitoringRules(db: TenantDb, taskId: string, dynamicChainId: string, elapsedMs: number): Promise<void> {
  const chain = await db.query.dynamicChains.findFirst({
    where: eq(dynamicChains.id, dynamicChainId),
    columns: { monitoringRules: true },
  });
  if (!chain?.monitoringRules) return;

  const [{ count: completedStepCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(taskExecutionPlan)
    .where(and(eq(taskExecutionPlan.taskId, taskId), eq(taskExecutionPlan.status, "completed")));

  const violations = evaluateMonitoringRules(chain.monitoringRules, { durationMs: elapsedMs, completedStepCount });
  for (const violation of violations) {
    if (violation.action === "escalate") {
      const escalation = nextEscalationRung({ reason: "monitoring_rule_violation" });
      await db.insert(taskChatMessages).values({
        taskId,
        role: "system",
        content: `Monitoring rule violated (${violation.metric} = ${violation.actualValue}) -- escalated to ${escalation.title} (${escalation.authority}).`,
      });
    } else {
      await db.insert(taskChatMessages).values({
        taskId,
        role: "system",
        content: `Monitoring rule warning: ${violation.metric} = ${violation.actualValue} is outside the chain's declared bounds.`,
      });
    }
  }
}

async function executeStructuredDispatch(orgId: string, userId: string, taskId: string, workerAgentId: string, agentInputs?: Record<string, unknown>): Promise<void> {
  await withTenantContext({ orgId, userId }, async (db) => {
    const agent = await db.query.workerAgents.findFirst({ where: eq(workerAgents.id, workerAgentId) });
    if (!agent?.codeReference || agent.tier !== "global" || !["approved", "published"].includes(agent.lifecycleStatus)) {
      await db.insert(taskChatMessages).values({ taskId, role: "system", content: "The selected capability is no longer available. Please try again." });
      await updateTaskStatusAndReflect(db, orgId, taskId, "failed", "The selected capability is no longer available.");
      return;
    }

    const [planRow] = await db.insert(taskExecutionPlan).values({
      taskId, stepNumber: 1, workerAgentId: agent.id, description: agent.name, status: "completed",
    }).returning();

    const startedAt = new Date();
    try {
      const output = await dispatchTool(db, orgId, userId, agent.codeReference, { taskId, inputs: agentInputs });
      assertValidDispatchOutput(output);
      await db.insert(taskAgentExecutions).values({
        taskExecutionPlanId: planRow.id, workerAgentId: agent.id, startedAt, completedAt: new Date(),
        status: "completed", input: {}, output: output as object,
      });
      await db.insert(taskChatMessages).values({
        taskId, role: "assistant", content: `${agent.name}: ${JSON.stringify(output).slice(0, 800)}`,
      });
      await updateTaskStatusAndReflect(db, orgId, taskId, "completed");
    } catch (dispatchErr) {
      const message = dispatchErr instanceof Error ? dispatchErr.message : "unknown error";
      // tree4-unified/50-completion-plan area 3 "Guardrails", PLAN-16
      // re-scoped item (e) "Tool Usage as a distinct check" (Guardrail 13:
      // "if a tool fails: retry per policy or escalate"): executeEngineDispatch's
      // catch block below already escalates via nextEscalationRung() (Wave
      // 171, area 8's resolution_note) -- this was the other real dispatch-
      // failure path with no equivalent, a real parity gap, not a
      // hypothetical one. "worker_agent_unavailable" is the exact
      // escalation-ladder.ts reason this shape maps to (a structured-dispatch
      // tool call that failed), and it's software-first (starts at CSEO),
      // matching engine-dispatch failures' own reasoning.
      const escalation = nextEscalationRung({ reason: "worker_agent_unavailable" });
      await db.insert(taskChatMessages).values({ taskId, role: "system", content: `${agent.name} couldn't complete: ${message} -- escalated to ${escalation.title} (${escalation.authority}).` });
      await updateTaskStatusAndReflect(db, orgId, taskId, "failed", message);
    }
  });
}

// Calculation Explainability (VERIDIAN Review Framework gap closure,
// 2026-07-18): true only for the representative statutory engines that
// were given a real `breakdown` field (income tax, GST split, gratuity,
// TDS -- see breakdown.ts's own header for which). Every other engine's
// output is untouched by this check and falls through to the pre-existing
// plain "Result: {...}" chat message, exactly as before this gap closure.
function extractBreakdown(output: unknown): CalculationBreakdown | null {
  if (!output || typeof output !== "object" || !("breakdown" in output)) return null;
  const breakdown = (output as { breakdown?: unknown }).breakdown;
  if (!breakdown || typeof breakdown !== "object" || !Array.isArray((breakdown as { steps?: unknown }).steps)) return null;
  return breakdown as CalculationBreakdown;
}

// camelCase engine-result key -> "Title Case" label, e.g. "grossTax" ->
// "Gross Tax". Pure string formatting, no engine-specific knowledge.
function humanizeResultKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

async function executeEngineDispatch(orgId: string, userId: string, taskId: string, engineKey: string, engineInputs: Record<string, unknown>): Promise<void> {
  await withTenantContext({ orgId, userId }, async (db) => {
    try {
      const output = await invokeEngine(
        db, { orgId, userId, taskId }, engineKey,
        (inputs: Record<string, unknown>) => dispatchEngine(db, orgId, userId, engineKey, inputs),
        engineInputs
      );
      assertValidDispatchOutput(output);
      const breakdown = extractBreakdown(output);
      if (breakdown) {
        const engineRow = await db.query.computationEngines.findFirst({
          where: eq(computationEngines.engineKey, engineKey),
          columns: { name: true, engineVersion: true },
        });
        const result = Object.entries(output as Record<string, unknown>)
          .filter(([key]) => key !== "breakdown")
          .map(([key, value]) => ({ label: humanizeResultKey(key), value: String(value) }));
        const structured: CalculationMessage = {
          type: "calculation", engineName: engineRow?.name ?? engineKey, engineVersion: engineRow?.engineVersion,
          result, steps: breakdown.steps,
        };
        await db.insert(taskChatMessages).values({ taskId, role: "assistant", content: JSON.stringify(structured) });
      } else {
        await db.insert(taskChatMessages).values({ taskId, role: "assistant", content: `Result: ${JSON.stringify(output)}` });
      }
      await updateTaskStatusAndReflect(db, orgId, taskId, "completed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      // tree4-unified area 8's last open item (D3.B2.S1): "when software-
      // first execution needs help" -- a VCEL engine either has no
      // dispatcher (dispatchEngine's own default throw, "No engine
      // dispatcher implemented for ...") or threw mid-calculation. Both
      // are software-first execution failures per escalation-ladder.ts's
      // own reason taxonomy, so both start at CSEO, not COO.
      const escalation = nextEscalationRung({
        reason: message.startsWith("No engine dispatcher implemented for") ? "engine_not_found" : "engine_execution_failed",
      });
      await db.insert(taskChatMessages).values({ taskId, role: "system", content: `Calculation failed: ${message} -- escalated to ${escalation.title} (${escalation.authority}).` });
      await updateTaskStatusAndReflect(db, orgId, taskId, "failed", message);
    }
  });
}

// Priority 5: resolves the taskCapabilities row this task's own Dynamic
// Chain selection maps to, if it has one. A capability is identified by
// (modePill, pathKeys) -- both live on the dynamic_chains row a task's
// dynamicChainId points at (see task-service.ts's resolveDynamicChainId(),
// the same dedup convention findOrCreateCapability() mirrors). Tasks
// created outside VeriComposer's Chain Selector (free-text/API-created --
// crm-service.ts/email-intelligence-service.ts/veri-meeting-service.ts's
// own executeTask() calls all pass no chain selection at all) simply have
// no dynamicChainId; this returns null for them rather than forcing a
// capability onto a task that never had a real chain selection behind it,
// per the tracker's own scope note for this dispatch. Never throws --
// capability tracking is a secondary learning signal, not something that
// should ever block real task execution.
async function resolveTaskCapability(orgId: string, userId: string, taskId: string, promptText: string): Promise<TaskCapability | null> {
  try {
    const task = await withTenantContext({ orgId, userId }, (db) =>
      db.query.tasks.findFirst({ where: eq(tasks.id, taskId), columns: { dynamicChainId: true } })
    );
    if (!task?.dynamicChainId) return null;

    const chain = await withTenantContext({ orgId, userId }, (db) =>
      db.query.dynamicChains.findFirst({ where: eq(dynamicChains.id, task.dynamicChainId!), columns: { modePill: true, pathKeys: true } })
    );
    if (!chain?.modePill || !Array.isArray(chain.pathKeys) || chain.pathKeys.length === 0) return null;

    // Deliberately orgId: null -- capability LEARNING is platform-wide by
    // design (capability-learning-service.ts's own header comment), not
    // scoped to the org that happened to trigger this particular task.
    const capability = await findOrCreateCapability({ modePill: chain.modePill, pathKeys: chain.pathKeys as string[], promptText, orgId: null });

    // Priority 12 (OPEN-07 point 1, GAP-FDE-CHAIN-INTAKE-SPLIT): the
    // Dynamic-Chain/Chat -> FDE side of the cross-catalog bridge (see
    // capability-bridge-service.ts's own header for the full design). Never
    // awaited into the return value and never blocking -- this is a
    // logging-only signal so a strong FDE match is visible in server logs
    // (surfacing it to the requester itself would need a return-shape
    // change that ripples through every caller of resolveTaskCapability(),
    // out of scope for a same-request-cycle learning signal). Real callers
    // needing the match data directly (e.g. an admin UI) should call
    // findFdeMatchesForCapability() themselves rather than parsing logs.
    void findFdeMatchesForCapability(capability, orgId, 3)
      .then((matches) => {
        const strongMatch = matches.find((m) => m.score >= 0.9 && m.entityType !== "dynamic_chain")
        if (strongMatch) {
          console.warn(`[capability-bridge] Capability "${capability.capabilityKey}" has a strong existing VERI FDE match: ${strongMatch.entityType} ${strongMatch.entityId} (${Math.round(strongMatch.score * 100)}%) -- consider reusing it instead of treating this as a novel gap.`);
        }
      })
      .catch(() => {}); // findFdeMatchesForCapability already degrades internally; this catch is belt-and-suspenders only.

    return capability;
  } catch (err) {
    console.error("Priority 5: resolveTaskCapability failed, continuing without capability tracking:", err);
    return null;
  }
}

export type PackageDispatchOutcome =
  | { status: "completed"; output: string }
  | { status: "missing_information"; missingVariables: string[] }
  | { status: "failed"; error: string };

// Priority 5's "Lower AI" executor -- the army-agent counterpart to
// executeStructuredDispatch()/executeEngineDispatch() above, run when
// classifyExecutionWithReliability() returns PACKAGE_AVAILABLE. Builds its
// prompt from ONLY the approved package's own `steps` + `requiredVariables`
// -- deliberately NEVER the user's raw original title/description text --
// because the whole point of an approved instruction package is a narrow,
// foolproof, pre-written script a cheap model executes without
// re-reasoning, not a second free-text planning call with extra
// scaffolding. The task's title/description are read ONLY to resolve
// requiredVariables' concrete values, via package-variable-resolver.ts's
// explicit "key: value" extraction (never LLM-guessed). If any required
// variable has no resolvable value, resolvePackageVariablesOrThrow() throws
// MissingInformationError and this returns { status: "missing_information" }
// immediately -- a hard rule from the tracker's spec: there is no code path
// here that lets the model improvise a missing variable's value.
async function executePackageDispatch(
  orgId: string, userId: string, taskId: string,
  pkg: InstructionPackage, taskInput: { title: string; description: string | null }
): Promise<PackageDispatchOutcome> {
  return withTenantContext({ orgId, userId }, async (db) => {
    const [planRow] = await db.insert(taskExecutionPlan).values({
      taskId, stepNumber: 1, workerAgentId: null,
      description: `Approved instruction package (v${pkg.version})`, status: "completed",
    }).returning();

    const startedAt = new Date();
    const sourceText = `${taskInput.title}\n${taskInput.description ?? ""}`;

    try {
      const requiredVariables = (pkg.requiredVariables as string[] | null) ?? [];
      const resolvedVariables = resolvePackageVariablesOrThrow(requiredVariables, sourceText);

      // Same policy chokepoint the free-text path enforces (Wave 46) --
      // even a narrow, pre-approved script's rendered steps pass through
      // it before any provider call, so a package can never become a
      // silent bypass of the Policy Enforcement Engine.
      const policyDecision = enforcePolicy(
        { orgId, userId, domain: DEFAULT_DOMAIN, layerKey: "task_oa", eventType: "task_execution.package_dispatch" },
        JSON.stringify(pkg.steps).slice(0, 4000)
      );
      if (!policyDecision.allowed) throw new Error(refusalMessageFor(policyDecision));

      // GAP-OCID038-TASKENGINE-MOTHERROUTER-UNWIRED fix (2026-08-04): resolves
      // through Mother Router's end_user_org scope instead of calling
      // orchestra-model-resolver.ts's resolveModelConfig() directly -- the
      // exact same incremental-migration pattern orchestrate/route.ts already
      // proved out for the same "task_oa" layer (see that route's own
      // "Phase 9 ... crossed Gateway G05 for real" comment). Internally still
      // calls the same resolveModelConfig() for the baseline (customer BYO
      // config, cost-guard, source-type overrides all unchanged) and returns
      // it via resolvedConfig -- this is additive (real ai_routing_audit_log
      // coverage + any active end_user_org routing policy override), never a
      // behavior change for a BYO-configured org (computeEndUserOrgResolution
      // returns the baseline untouched whenever isCustomerConfigured is true).
      const modelConfig = (await resolveMotherRouterModel({ scope: "end_user_org", orgId, layerKey: "task_oa" })).resolvedConfig ?? null;
      if (!modelConfig) throw new Error("No LLM provider is configured for this organisation (task_oa layer).");

      const systemPrompt =
        `${buildPurposeClause(DEFAULT_DOMAIN)}\n\n` +
        "You are executing a single pre-approved, narrow instruction package. " +
        "Follow ONLY the numbered steps below, using ONLY the variable values provided. " +
        "Do not reason beyond what is written, and do not use any information beyond the steps and variables given. " +
        'Respond with JSON: {"result": string} where result is the final message to report back to the user.';
      const userMessage = `Steps:\n${JSON.stringify(pkg.steps, null, 2)}\n\nVariables:\n${JSON.stringify(resolvedVariables, null, 2)}`;

      let effectiveConfig = modelConfig;
      const callPackage = () => callLLMJson<{ result: string }>(
        effectiveConfig.provider, effectiveConfig.model, effectiveConfig.apiKey,
        systemPrompt, userMessage, { temperature: 0.1, maxTokens: 500, enablePromptCache: true }, effectiveConfig.fallback
      );
      let { data, usage } = await callPackage();

      // Reactive safety net, kept as a SECONDARY gate here (per the
      // tracker's scope decision on proactive vs. reactive escalation):
      // this dispatch runs the floor tier by design -- that's the whole
      // point of the cheap/A% bucket -- but a package execution that still
      // hedges mid-flight gets one retry on the escalated model, the same
      // post-call signal the free-text path used to rely on as its ONLY
      // gate before this dispatch's proactive-gating change below.
      if (!modelConfig.isCustomerConfigured) {
        const lowConfidence = detectLowConfidenceResponse(data.result ?? "");
        if (lowConfidence.detected) {
          const escalated = await escalatedPlatformConfig();
          if (escalated) {
            effectiveConfig = escalated;
            ({ data, usage } = await callPackage());
          }
        }
      }

      assertValidDispatchOutput({ result: data.result });

      await db.insert(taskAgentExecutions).values({
        taskExecutionPlanId: planRow.id, workerAgentId: null, startedAt, completedAt: new Date(),
        status: "completed", input: resolvedVariables, output: { result: data.result },
      });
      await db.insert(taskChatMessages).values({ taskId, role: "assistant", content: data.result });
      await updateTaskStatusAndReflect(db, orgId, taskId, "completed");
      recordOrchestraExecution({
        orgId, userId, taskId, layerKey: "task_oa", eventType: "task_execution.package_dispatch",
        input: { packageId: pkg.id, variables: resolvedVariables },
        output: { result: data.result },
        status: "completed", durationMs: Date.now() - startedAt.getTime(),
        provider: effectiveConfig.provider, model: effectiveConfig.model, usage,
      });
      return { status: "completed", output: data.result };
    } catch (err) {
      if (err instanceof MissingInformationError) {
        await db.insert(taskAgentExecutions).values({
          taskExecutionPlanId: planRow.id, workerAgentId: null, startedAt, completedAt: new Date(),
          status: "failed", input: {}, errorMessage: err.message,
        });
        const message = `I don't have enough information to complete this using the approved process. Missing: ${err.missingVariables.join(", ")}. Please add these details and resave the task.`;
        await db.insert(taskChatMessages).values({ taskId, role: "system", content: message });
        await updateTaskStatusAndReflect(db, orgId, taskId, "failed", message);
        return { status: "missing_information", missingVariables: err.missingVariables };
      }

      const message = err instanceof Error ? err.message : "unknown error";
      await db.insert(taskAgentExecutions).values({
        taskExecutionPlanId: planRow.id, workerAgentId: null, startedAt, completedAt: new Date(),
        status: "failed", input: {}, errorMessage: message,
      });
      const escalation = nextEscalationRung({ reason: "package_execution_failed" });
      await db.insert(taskChatMessages).values({
        taskId, role: "system",
        content: `Instruction package execution failed: ${message} -- escalated to ${escalation.title} (${escalation.authority}).`,
      });
      await updateTaskStatusAndReflect(db, orgId, taskId, "failed", message);
      return { status: "failed", error: message };
    }
  });
}

// Escalation signal (2026-07-10, founder directive): two distinct "this
// needs a stronger model" proxies, both mapped onto the same
// checkPreCallEscalation() `priorTaskFailed` input floor-tier-escalation.ts
// already exposes -- no need to widen that shared function's shape for a
// task-specific concept.
// 1. THIS task already has a system message recording a past failure --
//    the concrete "task edit by end user" case the founder named: the
//    existing recovery instruction ("You can retry by editing and
//    resaving the task", line ~857 below) means a re-run of a
//    previously-failed task IS the edit flow, not a separate thing to
//    detect differently.
// 2. A DIFFERENT recent task by this same user failed -- same rationale as
//    chat-service.ts's checkRecentTaskFailure: a user in the middle of a
//    rough patch is worth a stronger model, not just the one task that
//    already failed.
const RECENT_TASK_FAILURE_WINDOW_MS = 10 * 60 * 1000

async function checkTaskEscalationContext(orgId: string, userId: string, taskId: string): Promise<{ priorTaskFailed: boolean; priorMessageCount: number }> {
  return withTenantContext({ orgId, userId }, async (db) => {
    const priorMessages = await db.query.taskChatMessages.findMany({
      where: eq(taskChatMessages.taskId, taskId),
      columns: { id: true, role: true },
    })
    const hasPriorFailureMessage = priorMessages.some((m) => m.role === "system")
    if (hasPriorFailureMessage) return { priorTaskFailed: true, priorMessageCount: priorMessages.length }

    const recentOtherTask = await db.query.tasks.findFirst({
      where: and(eq(tasks.orgId, orgId), eq(tasks.userId, userId), ne(tasks.id, taskId)),
      orderBy: (t, { desc }) => desc(t.updatedAt),
      columns: { status: true, updatedAt: true },
    })
    const otherTaskFailedRecently = Boolean(
      recentOtherTask?.status === "failed" && Date.now() - recentOtherTask.updatedAt.getTime() < RECENT_TASK_FAILURE_WINDOW_MS
    )
    return { priorTaskFailed: otherTaskFailedRecently, priorMessageCount: priorMessages.length }
  })
}

// Priority 6 (UMR <-> Software Orchestrator integration): pure decision
// over an already-fetched UMR query result set -- does the top match
// warrant surfacing to the free-text planner as a hint? Deliberately
// content-free about WHY a hint is or isn't warranted beyond "is there any
// active asset at all" -- queryByKeywords() already ranks by ts_rank, so
// the first active row is the strongest textual match in the set, and this
// function's only job is turning that into planning-prompt text, never a
// decision that blocks or redirects execution (see the executeTask() call
// site: umrHint is appended to userMessage, nothing else). Returns null
// when there's nothing worth surfacing (no matches, or every match is
// draft/archived/deleted).
export function buildNovelUmrHint(matches: PlatformAsset[]): string | null {
  const top = matches.find((a) => a.status === "active");
  if (!top) return null;
  return `Note: the Universal Metadata Registry lists a possibly related platform asset already: "${top.name}" (${top.assetType}, asset ${top.assetId}${top.purpose ? `, purpose: ${top.purpose}` : ""}). This is a hint only -- verify it actually applies before relying on it, and proceed with the plan below regardless of whether it does.`;
}

export async function executeTask(
  orgId: string,
  userId: string,
  taskId: string,
  title: string,
  description: string | null,
  projectId?: string | null,
  assistantId?: string | null,
  // Structured (non-LLM) dispatch: set when this task came from a completed
  // VERI Chat chain selection rather than free text. resolvedWorkerAgentId
  // (already re-verified by task-service.ts) skips straight to dispatchTool;
  // engineKey/engineInputs do the same for a VCEL calculator leaf. Either
  // path means zero LLM calls and zero orchestra_executions cost row --
  // the whole point of a structured selection over typed prose.
  resolvedWorkerAgentId?: string | null,
  engineKey?: string,
  engineInputs?: Record<string, unknown>,
  agentInputs?: Record<string, unknown>
): Promise<void> {
  // Priority 5 (10-priority5-software-orchestrator-tracker.yaml): resolved
  // ONCE, up front, so every branch below -- including the two pre-existing
  // deterministic ones -- can record its real classification outcome into
  // the capability's rolling FULL_SOFTWARE/PACKAGE_AVAILABLE/NOVEL counters
  // (capability-learning-service.ts's recordExecutionOutcome()). Returns
  // null (a no-op for every recordExecutionOutcome call below) for the
  // large majority of tasks that carry no dynamicChainId at all -- see
  // resolveTaskCapability()'s own header.
  const capability = await resolveTaskCapability(orgId, userId, taskId, `${title}\n${description ?? ""}`);

  if (engineKey) {
    await executeEngineDispatch(orgId, userId, taskId, engineKey, engineInputs ?? {});
    // engineKey being set at all IS the FULL_SOFTWARE case (a VCEL
    // calculator leaf a human picked by clicking) -- recorded regardless of
    // whether the calculation itself succeeded or failed at runtime, since
    // the classification question is "was AI needed for this dispatch",
    // not "did the dispatch succeed."
    if (capability) await recordExecutionOutcome(capability.id, "FULL_SOFTWARE").catch((err) => console.error("Priority 5: recordExecutionOutcome failed:", err));
    return;
  }
  if (resolvedWorkerAgentId) {
    await executeStructuredDispatch(orgId, userId, taskId, resolvedWorkerAgentId, agentInputs);
    if (capability) await recordExecutionOutcome(capability.id, "FULL_SOFTWARE").catch((err) => console.error("Priority 5: recordExecutionOutcome failed:", err));
    return;
  }

  try {
    // Wave 159 (VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md, Objective/
    // Instruction Validation Guardrails extended to customer tasks): before
    // even checking policy, confirm there's enough here to plan against at
    // all -- a task with a one-word title and no description forces the
    // LLM below to invent a plan from almost nothing, the same failure
    // shape as an under-specified AI-dispatch brief (task-tightening.ts).
    // Lighter than the AI Dev Team's TightTask schema (see
    // validateTaskBrief()'s own header for why), but a real, blocking gate
    // -- not just documentation.
    const briefCheck = evaluateGuardrails(TASK_FREE_TEXT_PLANNING_LEAF, "input", { title, description });
    if (!briefCheck.passed) {
      void recordGuardrailViolation(taskId, TASK_FREE_TEXT_PLANNING_LEAF, "input", briefCheck);
      await markTaskOutcome(orgId, userId, taskId, "failed", `${briefCheck.reason} ${briefCheck.guidance}`);
      return;
    }

    // Gap closure, 2026-07-09 (AUDIT_2026-07-09.md, Agent Framework section):
    // this free-text planning call -- exactly the entry point the
    // Constitution's Policy Enforcement Engine (Wave 46) exists to guard --
    // had never actually been wired to it. Checked before resolveModelConfig
    // so a denied request never reaches a provider or costs a token.
    const policyDecision = enforcePolicy(
      { orgId, userId, domain: DEFAULT_DOMAIN, layerKey: "task_oa", eventType: "task_execution.planning" },
      `${title}\n${description ?? ""}`
    );
    if (!policyDecision.allowed) {
      await markTaskOutcome(orgId, userId, taskId, "failed", refusalMessageFor(policyDecision));
      return;
    }

    // Priority 5 classification step -- BEFORE the free-text LLM planning
    // call below. alreadyFullSoftware is always false here (the engineKey/
    // resolvedWorkerAgentId branches above are the FULL_SOFTWARE case and
    // already returned); this only decides what happens for the genuine
    // remainder. An approved, RELIABLE (isPackageReliable()) instruction
    // package routes to Lower AI's executePackageDispatch() instead of an
    // LLM planning call; no capability match or no approved/reliable
    // package routes to NOVEL, which falls through to the existing
    // free-text path completely unchanged below (other than the proactive
    // floor-tier gating change also in this dispatch -- see the escalation
    // block further down).
    let approvedPackage: InstructionPackage | null = null;
    if (capability) {
      approvedPackage = await findApprovedPackage(capability.id, "task_execution").catch((err) => {
        console.error("Priority 5: findApprovedPackage failed, continuing without a package:", err);
        return null;
      });
    }
    const classification = classifyExecutionWithReliability({ alreadyFullSoftware: false, approvedPackage });

    if (classification.bucket === "PACKAGE_AVAILABLE") {
      const outcome = await executePackageDispatch(orgId, userId, taskId, classification.package, { title, description });
      if (capability) {
        await recordExecutionOutcome(capability.id, "PACKAGE_AVAILABLE").catch((err) => console.error("Priority 5: recordExecutionOutcome failed:", err));
        await recordPackageUsage(classification.package.id, outcome.status === "completed").catch((err) => console.error("Priority 5: recordPackageUsage failed:", err));
      }
      return;
    }

    // NOVEL -- recorded now, at classification-decision time rather than
    // strictly after the free-text plan below finishes: the classification
    // itself ("no reliable package exists for this capability yet") is
    // already final at this point, and recording it here means a crash
    // further down in the LLM planning call still leaves an accurate
    // rolling count rather than silently under-reporting NOVEL. Mirrors the
    // FULL_SOFTWARE branches above, which also record before knowing
    // whether their own dispatch will succeed.
    if (capability) {
      await recordExecutionOutcome(capability.id, "NOVEL").catch((err) => console.error("Priority 5: recordExecutionOutcome failed:", err));
    }

    // Priority 6 (UMR <-> Software Orchestrator integration): one more
    // check before falling through to free-text AI planning -- does the
    // Universal Metadata Registry (platform_assets) already list a
    // plausibly related asset? Deliberately additive/non-blocking, in the
    // same spirit as MissingInformationError/isPackageReliable() gating
    // above but weaker by design: this NEVER changes control flow or
    // rejects the task, it only surfaces a hint into the planning prompt
    // below (see umrHint's use in userMessage). A UMR query failure is
    // logged and swallowed exactly like every other best-effort lookup in
    // this function (searchAssistantMemories, recordExecutionOutcome) --
    // it must never block a task that would have worked before this check
    // existed.
    let umrHint: string | null = null;
    try {
      const umrMatches = await queryByKeywords({ orgId }, `${title} ${description ?? ""}`.trim());
      umrHint = buildNovelUmrHint(umrMatches);
    } catch (err) {
      console.error("Priority 6: UMR lookup failed for NOVEL-classified task, continuing without a hint:", err);
    }

    // GAP-OCID038-TASKENGINE-MOTHERROUTER-UNWIRED fix (2026-08-04): same
    // Mother Router migration as executePackageDispatch() above -- see that
    // call site's comment for the full rationale.
    const modelConfig = (await resolveMotherRouterModel({ scope: "end_user_org", orgId, layerKey: "task_oa" })).resolvedConfig ?? null;
    if (!modelConfig) {
      await markTaskOutcome(orgId, userId, taskId, "failed", "No LLM provider is configured for this organisation (task_oa layer). Set one up in Settings → AI Configuration.");
      return;
    }

    // Wave 21: agent discovery is now project-scoped, instead of
    // "everything this org has, ≤20 rows, no filter at all". This is part
    // of the concrete mechanism behind "one worker agent, no forking,
    // available across every product/project/account/user -- customized to
    // do work": an agent's optional projectId determines whether it's
    // project-specific or org-wide, the same most-specific-scope-wins
    // philosophy as module-rules-resolver.ts.
    //
    // NOT filtering by worker_agent_domain_index here, despite wiring it up
    // this wave (see proposeWorkerAgent()) -- confirmed directly against
    // live data that workerAgents.domain is a free-text CAPABILITY-PATH
    // taxonomy ("Cross-Cutting > Data Access", "India Compliance > Penalty
    // Calculation"), not the same value space as purpose-bound-ai.ts's
    // single-value DEFAULT_DOMAIN ('compliance'). Filtering discovery by
    // `domainPath = DEFAULT_DOMAIN` would have matched zero of today's real
    // agents -- a regression, not an improvement. Real domain-scoped
    // discovery needs a task-level domain concept that doesn't exist yet;
    // shipping a filter against the wrong value space to make this wave
    // look more complete would be worse than being honest that it's
    // deferred. The domain-index table itself is now genuinely populated
    // (this wave's real, additive progress) and ready for a future wave to
    // consume once tasks carry their own domain/capability-path.
    const { candidates, memories } = await withTenantContext({ orgId, userId }, async (db) => {
      const candidates = await db.query.workerAgents.findMany({
        where: inArray(workerAgents.lifecycleStatus, ["approved", "published"]),
        columns: { id: true, name: true, domain: true, tier: true, codeReference: true, projectId: true },
        orderBy: asc(workerAgents.name),
        limit: 40, // widened from 20 since project-scoped shadowing can mean 2 rows per name
      });
      const memories = assistantId
        ? await searchAssistantMemories(db, assistantId, `${title}\n${description ?? ""}`)
        : [];
      return { candidates, memories };
    });

    // Most-specific-wins: a project-scoped agent shadows an org-wide
    // (projectId IS NULL) agent of the same name, mirroring
    // module-rules-resolver.ts's resolution philosophy.
    const byName = new Map<string, (typeof candidates)[number]>();
    for (const a of candidates) {
      const key = a.name.toLowerCase();
      const existing = byName.get(key);
      if (!existing) { byName.set(key, a); continue; }
      const aIsProjectMatch = projectId && a.projectId === projectId;
      const existingIsProjectMatch = projectId && existing.projectId === projectId;
      if (aIsProjectMatch && !existingIsProjectMatch) byName.set(key, a);
      else if (!aIsProjectMatch && !a.projectId && existing.projectId && !existingIsProjectMatch) byName.set(key, a);
    }
    const agents = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);

    const agentList = agents.map((a) => `- ${a.name} (${a.tier}${a.domain ? `, ${a.domain}` : ""})`).join("\n");
    const systemPromptTemplate = await resolvePromptTemplate("task_execution.planning_system");
    const systemPrompt = systemPromptTemplate.replace("{{PURPOSE_CLAUSE}}", buildPurposeClause(DEFAULT_DOMAIN));
    const memoryBlock = memories.length > 0
      ? `\n\nRelevant memories from this assistant's past work (may or may not apply here):\n${memories.map((m) => `- [${m.category}] ${m.content}`).join("\n")}`
      : "";
    const userMessage = `Task: ${title}\n${description ? `Description: ${description}\n` : ""}\nAvailable agents:\n${agentList || "(none configured yet)"}${memoryBlock}${umrHint ? `\n\n${umrHint}` : ""}`;

    // Escalation (2026-07-10, founder directive): same pattern as
    // chat-service.ts's generateAiReply -- deterministic pre-call signals
    // skip the floor tier entirely for this call; the one post-call signal
    // (the floor tier's own plan summary hedging) retries once on the
    // escalated model only when it fires. See floor-tier-escalation.ts's
    // header for the full "don't self-grade, don't 2x every call" reasoning.
    let effectiveConfig = modelConfig;
    let escalation: { escalated: boolean; signals: EscalationSignal[]; matchedPhrase: string | null; originalModel: string } = {
      escalated: false, signals: [], matchedPhrase: null, originalModel: modelConfig.model,
    };

    if (!modelConfig.isCustomerConfigured) {
      const highImpact = detectHighImpactAction(`${title}\n${description ?? ""}`);
      const { priorTaskFailed, priorMessageCount } = await checkTaskEscalationContext(orgId, userId, taskId);
      const preCall = checkPreCallEscalation({
        userMessage: `${title}\n${description ?? ""}`, historyLength: priorMessageCount,
        isHighImpact: highImpact.isHighImpact, priorTaskFailed,
      });
      // Priority 5 PROACTIVE gating (10-priority5-software-orchestrator-
      // tracker.yaml): this free-text branch is now only ever reached for
      // NOVEL-classified work (the PACKAGE_AVAILABLE case already returned
      // above) -- per the tracker's scope decision, a floor-tier model
      // reasoning freely on a genuinely uncovered capability gap is exactly
      // the unreliable case this whole escalation mechanism exists to
      // avoid, so it now always starts at the judgment tier here instead of
      // waiting for one of checkPreCallEscalation's REACTIVE signals to
      // fire first. Those reactive signals are still computed and folded
      // into the audit trail below (still real, still useful for
      // byo-model-audit.ts's pattern analysis) -- they're just no longer
      // the GATE for this branch. The reactive-only mechanism is not
      // removed: it remains the live gate inside executePackageDispatch()
      // above (the PACKAGE_AVAILABLE path), which runs the floor tier by
      // design and only escalates reactively if a package execution itself
      // hedges mid-flight.
      const escalated = await escalatedPlatformConfig();
      if (escalated) {
        effectiveConfig = escalated;
        escalation = {
          escalated: true,
          signals: [...preCall.signals, "novel_capability"],
          matchedPhrase: preCall.matchedPhrase,
          originalModel: modelConfig.model,
        };
      }
    }

    const planningStartedAt = Date.now();
    type PlanningResult = { summary: string; steps: { agentName: string | null; description: string }[] };
    // Definite-assignment (!): every code path past the try/catch below
    // either assigns both via a successful callPlanning() or throws --
    // TS's narrowing can't see that through the nested retry try/catch.
    let result!: PlanningResult;
    let usage!: Awaited<ReturnType<typeof callLLMJson<PlanningResult>>>["usage"];
    // TASK 1.2 (2026-07-20): systemPrompt here is a DB-stored template
    // (resolvePromptTemplate("task_execution.planning_system")) with only
    // {{PURPOSE_CLAUSE}} substituted -- the exact "resolved+substituted
    // template IS the static prefix boundary" shape callAnthropic's own
    // header describes as the ideal caching case, and this is the real
    // "AI Dev Team dispatch re-sends its full system prompt uncached"
    // call site the Owner's finding named. enablePromptCache is a no-op
    // for providers that don't support this shape (GLM/undocumented,
    // most non-Anthropic OpenRouter models) -- see callOpenAICompatible's
    // own header for exactly which providers this currently helps.
    const callPlanning = () => callLLMJson<PlanningResult>(
      effectiveConfig.provider, effectiveConfig.model, effectiveConfig.apiKey, systemPrompt, userMessage,
      { temperature: 0.3, maxTokens: 800, enablePromptCache: true }, effectiveConfig.fallback
    );
    try {
      ({ data: result, usage } = await callPlanning());
    } catch (err) {
      // PROJEXA load test finding (2026-07-10, PROJEXA_LOAD_TEST_RESULTS.md
      // §4.2): GPT-OSS-120B (a reasoning model) sometimes truncates its JSON
      // answer after spending completion-token budget on hidden
      // chain-of-thought -- callLLMJson's JSON.parse throws a plain
      // SyntaxError in that case. One same-input retry is cheap and usually
      // succeeds since the truncation is a token-budget fluke, not a
      // deterministic failure -- but only for that specific error shape;
      // a network/auth error is retried by callLLMJson's own lower-level
      // machinery already, so retrying it again here would just double a
      // failure that's already final.
      let finalErr = err;
      if (err instanceof SyntaxError) {
        try {
          ({ data: result, usage } = await callPlanning());
          finalErr = null;
        } catch (retryErr) {
          finalErr = retryErr;
        }
      }
      if (finalErr) {
        // PROJEXA load test finding §4.2 (2nd half): ANY planning-call
        // failure that reaches here -- whether the SyntaxError retry above
        // also failed, or the original error wasn't a SyntaxError at all --
        // previously left NO orchestra_executions row (the success path's
        // recordOrchestraExecution() below never runs). Invisible to both
        // cost accounting and failure debugging. Write a best-effort failed
        // row (no token counts available, since the call never completed)
        // before re-throwing to this function's own outer catch, which
        // still handles the task-level "edit and resave" messaging
        // unchanged.
        recordOrchestraExecution({
          orgId, userId, taskId, layerKey: "task_oa", eventType: "task_execution.planning",
          input: { title, description }, status: "failed", durationMs: Date.now() - planningStartedAt,
          provider: effectiveConfig.provider, model: effectiveConfig.model,
          output: { error: finalErr instanceof Error ? finalErr.message : String(finalErr) },
        });
        throw finalErr;
      }
    }

    if (!modelConfig.isCustomerConfigured && !escalation.escalated) {
      const lowConfidence = detectLowConfidenceResponse(result.summary ?? "");
      if (lowConfidence.detected) {
        const escalated = await escalatedPlatformConfig();
        if (escalated) {
          const retried = await callLLMJson<{ summary: string; steps: { agentName: string | null; description: string }[] }>(
            escalated.provider, escalated.model, escalated.apiKey, systemPrompt, userMessage,
            { temperature: 0.3, maxTokens: 800 }, escalated.fallback
          );
          result = retried.data;
          usage = retried.usage;
          effectiveConfig = escalated;
          escalation = { escalated: true, signals: ["low_confidence"], matchedPhrase: lowConfidence.matchedPhrase, originalModel: modelConfig.model };
        }
      }
    }

    recordOrchestraExecution({
      orgId, userId, taskId, layerKey: "task_oa", eventType: "task_execution.planning",
      input: { title, description, escalation }, output: { summary: result.summary, stepCount: result.steps?.length ?? 0 },
      status: "completed", durationMs: Date.now() - planningStartedAt,
      provider: effectiveConfig.provider, model: effectiveConfig.model, usage,
    });

    const agentByName = new Map(agents.map((a) => [a.name.toLowerCase(), a]));
    const dispatchNotes: string[] = [];
    let missingCapabilityNoted = false;

    await withTenantContext({ orgId, userId }, async (db) => {
      const steps = (result.steps ?? []).slice(0, 6);
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const agent = step.agentName ? agentByName.get(step.agentName.toLowerCase()) : undefined;

        const [planRow] = await db
          .insert(taskExecutionPlan)
          .values({
            taskId,
            stepNumber: i + 1,
            workerAgentId: agent?.id ?? null,
            description: step.description,
            status: "completed",
          })
          .returning();

        // Wave 16: Worker Agent Discovery's missing half (constitution
        // refinement #4) -- the LLM named an agent that doesn't exist among
        // this org's real, approved/published roster. Never auto-create a
        // proposal from an unattended background job (that would violate
        // Scope-Limited Creation, refinement #7 -- a proposal always needs a
        // real human/layer attributed to it) -- instead surface it as an
        // actionable note a human can act on.
        if (step.agentName && !agent && !missingCapabilityNoted) {
          missingCapabilityNoted = true
          await db.insert(taskChatMessages).values({
            taskId,
            role: "system",
            content: `No approved worker agent matches "${step.agentName}" for: "${step.description}". A worker agent for this capability can be proposed in Settings -> Worker Agents.`,
          })
        }

        // Only auto-dispatch global, read-only agents this engine actually
        // knows how to run for real, AND only within this agent's declared
        // purpose/domain (Wave 17: Purpose-Bound AI enforcement -- a hard
        // allowlist check, not just the system-prompt clause above).
        // Everything else is a recorded plan step, not a faked execution.
        if (agent?.tier === "global" && agent.codeReference && isToolAllowedForDomain(agent.domain, agent.codeReference)) {
          const startedAt = new Date();
          try {
            const output = await dispatchTool(db, orgId, userId, agent.codeReference);
            await db.insert(taskAgentExecutions).values({
              taskExecutionPlanId: planRow.id,
              workerAgentId: agent.id,
              startedAt,
              completedAt: new Date(),
              status: "completed",
              input: {},
              output: output as object,
            });
            dispatchNotes.push(`${agent.name} ran: ${JSON.stringify(output).slice(0, 300)}`);
          } catch (dispatchErr) {
            await db.insert(taskAgentExecutions).values({
              taskExecutionPlanId: planRow.id,
              workerAgentId: agent.id,
              startedAt,
              completedAt: new Date(),
              status: "failed",
              input: {},
              errorMessage: dispatchErr instanceof Error ? dispatchErr.message : "unknown error",
            });
          }
        }
      }

      const summaryWithData = dispatchNotes.length > 0 ? `${result.summary || "Plan generated."}\n\nReal data gathered:\n${dispatchNotes.join("\n")}` : result.summary || "Plan generated.";

      await db.insert(taskChatMessages).values({
        taskId,
        role: "assistant",
        content: summaryWithData,
      });

      await updateTaskStatusAndReflect(db, orgId, taskId, "completed");

      if (assistantId) {
        await recordAssistantMemory(db, assistantId, "task_outcome", `Task "${title}": ${result.summary || "Plan generated."}`);
      }
    });
  } catch (err) {
    console.error("Task execution failed:", err);
    await markTaskOutcome(
      orgId,
      userId,
      taskId,
      "failed",
      `Execution failed: ${err instanceof Error ? err.message : "unknown error"}. You can retry by editing and resaving the task.`
    ).catch(() => {});
  }
}

async function markTaskOutcome(
  orgId: string,
  userId: string,
  taskId: string,
  status: "completed" | "failed",
  message: string
): Promise<void> {
  await withTenantContext({ orgId, userId }, async (db) => {
    await db.insert(taskChatMessages).values({ taskId, role: "system", content: message });
    await updateTaskStatusAndReflect(db, orgId, taskId, status, status === "failed" ? message : null);
  });
}
