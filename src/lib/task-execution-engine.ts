import { workerAgents, tasks, taskExecutionPlan, taskAgentExecutions, taskChatMessages, complianceItems, departments, notices, users } from "@/lib/db";
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped";
import { eq, and, asc, gte, lte, ne, inArray, sql } from "drizzle-orm";
import { resolveModelConfig } from "@/lib/orchestra-model-resolver";
import { callLLMJson } from "@/lib/llm-client";
import { buildPurposeClause, isToolAllowedForDomain, DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai";
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine";
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver";
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger";
import { searchAssistantMemories, recordAssistantMemory } from "@/lib/services/assistant-memory-service";

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

export async function dispatchTool(db: TenantDb, orgId: string, userId: string, codeReference: string, context?: { taskId?: string; inputs?: Record<string, unknown> }): Promise<unknown> {
  if (codeReference === "get_compliance_stats") {
    const now = new Date();
    const weekEnd = new Date(Date.now() + 7 * 86400000);
    const [[total], [overdue], [completed], [dueWeek]] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(complianceItems).where(eq(complianceItems.orgId, orgId)),
      db.select({ count: sql<number>`count(*)` }).from(complianceItems).where(and(eq(complianceItems.orgId, orgId), eq(complianceItems.status, "overdue"))),
      db.select({ count: sql<number>`count(*)` }).from(complianceItems).where(and(eq(complianceItems.orgId, orgId), eq(complianceItems.status, "completed"))),
      db.select({ count: sql<number>`count(*)` }).from(complianceItems).where(
        and(eq(complianceItems.orgId, orgId), gte(complianceItems.dueDate, now), lte(complianceItems.dueDate, weekEnd), ne(complianceItems.status, "completed"))
      ),
    ]);
    return { total: Number(total.count), overdue: Number(overdue.count), completed: Number(completed.count), dueThisWeek: Number(dueWeek.count) };
  }

  if (codeReference === "get_overdue_items") {
    const items = await db.query.complianceItems.findMany({
      where: and(eq(complianceItems.orgId, orgId), eq(complianceItems.status, "overdue")),
      columns: { id: true, title: true, complianceType: true, dueDate: true },
      orderBy: asc(complianceItems.dueDate),
      limit: 10,
    });
    return items.map((i) => ({ ...i, daysLate: Math.floor((Date.now() - i.dueDate.getTime()) / 86400000) }));
  }

  if (codeReference === "list_departments") {
    return db.query.departments.findMany({
      where: eq(departments.orgId, orgId),
      columns: { id: true, name: true },
    });
  }

  if (codeReference === "list_compliance_items") {
    return db.query.complianceItems.findMany({
      where: eq(complianceItems.orgId, orgId),
      columns: { id: true, title: true, complianceType: true, status: true, dueDate: true },
      orderBy: asc(complianceItems.dueDate),
      limit: 20,
    });
  }

  if (codeReference === "list_notices") {
    return db.query.notices.findMany({
      where: eq(notices.orgId, orgId),
      columns: { id: true, noticeNumber: true, authority: true, status: true, replyDeadline: true },
      orderBy: asc(notices.replyDeadline),
      limit: 20,
    });
  }

  if (codeReference === "get_task_status") {
    // Contextual, zero-argument by design -- "what's the status of the task
    // I'm in", not an arbitrary lookup (structured dispatch has no argument-
    // capture UI yet; a task-id-taking version can be added once it does).
    if (!context?.taskId) throw new Error("get_task_status requires task context");
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, context.taskId),
      columns: { id: true, title: true, status: true, updatedAt: true },
    });
    if (!task) throw new Error("Task not found");
    return task;
  }

  // A real write action -- safe to auto-dispatch here (unlike the free-text/
  // LLM-planning path's DISPATCHABLE read-only restriction) because the
  // arguments are never LLM-generated: capability-tree-service.ts's
  // Compliance Item branch bakes the exact item id + target status into the
  // leaf itself (fixedInputs), so this only ever runs with values a human
  // picked by clicking, not values an LLM guessed.
  if (codeReference === "update_compliance_status") {
    const complianceItemId = String(context?.inputs?.complianceItemId ?? "");
    const newStatus = String(context?.inputs?.newStatus ?? "");
    const validStatuses = ["pending", "in_progress", "completed", "overdue", "not_applicable", "draft"];
    if (!complianceItemId || !validStatuses.includes(newStatus)) throw new Error("Missing or invalid complianceItemId/newStatus");
    const existing = await db.query.complianceItems.findFirst({
      where: and(eq(complianceItems.id, complianceItemId), eq(complianceItems.orgId, orgId)),
      columns: { id: true, title: true, status: true },
    });
    if (!existing) throw new Error("Compliance item not found");
    const [updated] = await db.update(complianceItems)
      .set({ status: newStatus as typeof existing.status, updatedAt: new Date(), ...(newStatus === "completed" ? { completedAt: new Date() } : {}) })
      .where(eq(complianceItems.id, complianceItemId))
      .returning({ id: complianceItems.id, title: complianceItems.title, status: complianceItems.status });
    return { ...updated, previousStatus: existing.status };
  }

  // GST Reconciliation Engine dispatchers (Finance > GST Reconciliation).
  // list_* are read-only, safe from either dispatch path. The write actions
  // (confirm/reconcile/generate/review) call the *Core variants directly on
  // this same `db`/transaction, matching update_compliance_status's inline
  // style above -- one atomic transaction per dispatch, not a second,
  // independent one opened by calling the outer service wrapper.
  if (codeReference === "list_gst_import_batches") {
    const { listBatches } = await import("@/lib/services/gst-reconciliation-service");
    return listBatches({ orgId });
  }

  if (codeReference === "list_gst_returns") {
    const { listReturns } = await import("@/lib/services/gst-reconciliation-service");
    return listReturns({ orgId });
  }

  if (codeReference === "confirm_gst_batch") {
    const batchId = String(context?.inputs?.batchId ?? "");
    if (!batchId) throw new Error("Missing batchId");
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!dbUser) throw new Error("User not found");
    const { confirmBatchCore } = await import("@/lib/services/gst-reconciliation-service");
    return confirmBatchCore(db, { orgId, userId, dbUser }, batchId);
  }

  if (codeReference === "run_gst_reconciliation") {
    const purchaseBatchId = String(context?.inputs?.purchaseBatchId ?? "");
    const gstr2bBatchId = String(context?.inputs?.gstr2bBatchId ?? "");
    const period = String(context?.inputs?.period ?? "");
    if (!purchaseBatchId || !gstr2bBatchId || !period) throw new Error("Missing purchaseBatchId/gstr2bBatchId/period");
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!dbUser) throw new Error("User not found");
    const { runReconciliationCore } = await import("@/lib/services/gst-reconciliation-service");
    return runReconciliationCore(db, { orgId, userId, dbUser }, { period, purchaseBatchId, gstr2bBatchId });
  }

  if (codeReference === "generate_gst_return") {
    const period = String(context?.inputs?.period ?? "");
    const returnType = String(context?.inputs?.returnType ?? "");
    if (!period || !["gstr1", "gstr3b"].includes(returnType)) throw new Error("Missing or invalid period/returnType");
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!dbUser) throw new Error("User not found");
    const { generateReturnCore, resolveOwnGstinForOrg } = await import("@/lib/services/gst-reconciliation-service");
    const gstin = await resolveOwnGstinForOrg({ orgId });
    if (!gstin) throw new Error("No GSTIN configured for this organisation -- set it in Settings before generating a return.");
    return generateReturnCore(db, { orgId, userId, dbUser }, { period, gstin, returnType: returnType as "gstr1" | "gstr3b" });
  }

  if (codeReference === "generate_gst_ai_review") {
    const returnPeriodId = String(context?.inputs?.returnPeriodId ?? "");
    if (!returnPeriodId) throw new Error("Missing returnPeriodId");
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!dbUser) throw new Error("User not found");
    const { generateReviewReportCore } = await import("@/lib/services/gst-reconciliation-service");
    return generateReviewReportCore(db, { orgId, userId, dbUser }, returnPeriodId);
  }

  // Construction Intelligence (PROJEXA), Wave 128. All read-only, matching
  // this function's read-only-auto-dispatch contract. Each independently
  // opens its own withTenantContext transaction via the service call
  // (not the `db` already open here) -- same posture as list_gst_import_batches
  // above, acceptable for read-only queries per that branch's own comment.
  if (codeReference === "get_construction_project_dashboard") {
    const projectId = String(context?.inputs?.projectId ?? "");
    if (!projectId) throw new Error("Missing projectId");
    const { getProjectDashboard } = await import("@/lib/services/construction-dashboard-service");
    return getProjectDashboard({ orgId }, projectId);
  }

  if (codeReference === "list_delayed_activities") {
    const { getOrgDashboard } = await import("@/lib/services/construction-dashboard-service");
    const dashboard = await getOrgDashboard({ orgId });
    return dashboard.projects.filter((p) => p.delayedTaskCount > 0);
  }

  if (codeReference === "get_construction_budget_status") {
    const projectId = String(context?.inputs?.projectId ?? "");
    if (!projectId) throw new Error("Missing projectId");
    const { budgetVsActual } = await import("@/lib/services/construction-reports-service");
    return budgetVsActual({ orgId }, projectId);
  }

  if (codeReference === "list_over_budget_projects") {
    const { getOrgDashboard, getProjectDashboard } = await import("@/lib/services/construction-dashboard-service");
    const orgDashboard = await getOrgDashboard({ orgId });
    // N+1, capped -- matches buildComplianceItemNodes()'s "quick-action
    // list, not a browse view" posture (see capability-tree-service.ts),
    // since getOrgDashboard()'s per-project summary doesn't carry budget.
    const results = await Promise.all(
      orgDashboard.projects.slice(0, 20).map((p) => getProjectDashboard({ orgId }, p.id))
    );
    return results.filter((p) => p.budget > 0 && p.expenses > p.budget);
  }

  if (codeReference === "get_construction_kpi_status") {
    const projectId = String(context?.inputs?.projectId ?? "");
    if (!projectId) throw new Error("Missing projectId");
    const { kpiReport } = await import("@/lib/services/construction-reports-service");
    return kpiReport({ orgId }, projectId);
  }

  if (codeReference === "generate_construction_progress_summary") {
    const projectId = String(context?.inputs?.projectId ?? "");
    if (!projectId) throw new Error("Missing projectId");
    const { generateProgressSummary } = await import("@/lib/services/construction-ai-service");
    return generateProgressSummary({ orgId, userId }, projectId);
  }

  if (codeReference === "detect_construction_budget_schedule_risk") {
    const projectId = String(context?.inputs?.projectId ?? "");
    if (!projectId) throw new Error("Missing projectId");
    const { detectBudgetScheduleRisk } = await import("@/lib/services/construction-ai-service");
    return detectBudgetScheduleRisk({ orgId, userId }, projectId);
  }

  throw new Error(`No dispatcher implemented for ${codeReference}`);
}

