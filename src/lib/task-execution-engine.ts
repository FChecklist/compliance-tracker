import { workerAgents, tasks, taskExecutionPlan, taskAgentExecutions, taskChatMessages, complianceItems, departments, notices, users, gstCanonicalInvoices, gstReturnPeriods, dynamicChains, entityRelationships } from "@/lib/db";
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped";
import { eq, and, asc, desc, gte, lte, ne, inArray, sql } from "drizzle-orm";
import { resolveModelConfig, escalatedPlatformConfig } from "@/lib/orchestra-model-resolver";
import { callLLMJson } from "@/lib/llm-client";
import { buildPurposeClause, isToolAllowedForDomain, DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai";
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine";
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver";
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger";
import { searchAssistantMemories, recordAssistantMemory } from "@/lib/services/assistant-memory-service";
import { assertValidDispatchOutput } from "@/lib/dispatch-output-validator";
import { VALID_TYPES as VALID_COMPLIANCE_TYPES } from "@/lib/services/compliance-service";
import { logActivity } from "@/lib/audit";
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

  // Gap closure, 2026-07-10 (CAPABILITY_COVERAGE.md): create_compliance_item
  // was registered with zero implementation. Safe to auto-dispatch here for
  // the same reason update_compliance_status is -- capability-tree-service.ts's
  // "Create New" leaf collects title/type/dueDate/amount through inputFields
  // (a validated form, never LLM-guessed) and bakes departmentId into
  // fixedInputs (a real click, not typed text). Mirrors createComplianceItem()
  // in compliance-service.ts's own validation/insert shape, inlined here
  // rather than calling that function directly since it expects a fuller
  // ServiceContext (actor/request) this dispatch path doesn't carry.
  if (codeReference === "create_compliance_item") {
    const departmentId = String(context?.inputs?.departmentId ?? "");
    const title = String(context?.inputs?.title ?? "").trim();
    const complianceType = String(context?.inputs?.complianceType ?? "");
    const dueDateRaw = String(context?.inputs?.dueDate ?? "");
    const amountRaw = context?.inputs?.amount;
    if (!departmentId || !title || !(VALID_COMPLIANCE_TYPES as readonly string[]).includes(complianceType)) {
      throw new Error("Missing or invalid departmentId/title/complianceType");
    }
    const parsedDueDate = new Date(dueDateRaw);
    if (isNaN(parsedDueDate.getTime())) throw new Error("A valid dueDate (YYYY-MM-DD) is required");
    const dept = await db.query.departments.findFirst({ where: and(eq(departments.id, departmentId), eq(departments.orgId, orgId)) });
    if (!dept) throw new Error("Department not found");

    const [item] = await db.insert(complianceItems).values({
      title, complianceType: complianceType as typeof VALID_COMPLIANCE_TYPES[number],
      dueDate: parsedDueDate, departmentId, orgId,
      amount: amountRaw != null && amountRaw !== "" ? String(amountRaw) : null,
    }).returning({ id: complianceItems.id, title: complianceItems.title, dueDate: complianceItems.dueDate });

    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (dbUser) {
      await logActivity({ tx: db, action: "create", entityType: "ComplianceItem", entityId: item.id, details: `Created compliance item: ${item.title}`, orgId, dbUser });
    }
    return item;
  }

  // Gap closure, 2026-07-10: get_penalty_estimate was registered with zero
  // implementation. Uses complianceItems.amount ("Amount for penalty
  // calculation" per its own schema comment) and the item's real due/
  // completed date to compute real days-late, then the existing generic
  // simple-interest calculator (compliance-engine.ts, already used
  // elsewhere) -- the only value a human types is the interest rate itself,
  // since statutory rates vary per compliance type and aren't modeled in
  // this schema yet.
  if (codeReference === "get_penalty_estimate") {
    const complianceItemId = String(context?.inputs?.complianceItemId ?? "");
    const annualRatePercent = Number(context?.inputs?.annualRatePercent);
    if (!complianceItemId || !Number.isFinite(annualRatePercent)) throw new Error("Missing complianceItemId or annualRatePercent");
    const item = await db.query.complianceItems.findFirst({
      where: and(eq(complianceItems.id, complianceItemId), eq(complianceItems.orgId, orgId)),
      columns: { id: true, title: true, amount: true, dueDate: true, completedAt: true },
    });
    if (!item) throw new Error("Compliance item not found");
    if (item.amount == null) throw new Error("This item has no amount set -- penalty cannot be estimated");
    const asOf = item.completedAt ?? new Date();
    const daysLate = Math.max(0, Math.floor((asOf.getTime() - item.dueDate.getTime()) / 86400000));
    const { calculateComplianceInterest } = await import("@/lib/engines/compliance-engine");
    const estimatedPenalty = calculateComplianceInterest(Number(item.amount), annualRatePercent, daysLate);
    return { itemTitle: item.title, amount: Number(item.amount), daysLate, annualRatePercent, estimatedPenalty };
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
// real, reviewed import instead. GST Engine (16/16), Mathematical
// Computation Engine (10/13), and Costing Engine (8/8) are the categories
// wired so far -- CAPABILITY_COVERAGE.md tracks exactly which of the other
// ~185 registered engines are still unwired and why.
function truthy(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1";
}

// Backs every `number_list` CapabilityInputField -- the composer sends the
// raw comma-separated text unparsed, this is the one place it becomes a
// real number[], with a clear error on a malformed entry rather than
// silently coercing "abc" to NaN and letting a bad value flow into a
// calculation undetected.
function parseNumberList(v: unknown): number[] {
  const raw = String(v ?? "").trim();
  if (!raw) return [];
  return raw.split(",").map((part) => {
    const n = Number(part.trim());
    if (!Number.isFinite(n)) throw new Error(`"${part.trim()}" is not a valid number`);
    return n;
  });
}

async function dispatchEngine(db: TenantDb, orgId: string, engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  // Zero typed fields -- validates a real GST return period's own confirmed
  // sales invoices, never a human-typed line-items list. Completes the GST
  // Engine category (16/16).
  if (engineKey === "gst_return_validation_engine") {
    const returnPeriodId = String(inputs.returnPeriodId ?? "");
    if (!returnPeriodId) throw new Error("Missing returnPeriodId");
    const period = await db.query.gstReturnPeriods.findFirst({ where: and(eq(gstReturnPeriods.id, returnPeriodId), eq(gstReturnPeriods.orgId, orgId)) });
    if (!period) throw new Error("Return period not found");
    const invoices = await db.query.gstCanonicalInvoices.findMany({
      where: and(eq(gstCanonicalInvoices.orgId, orgId), eq(gstCanonicalInvoices.period, period.period), eq(gstCanonicalInvoices.direction, "sales")),
    });
    const totalTaxableValue = invoices.reduce((sum, i) => sum + Number(i.taxableValue), 0);
    const totalTaxPaid = invoices.reduce((sum, i) => sum + Number(i.cgstAmount) + Number(i.sgstAmount) + Number(i.igstAmount), 0);
    const { validateGstReturn } = await import("@/lib/engines/gst-engine");
    return validateGstReturn({
      gstin: period.gstin, period: period.period,
      totalTaxableValue, totalTaxPaid,
      lineItems: invoices.map((i) => ({ invoiceNumber: i.invoiceNumber, taxableValue: Number(i.taxableValue), totalValue: Number(i.totalValue) })),
    });
  }

  switch (engineKey) {
    // Mathematical Computation Engine (10 of 13 -- see capability-tree-
    // service.ts's comment for the 3 deferred, matrix/model-input ones).
    case "basic_arithmetic_engine": {
      const { add, subtract, multiply, divide } = await import("@/lib/engines/mathematical-engine");
      const a = Number(inputs.a), b = Number(inputs.b);
      const fn = { add, subtract, multiply, divide }[String(inputs.operation)];
      if (!fn) throw new Error("Invalid operation");
      return { result: fn(a, b) };
    }
    case "scientific_calculator_engine": {
      const { evaluateExpression } = await import("@/lib/engines/mathematical-engine");
      return { result: evaluateExpression(String(inputs.expr ?? "")) };
    }
    case "financial_mathematics_engine": {
      const { presentValue, futureValue, compoundInterest } = await import("@/lib/engines/mathematical-engine");
      const amount = Number(inputs.amount), rate = Number(inputs.rate), periods = Number(inputs.periodsOrYears);
      switch (inputs.operation) {
        case "present_value": return { result: presentValue(amount, rate, periods) };
        case "future_value": return { result: futureValue(amount, rate, periods) };
        case "compound_interest": return { result: compoundInterest(amount, rate, Number(inputs.timesCompoundedPerYear) || 1, periods) };
        default: throw new Error("Invalid operation");
      }
    }
    case "percentage_engine": {
      const { percentageOf, percentageChange } = await import("@/lib/engines/mathematical-engine");
      const value1 = Number(inputs.value1), value2 = Number(inputs.value2);
      if (inputs.operation === "percentage_of") return { result: percentageOf(value1, value2) };
      if (inputs.operation === "percentage_change") return { result: percentageChange(value1, value2) };
      throw new Error("Invalid operation");
    }
    case "ratio_engine": {
      const { simplifyRatio } = await import("@/lib/engines/mathematical-engine");
      const [num, den] = simplifyRatio(Number(inputs.a), Number(inputs.b));
      return { numerator: num, denominator: den };
    }
    case "fraction_engine": {
      const { addFractions } = await import("@/lib/engines/mathematical-engine");
      const [num, den] = addFractions(Number(inputs.n1), Number(inputs.d1), Number(inputs.n2), Number(inputs.d2));
      return { numerator: num, denominator: den };
    }
    case "statistical_engine": {
      const { statisticalSummary } = await import("@/lib/engines/mathematical-engine");
      return statisticalSummary(parseNumberList(inputs.values));
    }
    case "probability_engine": {
      const { combinations, permutations, normalCdf } = await import("@/lib/engines/mathematical-engine");
      switch (inputs.operation) {
        case "combinations": return { result: combinations(Number(inputs.n), Number(inputs.k)) };
        case "permutations": return { result: permutations(Number(inputs.n), Number(inputs.k)) };
        case "normal_cdf": return { result: normalCdf(Number(inputs.n), inputs.k ? Number(inputs.k) : undefined, inputs.stdDev ? Number(inputs.stdDev) : undefined) };
        default: throw new Error("Invalid operation");
      }
    }
    case "regression_engine": {
      const { linearRegression } = await import("@/lib/engines/mathematical-engine");
      const xs = parseNumberList(inputs.xValues), ys = parseNumberList(inputs.yValues);
      if (xs.length !== ys.length || xs.length === 0) throw new Error("X and Y value lists must be the same non-zero length");
      const { slope, intercept } = linearRegression(xs.map((x, i) => [x, ys[i]] as [number, number]));
      return { slope, intercept };
    }
    case "time_series_engine": {
      const { movingAverage } = await import("@/lib/engines/mathematical-engine");
      return { movingAverage: movingAverage(parseNumberList(inputs.values), Number(inputs.windowSize)) };
    }
  }

  const gstSplitInput = () => ({
    taxableAmount: Number(inputs.taxableAmount),
    gstRatePercent: Number(inputs.gstRatePercent),
    supplierStateCode: String(inputs.supplierStateCode ?? ""),
    buyerStateCode: String(inputs.buyerStateCode ?? ""),
  });

  switch (engineKey) {
    // Costing Engine (8 of 8 registered engines) -- non-manufacturing
    // costing methods (job/contract/service costing, allocation, variance)
    // from costing-engine.ts. The two array-of-objects inputs
    // (activity_based_costing_engine's costPools/objectDriverUsage and
    // cost_allocation_engine's allocationBasis) are dispatch-only -- no UI
    // field type supports a grid/JSON-editor, the same skip pattern the
    // Mathematical Computation Engine's 3 matrix/model-input engines follow
    // above (see capability-tree-service.ts's COSTING_WIRED_ENGINE_INPUT_FIELDS
    // comment).
    case "job_costing_engine": {
      const { calculateJobCost } = await import("@/lib/engines/costing-engine");
      return { result: calculateJobCost(Number(inputs.directMaterial), Number(inputs.directLabor), Number(inputs.overheadAllocated)) };
    }
    case "standard_costing_engine": {
      const { standardCostingVariance } = await import("@/lib/engines/costing-engine");
      return standardCostingVariance({
        standardPrice: Number(inputs.standardPrice),
        actualPrice: Number(inputs.actualPrice),
        standardQuantity: Number(inputs.standardQuantity),
        actualQuantity: Number(inputs.actualQuantity),
      });
    }
    case "marginal_costing_engine": {
      const { marginalCostingAnalysis } = await import("@/lib/engines/costing-engine");
      return marginalCostingAnalysis({
        sellingPricePerUnit: Number(inputs.sellingPricePerUnit),
        variableCostPerUnit: Number(inputs.variableCostPerUnit),
        fixedCosts: Number(inputs.fixedCosts),
      });
    }
    case "activity_based_costing_engine": {
      const { allocateActivityBasedCost } = await import("@/lib/engines/costing-engine");
      const costPools = inputs.costPools;
      if (!Array.isArray(costPools)) throw new Error("costPools must be an array");
      const objectDriverUsage = inputs.objectDriverUsage;
      if (typeof objectDriverUsage !== "object" || objectDriverUsage === null || Array.isArray(objectDriverUsage)) {
        throw new Error("objectDriverUsage must be an object");
      }
      return allocateActivityBasedCost(
        costPools as { activity: string; totalCost: number; totalDriverUnits: number }[],
        objectDriverUsage as Record<string, number>,
      );
    }
    case "batch_costing_engine_2": {
      const { calculateBatchCost } = await import("@/lib/engines/costing-engine");
      return { result: calculateBatchCost(Number(inputs.totalBatchCost), Number(inputs.unitsInBatch)) };
    }
    case "service_costing_engine": {
      const { calculateServiceCost } = await import("@/lib/engines/costing-engine");
      return { result: calculateServiceCost(Number(inputs.directCost), Number(inputs.indirectCostAllocated), Number(inputs.serviceUnits)) };
    }
    case "cost_allocation_engine": {
      const { allocateCostPool } = await import("@/lib/engines/costing-engine");
      const allocationBasis = inputs.allocationBasis;
      if (!Array.isArray(allocationBasis)) throw new Error("allocationBasis must be an array");
      return allocateCostPool(Number(inputs.pool), allocationBasis as { id: string; basisValue: number }[]);
    }
    case "variance_analysis_engine": {
      const { analyzeVariance } = await import("@/lib/engines/costing-engine");
      const higherIsFavorable = inputs.higherIsFavorable == null || inputs.higherIsFavorable === ""
        ? true
        : truthy(inputs.higherIsFavorable);
      return analyzeVariance(Number(inputs.actual), Number(inputs.budget), higherIsFavorable);
    }
  }

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
  }

  // Income Tax Engine -- 9 of 9 registered engines wired (all already
  // `status: 'implemented'` in computation_engines; completes a second full
  // category alongside GST and Math). Slab rates are statutory data isolated
  // in income-tax-engine.ts itself, not duplicated here.
  switch (engineKey) {
    case "income_tax_calculator": {
      const { calculateIncomeTax } = await import("@/lib/engines/income-tax-engine");
      return calculateIncomeTax(Number(inputs.taxableIncome));
    }
    case "advance_tax_calculator": {
      const { calculateAdvanceTaxInstallment } = await import("@/lib/engines/income-tax-engine");
      const quarter = String(inputs.quarter ?? "");
      if (!["q1", "q2", "q3", "q4"].includes(quarter)) throw new Error("quarter must be one of q1, q2, q3, q4");
      return { installmentDue: calculateAdvanceTaxInstallment(Number(inputs.estimatedAnnualTax), quarter as "q1" | "q2" | "q3" | "q4", Number(inputs.alreadyPaid)) };
    }
    case "self_assessment_tax_calculator": {
      const { calculateSelfAssessmentTax } = await import("@/lib/engines/income-tax-engine");
      return { balanceDue: calculateSelfAssessmentTax(Number(inputs.totalTaxLiability), Number(inputs.tdsDeducted), Number(inputs.advanceTaxPaid), inputs.interestDue ? Number(inputs.interestDue) : undefined) };
    }
    case "income_tax_interest_calculator": {
      const { calculateIncomeTaxInterest } = await import("@/lib/engines/income-tax-engine");
      const section = inputs.section ? String(inputs.section) : "234B";
      if (!["234A", "234B", "234C"].includes(section)) throw new Error("section must be one of 234A, 234B, 234C");
      return { interest: calculateIncomeTaxInterest(Number(inputs.unpaidAmount), Number(inputs.monthsDelayed), section as "234A" | "234B" | "234C") };
    }
    case "income_tax_penalty_calculator": {
      const { calculateLateFilingPenalty } = await import("@/lib/engines/income-tax-engine");
      return { penalty: calculateLateFilingPenalty(Number(inputs.totalIncome), truthy(inputs.filedAfterDueDate)) };
    }
    case "capital_gains_calculator": {
      const { calculateCapitalGains } = await import("@/lib/engines/income-tax-engine");
      const assetType = inputs.assetType ? String(inputs.assetType) : undefined;
      if (assetType && !["equity", "other"].includes(assetType)) throw new Error("assetType must be equity or other");
      return calculateCapitalGains({
        saleValue: Number(inputs.saleValue), costOfAcquisition: Number(inputs.costOfAcquisition),
        costOfImprovement: inputs.costOfImprovement ? Number(inputs.costOfImprovement) : undefined,
        expensesOnTransfer: inputs.expensesOnTransfer ? Number(inputs.expensesOnTransfer) : undefined,
        isLongTerm: truthy(inputs.isLongTerm), assetType: assetType as "equity" | "other" | undefined,
      });
    }
    case "indexation_calculator": {
      const { calculateIndexedCost } = await import("@/lib/engines/income-tax-engine");
      return { indexedCost: calculateIndexedCost(Number(inputs.originalCost), Number(inputs.costInflationIndexAtPurchase), Number(inputs.costInflationIndexAtSale)) };
    }
    case "mat_calculator": {
      const { calculateMat } = await import("@/lib/engines/income-tax-engine");
      return calculateMat(Number(inputs.bookProfit), Number(inputs.normalTaxLiability));
    }
    case "amt_calculator": {
      const { calculateAmt } = await import("@/lib/engines/income-tax-engine");
      return calculateAmt(Number(inputs.adjustedTotalIncome), Number(inputs.normalTaxLiability));
    }
  }

  // TDS/TCS Engine (tree4-unified/50-completion-plan PLAN-18 batch 2, Wave
  // 165) -- 6 of 7 registered engines (tds_calculator deliberately deferred,
  // see capability-tree-service.ts's comment for why). Statutory section
  // rates isolated in tds-engine.ts itself, not duplicated here.
  switch (engineKey) {
    case "tcs_calculator": {
      const { calculateTcs } = await import("@/lib/engines/tds-engine");
      return calculateTcs(Number(inputs.saleValue), Number(inputs.ratePercent), inputs.thresholdAmount ? Number(inputs.thresholdAmount) : undefined);
    }
    case "tds_threshold_checker": {
      const { isTdsApplicable } = await import("@/lib/engines/tds-engine");
      return { applicable: isTdsApplicable(String(inputs.section ?? ""), Number(inputs.cumulativePaymentAmount)) };
    }
    case "tds_section_validation_engine": {
      const { computeTdsForSection } = await import("@/lib/engines/tds-engine");
      return computeTdsForSection(String(inputs.section ?? ""), Number(inputs.paymentAmount), Number(inputs.cumulativePaymentAmount), inputs.hasPan === undefined ? true : truthy(inputs.hasPan));
    }
    case "tds_interest_engine": {
      const { calculateTdsInterest } = await import("@/lib/engines/tds-engine");
      const delayType = String(inputs.delayType ?? "");
      if (!["late_deduction", "late_deposit"].includes(delayType)) throw new Error("delayType must be late_deduction or late_deposit");
      return { interest: calculateTdsInterest(Number(inputs.tdsAmount), Number(inputs.monthsDelayed), delayType as "late_deduction" | "late_deposit") };
    }
    case "challan_matching_engine": {
      const { matchTdsChallans } = await import("@/lib/engines/tds-engine");
      const deductions = inputs.deductions as { id: string; period: string; amount: number }[];
      const challans = inputs.challans as { id: string; period: string; amount: number }[];
      if (!Array.isArray(deductions) || !Array.isArray(challans)) throw new Error("deductions and challans must both be arrays");
      return matchTdsChallans(deductions, challans);
    }
    case "pan_validation_engine": {
      const { isValidPanFormat } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidPanFormat(String(inputs.pan ?? "")) };
    }
  }

  // Accounting Computation Engine (tree4-unified/50-completion-plan area 8,
  // Wave 167) -- 11 of 20 registered engines. The other 9
  // (double_entry_engine, journal_posting_engine, ledger_posting_engine,
  // trial_balance_engine, profit_loss_engine, balance_sheet_engine,
  // cash_flow_engine, financial_year_closing_engine, chart_of_accounts_engine)
  // are already implemented in erp-accounting-service.ts/erp-financial-
  // report-service.ts as real, DB-backed ERP product functions (per
  // accounting-engine.ts's own header comment) -- deliberately NOT
  // re-dispatched here as a second surface; see this session's log for why.
  switch (engineKey) {
    case "opening_balance_engine": {
      const { computeOpeningBalance } = await import("@/lib/engines/accounting-engine");
      return { openingBalance: computeOpeningBalance(Number(inputs.priorClosingBalance)) };
    }
    case "closing_balance_engine": {
      const { computeClosingBalance } = await import("@/lib/engines/accounting-engine");
      return { closingBalance: computeClosingBalance(Number(inputs.openingBalance), Number(inputs.totalDebits), Number(inputs.totalCredits), truthy(inputs.isDebitNormal)) };
    }
    case "balance_verification_engine": {
      const { verifyBalancesNetToZero } = await import("@/lib/engines/accounting-engine");
      const balances = inputs.balances as { accountId: string; debit: number; credit: number }[];
      if (!Array.isArray(balances)) throw new Error("balances must be an array");
      return verifyBalancesNetToZero(balances);
    }
    case "consolidation_engine": {
      const { consolidateBalances } = await import("@/lib/engines/accounting-engine");
      const entityBalances = inputs.entityBalances as { entityId: string; accountId: string; amount: number }[];
      const intercompanyAccountIds = inputs.intercompanyAccountIds as string[];
      if (!Array.isArray(entityBalances) || !Array.isArray(intercompanyAccountIds)) throw new Error("entityBalances and intercompanyAccountIds must both be arrays");
      return consolidateBalances(entityBalances, intercompanyAccountIds);
    }
    case "fund_flow_engine": {
      const { computeFundFlow } = await import("@/lib/engines/accounting-engine");
      return computeFundFlow(Number(inputs.openingWorkingCapital), Number(inputs.closingWorkingCapital));
    }
    case "statement_changes_equity_engine": {
      const { statementOfChangesInEquity } = await import("@/lib/engines/accounting-engine");
      return statementOfChangesInEquity({
        openingBalance: Number(inputs.openingBalance), profitForPeriod: Number(inputs.profitForPeriod),
        dividendsPaid: inputs.dividendsPaid ? Number(inputs.dividendsPaid) : undefined,
        capitalIntroduced: inputs.capitalIntroduced ? Number(inputs.capitalIntroduced) : undefined,
        otherComprehensiveIncome: inputs.otherComprehensiveIncome ? Number(inputs.otherComprehensiveIncome) : undefined,
      });
    }
    case "notes_to_accounts_generator": {
      const { generateNotesToAccounts } = await import("@/lib/engines/accounting-engine");
      const lineItems = inputs.lineItems as { accountId: string; noteCategory: string; amount: number }[];
      if (!Array.isArray(lineItems)) throw new Error("lineItems must be an array");
      return generateNotesToAccounts(lineItems);
    }
    case "voucher_validation_engine": {
      const { validateVoucher } = await import("@/lib/engines/accounting-engine");
      const lines = inputs.lines as { accountId: string }[];
      if (!Array.isArray(lines)) throw new Error("lines must be an array");
      return validateVoucher({ debitTotal: Number(inputs.debitTotal), creditTotal: Number(inputs.creditTotal), lines });
    }
    case "duplicate_entry_detection_engine": {
      const { detectDuplicateEntries } = await import("@/lib/engines/accounting-engine");
      const entries = inputs.entries as { id: string; date: string; amount: number; accountId: string; reference?: string }[];
      if (!Array.isArray(entries)) throw new Error("entries must be an array");
      return { duplicateGroups: detectDuplicateEntries(entries) };
    }
    case "suspense_account_detection_engine": {
      const { detectSuspenseAccountBalance } = await import("@/lib/engines/accounting-engine");
      return detectSuspenseAccountBalance(Number(inputs.suspenseAccountBalance));
    }
    case "ledger_reconciliation_engine": {
      const { reconcileLedgers } = await import("@/lib/engines/accounting-engine");
      const ledgerA = inputs.ledgerA as { reference: string; amount: number }[];
      const ledgerB = inputs.ledgerB as { reference: string; amount: number }[];
      if (!Array.isArray(ledgerA) || !Array.isArray(ledgerB)) throw new Error("ledgerA and ledgerB must both be arrays");
      return reconcileLedgers(ledgerA, ledgerB);
    }
  }

  // Payroll Engine (tree4-unified/50-completion-plan area 8, Wave 167) --
  // 14 of 18 registered engines. pf_calculator/esi_calculator/
  // professional_tax_calculator (findActiveRule-driven, admin-editable
  // statutory rules in a DB table) and salary_calculator (the whole
  // payroll-run computation) are NOT standalone pure functions -- same
  // deferred-for-DB-adapter situation as tds_calculator, see this
  // session's log for why they're not force-fit here.
  switch (engineKey) {
    case "gratuity_calculator": {
      const { calculateGratuity } = await import("@/lib/engines/payroll-engine");
      return calculateGratuity({
        lastDrawnMonthlySalary: Number(inputs.lastDrawnMonthlySalary), yearsOfService: Number(inputs.yearsOfService),
        isCoveredUnderAct: inputs.isCoveredUnderAct === undefined ? true : truthy(inputs.isCoveredUnderAct),
      });
    }
    case "eps_calculator": {
      const { calculateEps } = await import("@/lib/engines/payroll-engine");
      return { epsAmount: calculateEps(Number(inputs.monthlyBasicPlusDa)) };
    }
    case "labour_welfare_fund_calculator": {
      const { calculateLwf } = await import("@/lib/engines/payroll-engine");
      return calculateLwf(Number(inputs.employeeContribution), Number(inputs.employerContribution));
    }
    case "bonus_calculator": {
      const { calculateBonus } = await import("@/lib/engines/payroll-engine");
      return { bonusAmount: calculateBonus(Number(inputs.annualBasicPlusDa), Number(inputs.bonusPercent)) };
    }
    case "incentive_calculator": {
      const { calculateIncentive } = await import("@/lib/engines/payroll-engine");
      const incentiveSlabs = inputs.incentiveSlabs as { minAchievementPercent: number; incentivePercentOfTarget: number }[];
      if (!Array.isArray(incentiveSlabs)) throw new Error("incentiveSlabs must be an array");
      return { incentiveAmount: calculateIncentive(Number(inputs.achievedValue), Number(inputs.targetValue), incentiveSlabs) };
    }
    case "commission_calculator": {
      const { calculatePayrollCommission } = await import("@/lib/engines/payroll-engine");
      return { commissionAmount: calculatePayrollCommission(Number(inputs.saleAmount), Number(inputs.commissionRatePercent)) };
    }
    case "overtime_calculator": {
      const { calculateOvertime } = await import("@/lib/engines/payroll-engine");
      return { overtimeAmount: calculateOvertime(Number(inputs.monthlyBasicPlusDa), Number(inputs.standardMonthlyHours), Number(inputs.overtimeHours), inputs.multiplier ? Number(inputs.multiplier) : undefined) };
    }
    case "shift_allowance_calculator": {
      const { calculateShiftAllowance } = await import("@/lib/engines/payroll-engine");
      return { allowanceAmount: calculateShiftAllowance(Number(inputs.shiftDays), Number(inputs.allowancePerShift)) };
    }
    case "leave_encashment_calculator": {
      const { calculateLeaveEncashment } = await import("@/lib/engines/payroll-engine");
      return { encashmentAmount: calculateLeaveEncashment(Number(inputs.lastDrawnMonthlySalary), Number(inputs.unusedLeaveDays)) };
    }
    case "superannuation_calculator": {
      const { calculateSuperannuation } = await import("@/lib/engines/payroll-engine");
      return { superannuationAmount: calculateSuperannuation(Number(inputs.annualBasic), inputs.contributionPercent ? Number(inputs.contributionPercent) : undefined) };
    }
    case "full_final_settlement_calculator": {
      const { calculateFullAndFinalSettlement } = await import("@/lib/engines/payroll-engine");
      return { settlementAmount: calculateFullAndFinalSettlement({
        unpaidSalary: Number(inputs.unpaidSalary), leaveEncashment: Number(inputs.leaveEncashment),
        gratuity: inputs.gratuity ? Number(inputs.gratuity) : undefined, bonus: inputs.bonus ? Number(inputs.bonus) : undefined,
        recoveries: inputs.recoveries ? Number(inputs.recoveries) : undefined,
      }) };
    }
    case "arrear_calculator": {
      const { calculateArrears } = await import("@/lib/engines/payroll-engine");
      return { arrearAmount: calculateArrears(Number(inputs.revisedMonthlyPay), Number(inputs.originalMonthlyPay), Number(inputs.affectedMonths)) };
    }
    case "increment_calculator": {
      const { calculateIncrement } = await import("@/lib/engines/payroll-engine");
      return calculateIncrement(Number(inputs.currentSalary), Number(inputs.incrementPercent));
    }
    case "salary_revision_calculator": {
      const { calculateSalaryRevision } = await import("@/lib/engines/payroll-engine");
      const components = inputs.components as Record<string, number>;
      if (!components || typeof components !== "object" || Array.isArray(components)) throw new Error("components must be an object of {component: amount}");
      return calculateSalaryRevision(components, Number(inputs.revisionPercent));
    }
  }

  // Inventory Engine (tree4-unified/50-completion-plan area 8, Wave 168) --
  // 15 of 15 registered engines, full category complete.
  switch (engineKey) {
    case "fifo_engine": {
      const { consumeFifo } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number; receivedDate?: string; expiryDate?: string }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      return consumeFifo(lots, Number(inputs.quantityToConsume));
    }
    case "fefo_engine": {
      const { consumeFefo } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number; receivedDate?: string; expiryDate?: string }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      return consumeFefo(lots, Number(inputs.quantityToConsume));
    }
    case "weighted_average_engine": {
      const { weightedAverageCost } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      return { weightedAverageCost: weightedAverageCost(lots) };
    }
    case "standard_cost_engine": {
      const { standardCostVariance } = await import("@/lib/engines/inventory-engine");
      return standardCostVariance(Number(inputs.actualCost), Number(inputs.standardCost), Number(inputs.quantity));
    }
    case "moving_average_engine": {
      const { movingAverageAfterReceipt } = await import("@/lib/engines/inventory-engine");
      return { newAverageCost: movingAverageAfterReceipt(Number(inputs.currentQty), Number(inputs.currentAvgCost), Number(inputs.receiptQty), Number(inputs.receiptCost)) };
    }
    case "stock_valuation_engine": {
      const { valueStock } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      const method = inputs.method ? String(inputs.method) : undefined;
      if (method && !["fifo", "weighted_average"].includes(method)) throw new Error("method must be fifo or weighted_average");
      return { stockValue: valueStock(lots, method as "fifo" | "weighted_average" | undefined) };
    }
    case "inventory_aging_engine": {
      const { ageInventory } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number; receivedDate: string }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      const buckets = inputs.buckets as number[] | undefined;
      if (buckets !== undefined && !Array.isArray(buckets)) throw new Error("buckets must be an array of numbers if provided");
      return ageInventory(lots, String(inputs.asOfDate ?? ""), buckets);
    }
    case "eoq_calculator": {
      const { calculateEoq } = await import("@/lib/engines/inventory-engine");
      return { eoq: calculateEoq(Number(inputs.annualDemand), Number(inputs.orderingCostPerOrder), Number(inputs.holdingCostPerUnitPerYear)) };
    }
    case "reorder_level_calculator": {
      const { calculateReorderLevel } = await import("@/lib/engines/inventory-engine");
      return { reorderLevel: calculateReorderLevel(Number(inputs.avgDailyUsage), Number(inputs.leadTimeDays), Number(inputs.safetyStock)) };
    }
    case "safety_stock_calculator": {
      const { calculateSafetyStock } = await import("@/lib/engines/inventory-engine");
      return { safetyStock: calculateSafetyStock(Number(inputs.maxDailyUsage), Number(inputs.maxLeadTimeDays), Number(inputs.avgDailyUsage), Number(inputs.avgLeadTimeDays)) };
    }
    case "abc_analysis_engine": {
      const { abcAnalysis } = await import("@/lib/engines/inventory-engine");
      const items = inputs.items as { id: string; annualUsageValue: number }[];
      if (!Array.isArray(items)) throw new Error("items must be an array");
      return abcAnalysis(items);
    }
    case "xyz_analysis_engine": {
      const { xyzAnalysis } = await import("@/lib/engines/inventory-engine");
      const items = inputs.items as { id: string; demandHistory: number[] }[];
      if (!Array.isArray(items)) throw new Error("items must be an array");
      return xyzAnalysis(items);
    }
    case "slow_moving_inventory_engine": {
      const { findSlowMovingItems } = await import("@/lib/engines/inventory-engine");
      const items = inputs.items as { id: string; quantityOnHand: number; quantityConsumedInWindow: number }[];
      if (!Array.isArray(items)) throw new Error("items must be an array");
      return { slowMovingItemIds: findSlowMovingItems(items, inputs.thresholdTurnoverRatio ? Number(inputs.thresholdTurnoverRatio) : undefined) };
    }
    case "dead_stock_engine": {
      const { findDeadStock } = await import("@/lib/engines/inventory-engine");
      const items = inputs.items as { id: string; quantityOnHand: number; quantityConsumedInWindow: number }[];
      if (!Array.isArray(items)) throw new Error("items must be an array");
      return { deadStockItemIds: findDeadStock(items) };
    }
    case "cycle_counting_engine": {
      const { suggestCycleCountSchedule } = await import("@/lib/engines/inventory-engine");
      const abcClass = String(inputs.abcClass ?? "");
      if (!["A", "B", "C"].includes(abcClass)) throw new Error("abcClass must be A, B, or C");
      return suggestCycleCountSchedule(abcClass as "A" | "B" | "C");
    }
  }

  // HR Engine (tree4-unified/50-completion-plan area 8, Wave 168) -- 9 of 9
  // registered engines, full category complete.
  switch (engineKey) {
    case "attendance_calculator": {
      const { calculateAttendancePercent } = await import("@/lib/engines/hr-engine");
      return { attendancePercent: calculateAttendancePercent(Number(inputs.presentDays), Number(inputs.totalWorkingDays)) };
    }
    case "leave_balance_engine": {
      const { calculateLeaveBalance } = await import("@/lib/engines/hr-engine");
      return { leaveBalance: calculateLeaveBalance(Number(inputs.openingBalance), Number(inputs.accrued), Number(inputs.taken)) };
    }
    case "shift_planner": {
      const { planShifts } = await import("@/lib/engines/hr-engine");
      const employeeIds = inputs.employeeIds as string[];
      const shifts = inputs.shifts as { name: string; capacity: number }[];
      if (!Array.isArray(employeeIds) || !Array.isArray(shifts)) throw new Error("employeeIds and shifts must both be arrays");
      return planShifts(employeeIds, shifts);
    }
    case "roster_engine": {
      const { buildRoster } = await import("@/lib/engines/hr-engine");
      const employeeIds = inputs.employeeIds as string[];
      const dates = inputs.dates as string[];
      const rotationPattern = inputs.rotationPattern as string[];
      if (!Array.isArray(employeeIds) || !Array.isArray(dates) || !Array.isArray(rotationPattern)) throw new Error("employeeIds, dates, and rotationPattern must all be arrays");
      return buildRoster(employeeIds, dates, rotationPattern);
    }
    case "experience_calculator": {
      const { calculateExperienceYears } = await import("@/lib/engines/hr-engine");
      return { experienceYears: calculateExperienceYears(String(inputs.fromDate ?? ""), String(inputs.toDate ?? "")) };
    }
    case "notice_period_calculator": {
      const { calculateNoticePeriodEnd } = await import("@/lib/engines/hr-engine");
      return { noticePeriodEndDate: calculateNoticePeriodEnd(String(inputs.resignationDate ?? ""), Number(inputs.noticePeriodDays)) };
    }
    case "probation_calculator": {
      const { calculateProbationEnd } = await import("@/lib/engines/hr-engine");
      return { probationEndDate: calculateProbationEnd(String(inputs.joiningDate ?? ""), Number(inputs.probationMonths)) };
    }
    case "performance_score_calculator": {
      const { calculatePerformanceScore } = await import("@/lib/engines/hr-engine");
      const ratings = inputs.ratings as { competency: string; score: number; weight: number }[];
      if (!Array.isArray(ratings)) throw new Error("ratings must be an array");
      return { performanceScore: calculatePerformanceScore(ratings) };
    }
    case "attrition_calculator": {
      const { calculateAttritionRate } = await import("@/lib/engines/hr-engine");
      return { attritionRatePercent: calculateAttritionRate(Number(inputs.separations), Number(inputs.openingHeadcount), Number(inputs.closingHeadcount)) };
    }
  }

  // Banking Engine (tree4-unified/50-completion-plan area 8, Wave 168) --
  // 8 of 9 registered engines. bank_reconciliation_engine is a real,
  // DB-backed ERP service (suggestMatches/matchLine in erp-bank-
  // reconciliation-service.ts), not a pure calculator -- deferred, same
  // reasoning as the other already-real-service deferrals this session.
  // emi_calculator/loan_schedule_generator/amortization_engine are 3 DB
  // registry keys for the SAME computation -- calculateEmi() already
  // returns the full month-by-month amortization schedule.
  switch (engineKey) {
    case "emi_calculator":
    case "loan_schedule_generator":
    case "amortization_engine": {
      const { calculateEmi } = await import("@/lib/engines/banking-engine");
      return calculateEmi({ principal: Number(inputs.principal), annualRatePercent: Number(inputs.annualRatePercent), tenureMonths: Number(inputs.tenureMonths) });
    }
    case "banking_interest_calculator": {
      const { calculateBankingInterest } = await import("@/lib/engines/banking-engine");
      const method = inputs.method ? String(inputs.method) : undefined;
      if (method && !["simple", "compound_daily"].includes(method)) throw new Error("method must be simple or compound_daily");
      return { interest: calculateBankingInterest(Number(inputs.principal), Number(inputs.annualRatePercent), Number(inputs.days), method as "simple" | "compound_daily" | undefined) };
    }
    case "cash_flow_projection": {
      const { projectCashFlow } = await import("@/lib/engines/banking-engine");
      const movements = inputs.movements as { date: string; amount: number }[];
      if (!Array.isArray(movements)) throw new Error("movements must be an array");
      return { projection: projectCashFlow(Number(inputs.openingBalance), movements) };
    }
    case "outstanding_cheque_engine": {
      const { findOutstandingCheques } = await import("@/lib/engines/banking-engine");
      const cheques = inputs.cheques as { id: string; issueDate: string; clearedDate?: string }[];
      if (!Array.isArray(cheques)) throw new Error("cheques must be an array");
      return { outstandingChequeIds: findOutstandingCheques(cheques, String(inputs.asOfDate ?? "")) };
    }
    case "deposit_maturity_engine": {
      const { calculateDepositMaturity } = await import("@/lib/engines/banking-engine");
      return calculateDepositMaturity(Number(inputs.principal), Number(inputs.annualRatePercent), Number(inputs.tenureMonths), inputs.compoundingFrequencyPerYear ? Number(inputs.compoundingFrequencyPerYear) : undefined);
    }
    case "credit_limit_calculator": {
      const { calculateCreditLimit } = await import("@/lib/engines/banking-engine");
      return { creditLimit: calculateCreditLimit(Number(inputs.monthlyIncome), Number(inputs.multiplier), inputs.existingMonthlyObligations ? Number(inputs.existingMonthlyObligations) : undefined) };
    }
  }

  // Procurement Engine (tree4-unified/50-completion-plan area 8, Wave 169)
  // -- 7 of 7 registered engines, full category complete.
  switch (engineKey) {
    case "purchase_cost_calculator": {
      const { calculatePurchaseCost } = await import("@/lib/engines/procurement-engine");
      return { purchaseCost: calculatePurchaseCost(Number(inputs.unitPrice), Number(inputs.quantity), inputs.otherCharges ? Number(inputs.otherCharges) : undefined) };
    }
    case "vendor_comparison_engine": {
      const { rankVendors } = await import("@/lib/engines/procurement-engine");
      const vendors = inputs.vendors as { vendorId: string; priceScore: number; qualityScore: number; deliveryScore: number }[];
      if (!Array.isArray(vendors)) throw new Error("vendors must be an array");
      const weights = inputs.weights as { price: number; quality: number; delivery: number } | undefined;
      return rankVendors(vendors, weights);
    }
    case "bid_evaluation_engine": {
      const { evaluateBids } = await import("@/lib/engines/procurement-engine");
      const bids = inputs.bids as { bidderId: string; price: number; technicalScore: number }[];
      if (!Array.isArray(bids)) throw new Error("bids must be an array");
      return evaluateBids(bids, Number(inputs.minTechnicalScore));
    }
    case "purchase_price_variance_engine": {
      const { calculatePurchasePriceVariance } = await import("@/lib/engines/procurement-engine");
      return calculatePurchasePriceVariance(Number(inputs.standardPrice), Number(inputs.actualPrice), Number(inputs.quantity));
    }
    case "landed_cost_engine": {
      const { calculateLandedCost } = await import("@/lib/engines/procurement-engine");
      return calculateLandedCost({
        purchaseCost: Number(inputs.purchaseCost), freight: Number(inputs.freight),
        insurance: inputs.insurance ? Number(inputs.insurance) : undefined,
        customsDuty: inputs.customsDuty ? Number(inputs.customsDuty) : undefined,
        otherCharges: inputs.otherCharges ? Number(inputs.otherCharges) : undefined,
        quantity: Number(inputs.quantity),
      });
    }
    case "freight_allocation_engine": {
      const { allocateFreight } = await import("@/lib/engines/procurement-engine");
      const lineItems = inputs.lineItems as { id: string; weight?: number; value?: number }[];
      if (!Array.isArray(lineItems)) throw new Error("lineItems must be an array");
      const basis = inputs.basis ? String(inputs.basis) : undefined;
      if (basis && !["weight", "value"].includes(basis)) throw new Error("basis must be weight or value");
      return allocateFreight(lineItems, Number(inputs.totalFreightCost), basis as "weight" | "value" | undefined);
    }
    case "moq_optimizer": {
      const { optimizeForMoq } = await import("@/lib/engines/procurement-engine");
      return { optimizedQuantity: optimizeForMoq(Number(inputs.requiredQuantity), Number(inputs.moq), inputs.orderMultiple ? Number(inputs.orderMultiple) : undefined) };
    }
  }

  // Security Engine (tree4-unified/50-completion-plan area 8, Wave 169) --
  // 3 of 7 registered engines. encryption_engine/decryption_engine map to
  // ai-config-crypto.ts's encryptApiKey/decryptApiKey, which are narrowly
  // scoped to `ai_configurations.encrypted_api_key` (BYOK storage) via a
  // specific pgcrypto key -- not a general-purpose arbitrary-plaintext VCEL
  // engine; force-fitting them here would be misleading about what they
  // actually protect. mfa_validation_engine/session_validation_engine have
  // no standalone pure function anywhere (session validation IS auth-
  // guard.ts's requireAuth(), which needs a live Supabase session/request,
  // not simple scalar inputs; no MFA validator function was found at all).
  // All 4 deferred, documented rather than force-fit.
  switch (engineKey) {
    case "hash_generation_engine": {
      const { generateHash, generateHmac } = await import("@/lib/engines/security-engine");
      const algorithm = inputs.algorithm ? String(inputs.algorithm) : undefined;
      if (algorithm && !["sha256", "sha512"].includes(algorithm)) throw new Error("algorithm must be sha256 or sha512");
      if (inputs.secret) return { hmac: generateHmac(String(inputs.input ?? ""), String(inputs.secret), algorithm as "sha256" | "sha512" | undefined) };
      return { hash: generateHash(String(inputs.input ?? ""), algorithm as "sha256" | "sha512" | undefined) };
    }
    case "digital_signature_engine": {
      const { signData, verifySignature } = await import("@/lib/engines/security-engine");
      if (inputs.mode === "verify") {
        return { valid: verifySignature(String(inputs.data ?? ""), String(inputs.signatureHex ?? ""), String(inputs.publicKeyPem ?? "")) };
      }
      return { signatureHex: signData(String(inputs.data ?? ""), String(inputs.privateKeyPem ?? "")) };
    }
    case "access_control_evaluation_engine": {
      const { isToolAllowedForDomain } = await import("@/lib/purpose-bound-ai");
      return { allowed: isToolAllowedForDomain(inputs.domain ? String(inputs.domain) : null, inputs.codeReference ? String(inputs.codeReference) : null) };
    }
  }

  // Audit Engine (tree4-unified/50-completion-plan area 8, Wave 169) -- 7
  // of 7 registered engines, full category complete.
  switch (engineKey) {
    case "materiality_calculator": {
      const { calculateMateriality } = await import("@/lib/engines/audit-engine");
      const baseType = String(inputs.baseType ?? "");
      if (!["revenue", "net_profit", "total_assets"].includes(baseType)) throw new Error("baseType must be revenue, net_profit, or total_assets");
      return { materiality: calculateMateriality(Number(inputs.baseAmount), baseType as "revenue" | "net_profit" | "total_assets") };
    }
    case "risk_scoring_engine": {
      const { calculateRiskScore } = await import("@/lib/engines/audit-engine");
      const factors = inputs.factors as { name: string; score: number; weight: number }[];
      if (!Array.isArray(factors)) throw new Error("factors must be an array");
      return { riskScore: calculateRiskScore(factors) };
    }
    case "duplicate_invoice_detector": {
      const { detectDuplicateInvoices } = await import("@/lib/engines/audit-engine");
      const invoices = inputs.invoices as { id: string; vendorId: string; invoiceNumber: string; amount: number }[];
      if (!Array.isArray(invoices)) throw new Error("invoices must be an array");
      return { duplicateGroups: detectDuplicateInvoices(invoices) };
    }
    case "duplicate_payment_detector": {
      const { detectDuplicatePayments } = await import("@/lib/engines/audit-engine");
      const payments = inputs.payments as { id: string; payeeId: string; amount: number; date: string }[];
      if (!Array.isArray(payments)) throw new Error("payments must be an array");
      return { duplicateGroups: detectDuplicatePayments(payments) };
    }
    case "journal_risk_analyzer": {
      const { analyzeJournalRisk } = await import("@/lib/engines/audit-engine");
      return analyzeJournalRisk({
        amount: Number(inputs.amount), postedAt: String(inputs.postedAt ?? ""),
        isManual: truthy(inputs.isManual), periodEndDate: String(inputs.periodEndDate ?? ""),
      });
    }
    case "benford_analysis_engine": {
      const { benfordAnalysis } = await import("@/lib/engines/audit-engine");
      const values = inputs.values as number[];
      if (!Array.isArray(values)) throw new Error("values must be an array of numbers");
      return benfordAnalysis(values.map(Number));
    }
    case "exception_detection_engine": {
      const { detectExceptions } = await import("@/lib/engines/audit-engine");
      const values = inputs.values as number[];
      if (!Array.isArray(values)) throw new Error("values must be an array of numbers");
      return { exceptions: detectExceptions(values.map(Number), inputs.zScoreThreshold ? Number(inputs.zScoreThreshold) : undefined) };
    }
  }

  // AI Support Engine (tree4-unified/50-completion-plan area 8, Wave 169)
  // -- 2 of 7 registered engines. context_compressor_engine/
  // cost_estimator_engine/prompt_compiler_engine/response_validator_engine/
  // semantic_cache_engine are, per ai-support-engine.ts's own header
  // comment, already real infrastructure deeply embedded in prompt-os-
  // resolver.ts/embeddings.ts/llm-client.ts/ai-workforce-agent.mjs rather
  // than standalone pure functions -- deferred, same reasoning as every
  // other already-real-elsewhere deferral this session.
  switch (engineKey) {
    case "tool_selector_engine": {
      const { selectTool } = await import("@/lib/engines/ai-support-engine");
      const availableTools = inputs.availableTools as string[];
      if (!Array.isArray(availableTools)) throw new Error("availableTools must be an array");
      return { selectedTool: selectTool(String(inputs.requestedCapability ?? ""), availableTools) };
    }
    case "context_deduplicator_engine": {
      const { deduplicateContextLines } = await import("@/lib/engines/ai-support-engine");
      const lines = inputs.lines as string[];
      if (!Array.isArray(lines)) throw new Error("lines must be an array of strings");
      return { deduplicatedLines: deduplicateContextLines(lines) };
    }
  }

  // Compliance Engine (tree4-unified/50-completion-plan area 8, Wave 169)
  // -- 4 of 6 registered engines. due_date_calculator/
  // compliance_calendar_engine are already implemented as core product
  // features (compliance-service.ts), not standalone pure functions here.
  switch (engineKey) {
    case "compliance_interest_calculator": {
      const { calculateComplianceInterest } = await import("@/lib/engines/compliance-engine");
      return { interest: calculateComplianceInterest(Number(inputs.amount), Number(inputs.annualRatePercent), Number(inputs.daysLate)) };
    }
    case "filing_eligibility_engine": {
      const { checkFilingEligibility } = await import("@/lib/engines/compliance-engine");
      const preconditions = inputs.preconditions as { name: string; met: boolean }[];
      if (!Array.isArray(preconditions)) throw new Error("preconditions must be an array");
      return checkFilingEligibility(preconditions);
    }
    case "document_completeness_checker": {
      const { checkDocumentCompleteness } = await import("@/lib/engines/compliance-engine");
      const requiredDocuments = inputs.requiredDocuments as string[];
      const filedDocuments = inputs.filedDocuments as string[];
      if (!Array.isArray(requiredDocuments) || !Array.isArray(filedDocuments)) throw new Error("requiredDocuments and filedDocuments must both be arrays");
      return checkDocumentCompleteness(requiredDocuments, filedDocuments);
    }
    case "compliance_risk_scoring": {
      const { calculateComplianceRiskScore } = await import("@/lib/engines/compliance-engine");
      return { riskScore: calculateComplianceRiskScore({
        overdueItemsCount: Number(inputs.overdueItemsCount), pastPenaltiesCount: Number(inputs.pastPenaltiesCount), totalItemsCount: Number(inputs.totalItemsCount),
      }) };
    }
  }

  // Analytics Engine (tree4-unified/50-completion-plan area 8, Wave 169)
  // -- 6 of 6 registered engines, full category complete. anomaly_detection_
  // engine supports both of the file's two detection methods (z-score,
  // the registry's own recommended default, and IQR) via a `method` input.
  switch (engineKey) {
    case "trend_analysis_engine": {
      const { analyzeTrend } = await import("@/lib/engines/analytics-engine");
      const values = inputs.values as number[];
      if (!Array.isArray(values)) throw new Error("values must be an array of numbers");
      return analyzeTrend(values.map(Number));
    }
    case "analytics_variance_engine": {
      const { analyzeAnalyticsVariance } = await import("@/lib/engines/analytics-engine");
      return analyzeAnalyticsVariance(Number(inputs.actual), Number(inputs.expected));
    }
    case "benchmark_comparison_engine": {
      const { compareToBenchmark } = await import("@/lib/engines/analytics-engine");
      return compareToBenchmark(Number(inputs.actualValue), Number(inputs.benchmarkValue));
    }
    case "forecast_baseline_engine": {
      const { forecastBaseline } = await import("@/lib/engines/analytics-engine");
      const historicalValues = inputs.historicalValues as number[];
      if (!Array.isArray(historicalValues)) throw new Error("historicalValues must be an array of numbers");
      const method = inputs.method ? String(inputs.method) : undefined;
      if (method && !["naive", "moving_average"].includes(method)) throw new Error("method must be naive or moving_average");
      return { forecast: forecastBaseline(historicalValues.map(Number), method as "naive" | "moving_average" | undefined, inputs.windowSize ? Number(inputs.windowSize) : undefined) };
    }
    case "anomaly_detection_engine": {
      const { detectAnomaliesZScore, detectAnomaliesIqr } = await import("@/lib/engines/analytics-engine");
      const values = inputs.values as number[];
      if (!Array.isArray(values)) throw new Error("values must be an array of numbers");
      const method = inputs.method ? String(inputs.method) : "zscore";
      if (!["zscore", "iqr"].includes(method)) throw new Error("method must be zscore or iqr");
      const anomalies = method === "iqr" ? detectAnomaliesIqr(values.map(Number)) : detectAnomaliesZScore(values.map(Number), inputs.threshold ? Number(inputs.threshold) : undefined);
      return { anomalies };
    }
    case "correlation_calculator": {
      const { calculateCorrelation } = await import("@/lib/engines/analytics-engine");
      const xValues = inputs.xValues as number[];
      const yValues = inputs.yValues as number[];
      if (!Array.isArray(xValues) || !Array.isArray(yValues)) throw new Error("xValues and yValues must both be arrays");
      return { correlation: calculateCorrelation(xValues.map(Number), yValues.map(Number)) };
    }
  }

  // Logistics Engine (tree4-unified/50-completion-plan area 8, Wave 169)
  // -- 6 of 6 registered engines, full category complete.
  switch (engineKey) {
    case "route_optimization_engine": {
      const { optimizeRouteNearestNeighbor } = await import("@/lib/engines/logistics-engine");
      const points = inputs.points as { id: string; lat: number; lng: number }[];
      if (!Array.isArray(points)) throw new Error("points must be an array");
      return optimizeRouteNearestNeighbor(points);
    }
    case "freight_calculator": {
      const { calculateFreightCost } = await import("@/lib/engines/logistics-engine");
      return calculateFreightCost(Number(inputs.actualWeightKg), Number(inputs.volumeCbm), Number(inputs.ratePerKg), inputs.volumetricDivisor ? Number(inputs.volumetricDivisor) : undefined);
    }
    case "delivery_eta_engine": {
      const { estimateDeliveryEta } = await import("@/lib/engines/logistics-engine");
      return estimateDeliveryEta(Number(inputs.distanceKm), Number(inputs.avgSpeedKmh), inputs.handlingBufferHours ? Number(inputs.handlingBufferHours) : undefined);
    }
    case "vehicle_utilization_engine": {
      const { calculateVehicleUtilization } = await import("@/lib/engines/logistics-engine");
      return { utilizationPercent: calculateVehicleUtilization(Number(inputs.loadedWeightKg), Number(inputs.vehicleCapacityKg)) };
    }
    case "container_utilization_engine": {
      const { calculateContainerUtilization } = await import("@/lib/engines/logistics-engine");
      return { utilizationPercent: calculateContainerUtilization(Number(inputs.loadedVolumeCbm), Number(inputs.containerCapacityCbm)) };
    }
    case "shipment_cost_calculator": {
      const { calculateShipmentCost } = await import("@/lib/engines/logistics-engine");
      return { shipmentCost: calculateShipmentCost({
        freight: Number(inputs.freight), handling: inputs.handling ? Number(inputs.handling) : undefined,
        insurance: inputs.insurance ? Number(inputs.insurance) : undefined, customs: inputs.customs ? Number(inputs.customs) : undefined,
      }) };
    }
  }

  // Marketing Engine (tree4-unified/50-completion-plan area 8, Wave 170)
  // -- 6 of 6 registered engines, full category complete.
  switch (engineKey) {
    case "marketing_roi_calculator": {
      const { calculateMarketingRoi } = await import("@/lib/engines/marketing-engine");
      return { roiPercent: calculateMarketingRoi(Number(inputs.revenueGenerated), Number(inputs.marketingSpend)) };
    }
    case "cac_calculator": {
      const { calculateCac } = await import("@/lib/engines/marketing-engine");
      return { cac: calculateCac(Number(inputs.totalAcquisitionSpend), Number(inputs.newCustomersAcquired)) };
    }
    case "roas_calculator": {
      const { calculateRoas } = await import("@/lib/engines/marketing-engine");
      return { roas: calculateRoas(Number(inputs.revenueFromAds), Number(inputs.adSpend)) };
    }
    case "attribution_engine": {
      const { attributeConversionLinear } = await import("@/lib/engines/marketing-engine");
      const touchpoints = inputs.touchpoints as { channel: string }[];
      if (!Array.isArray(touchpoints)) throw new Error("touchpoints must be an array");
      return attributeConversionLinear(touchpoints, Number(inputs.conversionValue));
    }
    case "campaign_scoring_engine": {
      const { calculateCampaignScore } = await import("@/lib/engines/marketing-engine");
      const weights = inputs.weights as { reach: number; engagement: number; conversion: number } | undefined;
      return { campaignScore: calculateCampaignScore({
        reachScore: Number(inputs.reachScore), engagementScore: Number(inputs.engagementScore), conversionScore: Number(inputs.conversionScore),
      }, weights) };
    }
    case "funnel_conversion_calculator": {
      const { calculateFunnelConversion } = await import("@/lib/engines/marketing-engine");
      const stageCounts = inputs.stageCounts as { stage: string; count: number }[];
      if (!Array.isArray(stageCounts)) throw new Error("stageCounts must be an array");
      return { funnel: calculateFunnelConversion(stageCounts) };
    }
  }

  // Project Management Engine (tree4-unified/50-completion-plan area 8,
  // Wave 170) -- 6 of 6 registered engines, full category complete.
  switch (engineKey) {
    case "critical_path_engine": {
      const { calculateCriticalPath } = await import("@/lib/engines/project-management-engine");
      const tasks = inputs.tasks as { id: string; duration: number; dependsOn: string[] }[];
      if (!Array.isArray(tasks)) throw new Error("tasks must be an array");
      return { criticalPath: calculateCriticalPath(tasks) };
    }
    case "resource_allocation_engine": {
      const { allocateResources } = await import("@/lib/engines/project-management-engine");
      const tasks = inputs.tasks as { id: string; requiredCapacity: number; priority: number }[];
      if (!Array.isArray(tasks)) throw new Error("tasks must be an array");
      return allocateResources(tasks, Number(inputs.availableCapacity));
    }
    case "cost_variance_engine": {
      const { calculateCostVariance } = await import("@/lib/engines/project-management-engine");
      return { costVariance: calculateCostVariance(Number(inputs.earnedValue), Number(inputs.actualCost)) };
    }
    case "schedule_variance_engine": {
      const { calculateScheduleVariance } = await import("@/lib/engines/project-management-engine");
      return { scheduleVariance: calculateScheduleVariance(Number(inputs.earnedValue), Number(inputs.plannedValue)) };
    }
    case "earned_value_calculator": {
      const { calculateEarnedValueMetrics } = await import("@/lib/engines/project-management-engine");
      return calculateEarnedValueMetrics({
        plannedValue: Number(inputs.plannedValue), earnedValue: Number(inputs.earnedValue),
        actualCost: Number(inputs.actualCost), budgetAtCompletion: Number(inputs.budgetAtCompletion),
      });
    }
    case "burndown_calculator": {
      const { calculateBurndown } = await import("@/lib/engines/project-management-engine");
      const completedPointsByDay = inputs.completedPointsByDay as number[];
      if (!Array.isArray(completedPointsByDay)) throw new Error("completedPointsByDay must be an array");
      return { burndown: calculateBurndown(Number(inputs.totalStoryPoints), Number(inputs.sprintDays), completedPointsByDay.map(Number)) };
    }
  }

  // CRM Engine (tree4-unified/50-completion-plan area 8, Wave 170) -- 5 of
  // 5 registered engines, full category complete.
  switch (engineKey) {
    case "customer_lifetime_value_calculator": {
      const { calculateCustomerLifetimeValue } = await import("@/lib/engines/crm-engine");
      return { clv: calculateCustomerLifetimeValue(Number(inputs.avgOrderValue), Number(inputs.purchaseFrequencyPerYear), Number(inputs.customerLifespanYears)) };
    }
    case "churn_probability_calculator": {
      const { calculateChurnProbability } = await import("@/lib/engines/crm-engine");
      return { churnProbability: calculateChurnProbability(Number(inputs.daysSinceLastActivity), Number(inputs.engagementDeclinePercent)) };
    }
    case "rfm_scoring_engine": {
      const { calculateRfmScore } = await import("@/lib/engines/crm-engine");
      const customers = inputs.customers as { id: string; recencyDays: number; frequency: number; monetary: number }[];
      if (!Array.isArray(customers)) throw new Error("customers must be an array");
      return calculateRfmScore(customers);
    }
    case "opportunity_score_calculator": {
      const { calculateOpportunityScore } = await import("@/lib/engines/crm-engine");
      return { opportunityScore: calculateOpportunityScore({
        budget: Number(inputs.budget), authority: Number(inputs.authority), need: Number(inputs.need), timeline: Number(inputs.timeline),
      }) };
    }
    case "customer_health_score": {
      const { calculateCustomerHealthScore } = await import("@/lib/engines/crm-engine");
      const weights = inputs.weights as { usage: number; support: number; payment: number } | undefined;
      return { healthScore: calculateCustomerHealthScore({
        usageScore: Number(inputs.usageScore), supportScore: Number(inputs.supportScore), paymentScore: Number(inputs.paymentScore),
      }, weights) };
    }
  }

  // Sales Engine (tree4-unified/50-completion-plan area 8, Wave 170) -- 7
  // of 7 registered engines, full category complete. markup_calculator
  // supports both directions of the markup relationship (compute markup%
  // from prices, or compute a price from cost+markup%) via a `mode` input.
  switch (engineKey) {
    case "margin_calculator": {
      const { calculateMargin } = await import("@/lib/engines/sales-engine");
      return { marginPercent: calculateMargin(Number(inputs.sellingPrice), Number(inputs.cost)) };
    }
    case "markup_calculator": {
      const { calculateMarkup, priceFromMarkup } = await import("@/lib/engines/sales-engine");
      if (inputs.mode === "price_from_markup") {
        return { price: priceFromMarkup(Number(inputs.cost), Number(inputs.markupPercent)) };
      }
      return { markupPercent: calculateMarkup(Number(inputs.sellingPrice), Number(inputs.cost)) };
    }
    case "sales_incentive_calculator": {
      const { calculateSalesIncentive } = await import("@/lib/engines/sales-engine");
      const slabs = inputs.slabs as { minAchievementPercent: number; incentivePercentOfSales: number }[];
      if (!Array.isArray(slabs)) throw new Error("slabs must be an array");
      return { incentiveAmount: calculateSalesIncentive(Number(inputs.achievedSales), Number(inputs.targetSales), slabs) };
    }
    case "pricing_engine": {
      const { priceForTargetMargin } = await import("@/lib/engines/sales-engine");
      return { price: priceForTargetMargin(Number(inputs.cost), Number(inputs.targetMarginPercent)) };
    }
    case "quote_optimizer": {
      const { optimizeQuoteDiscount } = await import("@/lib/engines/sales-engine");
      return { maxDiscountPercent: optimizeQuoteDiscount(Number(inputs.cost), Number(inputs.listPrice), Number(inputs.minAcceptableMarginPercent)) };
    }
    case "sales_forecast_engine": {
      const { forecastSales } = await import("@/lib/engines/sales-engine");
      const historicalValues = inputs.historicalValues as number[];
      if (!Array.isArray(historicalValues)) throw new Error("historicalValues must be an array");
      return { forecast: forecastSales(historicalValues.map(Number), Number(inputs.periodsAhead)) };
    }
    case "pipeline_probability_engine": {
      const { calculatePipelineExpectedValue } = await import("@/lib/engines/sales-engine");
      const deals = inputs.deals as { stage: string; amount: number }[];
      if (!Array.isArray(deals)) throw new Error("deals must be an array");
      return { expectedValue: calculatePipelineExpectedValue(deals) };
    }
  }

  // Fixed Asset Engine (tree4-unified/50-completion-plan area 8, Wave 170)
  // -- 8 of 8 registered engines, full category complete.
  switch (engineKey) {
    case "straight_line_depreciation_engine": {
      const { straightLineDepreciation } = await import("@/lib/engines/fixed-asset-engine");
      return { schedule: straightLineDepreciation({ cost: Number(inputs.cost), salvageValue: Number(inputs.salvageValue), usefulLifeYears: Number(inputs.usefulLifeYears) }) };
    }
    case "wdv_depreciation_engine": {
      const { writtenDownValueDepreciation } = await import("@/lib/engines/fixed-asset-engine");
      return { schedule: writtenDownValueDepreciation({
        cost: Number(inputs.cost), salvageValue: Number(inputs.salvageValue), usefulLifeYears: Number(inputs.usefulLifeYears),
        rate: inputs.rate ? Number(inputs.rate) : undefined,
      }) };
    }
    case "useful_life_calculator": {
      const { calculateRemainingUsefulLife } = await import("@/lib/engines/fixed-asset-engine");
      return { remainingUsefulLifeYears: calculateRemainingUsefulLife(Number(inputs.originalUsefulLifeYears), Number(inputs.ageInYears)) };
    }
    case "asset_transfer_engine": {
      const { transferAsset } = await import("@/lib/engines/fixed-asset-engine");
      return transferAsset(Number(inputs.netBookValue), String(inputs.fromLocation ?? ""), String(inputs.toLocation ?? ""));
    }
    case "asset_disposal_engine": {
      const { calculateDisposalGainLoss } = await import("@/lib/engines/fixed-asset-engine");
      return calculateDisposalGainLoss(Number(inputs.netBookValue), Number(inputs.saleProceeds));
    }
    case "capitalization_engine": {
      const { shouldCapitalize } = await import("@/lib/engines/fixed-asset-engine");
      return { shouldCapitalize: shouldCapitalize(Number(inputs.expenseAmount), Number(inputs.capitalizationThreshold), truthy(inputs.extendsUsefulLife)) };
    }
    case "revaluation_engine": {
      const { revalueAsset } = await import("@/lib/engines/fixed-asset-engine");
      return revalueAsset(Number(inputs.currentNetBookValue), Number(inputs.fairValue));
    }
    case "impairment_engine": {
      const { calculateImpairmentLoss } = await import("@/lib/engines/fixed-asset-engine");
      return calculateImpairmentLoss(Number(inputs.carryingValue), Number(inputs.recoverableAmount));
    }
  }

  // Data Quality Engine (tree4-unified/50-completion-plan area 8, Wave 170)
  // -- 7 of 8 registered engines (pan_validation_engine already wired
  // separately for the TDS/TCS category, reusing the same isValidPanFormat
  // here under this category's own key). data_duplicate_detection_engine
  // has no standalone pure function anywhere in this codebase -- deferred,
  // not force-fit onto document-processing-engine.ts's hash-based
  // duplicate detector, which is shaped for documents specifically.
  switch (engineKey) {
    case "pan_validation_engine_dq": {
      const { isValidPanFormat } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidPanFormat(String(inputs.pan ?? "")) };
    }
    case "gstin_validation_engine": {
      const { isValidGstin, isValidGstinFormat } = await import("@/lib/engines/data-quality-engine");
      return { validFormat: isValidGstinFormat(String(inputs.gstin ?? "")), validChecksum: isValidGstin(String(inputs.gstin ?? "")) };
    }
    case "ifsc_validation_engine": {
      const { isValidIfscFormat } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidIfscFormat(String(inputs.ifsc ?? "")) };
    }
    case "email_validation_engine": {
      const { isValidEmail } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidEmail(String(inputs.email ?? "")) };
    }
    case "phone_validation_engine": {
      const { isValidPhoneNumber } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidPhoneNumber(String(inputs.phone ?? ""), inputs.defaultCountry ? String(inputs.defaultCountry) : undefined) };
    }
    case "bank_account_validation_engine": {
      const { isValidBankAccountFormat } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidBankAccountFormat(String(inputs.accountNumber ?? "")) };
    }
    case "address_standardization_engine": {
      const { standardizeAddress } = await import("@/lib/engines/data-quality-engine");
      return { standardizedAddress: standardizeAddress(String(inputs.address ?? "")) };
    }
  }

  // Document Processing Engine (tree4-unified/50-completion-plan area 8,
  // Wave 170) -- 1 of 1 registered engine, full category complete.
  switch (engineKey) {
    case "duplicate_document_detection_engine": {
      const { detectDuplicateDocumentsByHash } = await import("@/lib/engines/document-processing-engine");
      const documents = inputs.documents as { id: string; contentHash: string }[];
      if (!Array.isArray(documents)) throw new Error("documents must be an array");
      return { duplicateGroups: detectDuplicateDocumentsByHash(documents) };
    }
  }

  switch (engineKey) {
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
      await db.insert(taskAgentExecutions).values({
        taskExecutionPlanId: planRow.id, workerAgentId: agent.id, startedAt, completedAt: new Date(),
        status: "failed", input: {}, errorMessage: message,
      });
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

async function executeEngineDispatch(orgId: string, userId: string, taskId: string, engineKey: string, engineInputs: Record<string, unknown>): Promise<void> {
  await withTenantContext({ orgId, userId }, async (db) => {
    try {
      const output = await dispatchEngine(db, orgId, engineKey, engineInputs);
      assertValidDispatchOutput(output);
      await db.insert(taskChatMessages).values({ taskId, role: "assistant", content: `Result: ${JSON.stringify(output)}` });
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
    return await findOrCreateCapability({ modePill: chain.modePill, pathKeys: chain.pathKeys as string[], promptText, orgId: null });
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

      const modelConfig = await resolveModelConfig(orgId, "task_oa");
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
        systemPrompt, userMessage, { temperature: 0.1, maxTokens: 500 }, effectiveConfig.fallback
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
          const escalated = escalatedPlatformConfig();
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
      const escalated = escalatedPlatformConfig();
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
    const callPlanning = () => callLLMJson<PlanningResult>(
      effectiveConfig.provider, effectiveConfig.model, effectiveConfig.apiKey, systemPrompt, userMessage,
      { temperature: 0.3, maxTokens: 800 }, effectiveConfig.fallback
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
        const escalated = escalatedPlatformConfig();
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
