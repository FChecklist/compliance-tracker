import { tasks, complianceItems, departments, notices, users } from "@/lib/db";
import { type TenantDb } from "@/lib/db/tenant-scoped";
import { eq, and, asc, gte, lte, ne, sql } from "drizzle-orm";
import { VALID_TYPES as VALID_COMPLIANCE_TYPES } from "@/lib/services/compliance-service";
import { logActivity } from "@/lib/audit";

/**
 * VERIDIAN Review Framework gap-closure (AI Engineering Quality: Overall
 * Code Quality, 2026-08-15): extracted from task-execution-engine.ts, which
 * had grown to 2437 lines mixing three distinct responsibilities (tool
 * dispatch, computation-engine dispatch, and task orchestration) in one
 * file. This module owns exactly one of those: `dispatchTool()`, the
 * allowlisted switch that resolves a worker agent's `codeReference` to a
 * real read (compliance/GST/construction) or a narrowly-scoped write
 * (update_compliance_status/create_compliance_item, both driven by
 * human-clicked inputs, never LLM-guessed text -- see each case's own
 * comment below for why that one is safe to auto-dispatch).
 *
 * task-execution-engine.ts re-exports `dispatchTool` unchanged, so its two
 * existing external call sites (src/app/api/v1/projexa/assistant/route.ts,
 * src/lib/services/fde-service.ts) and its own internal callers
 * (executeStructuredDispatch, the free-text planning path in executeTask)
 * did not need to change. See task-execution-engine.ts's own header for the
 * sibling split (engine-dispatch.ts) and why the orchestration layer stayed
 * behind in that file.
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