// Deliberately a small, explicit allowlist switch -- not a generic resolver
// that dynamic-imports whatever computation_engines.implementation_ref says.
// Letting a database row control which file gets imported and which export
// gets called would be a real code-execution surface; each case here is a
// real, reviewed import instead. First slice: 3 GST Engine functions,
// proving both the numeric-calculation and string-validation input shapes
// before extending to the other ~200 registered engines in a later wave.
function truthy(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1";
}

async function dispatchEngine(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  const gstSplitInput = () => ({
    taxableAmount: Number(inputs.taxableAmount),
    gstRatePercent: Number(inputs.gstRatePercent),
    supplierStateCode: String(inputs.supplierStateCode ?? ""),
    buyerStateCode: String(inputs.buyerStateCode ?? ""),
  });

  switch (engineKey) {
    // cgst/sgst/igst_engine are the same underlying split -- distinct
    // registry rows/labels, one real function (matches implementation_ref).
    case "gst_split_engine":
    case "cgst_engine":
    case "sgst_engine":
    case "igst_engine": {
      const { splitGst } = await import("@/lib/engines/gst-engine");
      return splitGst(gstSplitInput());
    }
    case "utgst_engine": {
      const { splitGstWithUtgst } = await import("@/lib/engines/gst-engine");
      return splitGstWithUtgst(gstSplitInput());
    }
    case "gst_calculation_engine": {
      const { calculateGst } = await import("@/lib/engines/gst-engine");
      return calculateGst(gstSplitInput());
    }
    case "reverse_charge_engine": {
      const { computeReverseChargeLiability } = await import("@/lib/engines/gst-engine");
      return computeReverseChargeLiability({ ...gstSplitInput(), isReverseCharge: truthy(inputs.isReverseCharge) });
    }
    case "hsn_validation_engine": {
      const { isValidHsnFormat } = await import("@/lib/engines/gst-engine");
      return { valid: isValidHsnFormat(String(inputs.hsn ?? "")) };
    }
    case "sac_validation_engine": {
      const { isValidSacFormat } = await import("@/lib/engines/gst-engine");
      return { valid: isValidSacFormat(String(inputs.sac ?? "")) };
    }
    case "eway_bill_validation_engine": {
      const { isValidEwayBillNumberFormat } = await import("@/lib/engines/gst-engine");
      return { valid: isValidEwayBillNumberFormat(String(inputs.ebn ?? "")) };
    }
    case "gst_exclusive_engine": {
      const { gstExclusiveToInclusive } = await import("@/lib/engines/gst-engine");
      return gstExclusiveToInclusive(Number(inputs.taxableAmount), Number(inputs.gstRatePercent));
    }
    case "gst_inclusive_engine": {
      const { gstInclusiveToTaxable } = await import("@/lib/engines/gst-engine");
      return gstInclusiveToTaxable(Number(inputs.inclusiveAmount), Number(inputs.gstRatePercent));
    }
    case "gst_interest_engine": {
      const { calculateGstInterest } = await import("@/lib/engines/gst-engine");
      return { interest: calculateGstInterest({
        taxAmount: Number(inputs.taxAmount), daysLate: Number(inputs.daysLate),
        isExcessItcClaim: inputs.isExcessItcClaim ? truthy(inputs.isExcessItcClaim) : undefined,
      }) };
    }
    case "gst_late_fee_engine": {
      const { calculateGstLateFee } = await import("@/lib/engines/gst-engine");
      return calculateGstLateFee({
        daysLate: Number(inputs.daysLate),
        isNilReturn: inputs.isNilReturn ? truthy(inputs.isNilReturn) : undefined,
      });
    }
    case "itc_calculation_engine": {
      const { calculateEligibleItc } = await import("@/lib/engines/gst-engine");
      return calculateEligibleItc({
        totalItcAvailable: Number(inputs.totalItcAvailable), blockedCreditAmount: Number(inputs.blockedCreditAmount),
        exemptSupplyRatio: inputs.exemptSupplyRatio ? Number(inputs.exemptSupplyRatio) : undefined,
      });
    }
    default:
      throw new Error(`No engine dispatcher implemented for ${engineKey}`);
  }
}

