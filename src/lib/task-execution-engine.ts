import { workerAgents, tasks, taskExecutionPlan, taskAgentExecutions, taskChatMessages, complianceItems, departments, notices, users, gstCanonicalInvoices, gstReturnPeriods } from "@/lib/db";
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
      assertValidDispatchOutput(output);
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
      const output = await dispatchEngine(db, orgId, engineKey, engineInputs);
      assertValidDispatchOutput(output);
      await db.insert(taskChatMessages).values({ taskId, role: "assistant", content: `Result: ${JSON.stringify(output)}` });
      await db.update(tasks).set({ status: "completed", updatedAt: new Date() }).where(eq(tasks.id, taskId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      await db.insert(taskChatMessages).values({ taskId, role: "system", content: `Calculation failed: ${message}` });
      await db.update(tasks).set({ status: "failed", updatedAt: new Date() }).where(eq(tasks.id, taskId));
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
      if (preCall.shouldEscalate) {
        const escalated = escalatedPlatformConfig();
        if (escalated) {
          effectiveConfig = escalated;
          escalation = { escalated: true, signals: preCall.signals, matchedPhrase: preCall.matchedPhrase, originalModel: modelConfig.model };
        }
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