// Structured dispatch: the worker agent is already known (a human clicked it
// via the chain selector, re-verified server-side in task-service.ts), so
// there's no LLM discretion to guard against -- deliberately does NOT run
// isToolAllowedForDomain() here (that allowlist exists to stop an LLM from
// picking an inappropriate tool; it has nothing to check when a human
// already picked the exact tool by name). The free-text/LLM-planning path
// below is completely unchanged and still enforces it.
async function executeStructuredDispatch(orgId: string, userId: string, taskId: string, workerAgentId: string, agentInputs?: Record<string, unknown>): Promise<void> {
  await withTenantContext({ orgId, userId }, async (db) => {
    const agent = await db.query.workerAgents.findFirst({ where: eq(workerAgents.id, workerAgentId) });
    if (!agent?.codeReference || agent.tier !== "global" || !["approved", "published"].includes(agent.lifecycleStatus)) {
      await db.insert(taskChatMessages).values({ taskId, role: "system", content: "The selected capability is no longer available. Please try again." });
      await db.update(tasks).set({ status: "failed", updatedAt: new Date() }).where(eq(tasks.id, taskId));
      return;
    }

    const [planRow] = await db.insert(taskExecutionPlan).values({
      taskId, stepNumber: 1, workerAgentId: agent.id, description: agent.name, status: "completed",
    }).returning();

    const startedAt = new Date();
    try {
      const output = await dispatchTool(db, orgId, userId, agent.codeReference, { taskId, inputs: agentInputs });
      await db.insert(taskAgentExecutions).values({
        taskExecutionPlanId: planRow.id, workerAgentId: agent.id, startedAt, completedAt: new Date(),
        status: "completed", input: {}, output: output as object,
      });
      await db.insert(taskChatMessages).values({
        taskId, role: "assistant", content: `${agent.name}: ${JSON.stringify(output).slice(0, 800)}`,
      });
      await db.update(tasks).set({ status: "completed", updatedAt: new Date() }).where(eq(tasks.id, taskId));
    } catch (dispatchErr) {
      const message = dispatchErr instanceof Error ? dispatchErr.message : "unknown error";
      await db.insert(taskAgentExecutions).values({
        taskExecutionPlanId: planRow.id, workerAgentId: agent.id, startedAt, completedAt: new Date(),
        status: "failed", input: {}, errorMessage: message,
      });
      await db.insert(taskChatMessages).values({ taskId, role: "system", content: `${agent.name} couldn't complete: ${message}` });
      await db.update(tasks).set({ status: "failed", updatedAt: new Date() }).where(eq(tasks.id, taskId));
    }
  });
}

async function executeEngineDispatch(orgId: string, userId: string, taskId: string, engineKey: string, engineInputs: Record<string, unknown>): Promise<void> {
  await withTenantContext({ orgId, userId }, async (db) => {
    try {
      const output = await dispatchEngine(engineKey, engineInputs);
      await db.insert(taskChatMessages).values({ taskId, role: "assistant", content: `Result: ${JSON.stringify(output)}` });
      await db.update(tasks).set({ status: "completed", updatedAt: new Date() }).where(eq(tasks.id, taskId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      await db.insert(taskChatMessages).values({ taskId, role: "system", content: `Calculation failed: ${message}` });
      await db.update(tasks).set({ status: "failed", updatedAt: new Date() }).where(eq(tasks.id, taskId));
    }
  });
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
  if (engineKey) {
    await executeEngineDispatch(orgId, userId, taskId, engineKey, engineInputs ?? {});
    return;
  }
  if (resolvedWorkerAgentId) {
    await executeStructuredDispatch(orgId, userId, taskId, resolvedWorkerAgentId, agentInputs);
    return;
  }

  try {
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

    const modelConfig = await resolveModelConfig(orgId, "task_oa");
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
    const userMessage = `Task: ${title}\n${description ? `Description: ${description}\n` : ""}\nAvailable agents:\n${agentList || "(none configured yet)"}${memoryBlock}`;

    const planningStartedAt = Date.now();
    const { data: result, usage } = await callLLMJson<{
      summary: string;
      steps: { agentName: string | null; description: string }[];
    }>(modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage, {
      temperature: 0.3,
      maxTokens: 800,
    }, modelConfig.fallback);
    recordOrchestraExecution({
      orgId, userId, taskId, layerKey: "task_oa", eventType: "task_execution.planning",
      input: { title, description }, output: { summary: result.summary, stepCount: result.steps?.length ?? 0 },
      status: "completed", durationMs: Date.now() - planningStartedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
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

      await db.update(tasks).set({ status: "completed", updatedAt: new Date() }).where(eq(tasks.id, taskId));

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
    await db.update(tasks).set({ status, updatedAt: new Date() }).where(eq(tasks.id, taskId));
  });
}
