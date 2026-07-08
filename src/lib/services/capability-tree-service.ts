// Assembles the cascading task-chain selector's option tree from REAL
// registered capabilities -- no hand-authored taxonomy. This is the one
// genuinely new piece the persistent VERI Chat composer needed (everything
// else -- tasks, taskChatMessages, conversations, /veri-todo -- already
// existed and is reused as-is, not rebuilt).
//
// Tree shape: org's enabled product branches -> their active modules,
// grouped by domain -> real Worker Agents serving that domain (falling back
// to the module list itself if no agent has been built for that domain
// yet) -> Product -> that product's real Projects (Wave 19 L2 scope layer),
// each with a generic project-action leaf set carrying the real projectId
// for direct tasks.projectId scoping -> plus Customer/Vendor top-level
// branches populated from real erpCustomers/erpSuppliers, each with a
// generic entity-action leaf set. The tree is only ever as complete as
// what's actually enabled/registered for this org -- it grows automatically
// as more branches/modules/agents/products/projects/customers get added,
// rather than needing a taxonomy maintainer.
import {
  orgProductBranchEnablements, productBranches, productBranchModules, moduleRegistry,
  workerAgents, erpCustomers, erpSuppliers, products, projects, computationEngines, complianceItems,
  gstImportBatches, gstCanonicalInvoices, gstReturnPeriods,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, ne, asc, desc } from "drizzle-orm"

// The 6 real compliance_status enum values -- shown as clickable targets,
// not a free-text field, so "update status" dispatch needs zero typing.
const COMPLIANCE_STATUS_VALUES = ["pending", "in_progress", "completed", "overdue", "not_applicable", "draft"] as const

export type CapabilityInputField = { key: string; label: string; type: "number" | "text"; optional?: boolean }

export type CapabilityNode = {
  key: string
  label: string
  leaf: boolean
  multi?: boolean
  codeReference?: string | null
  projectId?: string | null
  engineKey?: string | null
  inputFields?: CapabilityInputField[]
  agentId?: string | null
  fixedInputs?: Record<string, string>
  children?: CapabilityNode[]
}

// First VCEL slice wired into real dispatch (see task-execution-engine.ts's
// dispatchEngine() -- a small reviewed allowlist, not a generic resolver).
// Covers 15 of the 16 GST Engine category rows (all with clean file:function
// implementation_ref values) -- gst_return_validation_engine is the lone
// holdout, since its `lineItems: unknown[]` argument doesn't fit a simple
// labeled-field form the way every other GST function's arguments do.
// Everything outside GST Engine (Fixed Asset, Income Tax, Mathematical, ~200
// more) needs the same treatment in a later pass, not attempted here.
const GST_SPLIT_FIELDS: CapabilityInputField[] = [
  { key: "taxableAmount", label: "Taxable amount (₹)", type: "number" },
  { key: "gstRatePercent", label: "GST rate (%)", type: "number" },
  { key: "supplierStateCode", label: "Supplier state code", type: "text" },
  { key: "buyerStateCode", label: "Buyer state code", type: "text" },
]

const WIRED_ENGINE_INPUT_FIELDS: Record<string, CapabilityInputField[]> = {
  gst_split_engine: GST_SPLIT_FIELDS,
  cgst_engine: GST_SPLIT_FIELDS,
  sgst_engine: GST_SPLIT_FIELDS,
  igst_engine: GST_SPLIT_FIELDS,
  utgst_engine: GST_SPLIT_FIELDS,
  gst_calculation_engine: [
    { key: "taxableAmount", label: "Amount (₹)", type: "number" },
    { key: "gstRatePercent", label: "GST rate (%)", type: "number" },
    { key: "supplierStateCode", label: "Supplier state code", type: "text" },
    { key: "buyerStateCode", label: "Buyer state code", type: "text" },
  ],
  reverse_charge_engine: [
    ...GST_SPLIT_FIELDS,
    { key: "isReverseCharge", label: "Reverse charge? (yes/no)", type: "text" },
  ],
  hsn_validation_engine: [{ key: "hsn", label: "HSN code", type: "text" }],
  sac_validation_engine: [{ key: "sac", label: "SAC code", type: "text" }],
  eway_bill_validation_engine: [{ key: "ebn", label: "E-way bill number", type: "text" }],
  gst_exclusive_engine: [
    { key: "taxableAmount", label: "Taxable amount (₹)", type: "number" },
    { key: "gstRatePercent", label: "GST rate (%)", type: "number" },
  ],
  gst_inclusive_engine: [
    { key: "inclusiveAmount", label: "Inclusive amount (₹)", type: "number" },
    { key: "gstRatePercent", label: "GST rate (%)", type: "number" },
  ],
  gst_interest_engine: [
    { key: "taxAmount", label: "Tax amount (₹)", type: "number" },
    { key: "daysLate", label: "Days late", type: "number" },
    { key: "isExcessItcClaim", label: "Excess ITC claim? (yes/no, optional)", type: "text", optional: true },
  ],
  gst_late_fee_engine: [
    { key: "daysLate", label: "Days late", type: "number" },
    { key: "isNilReturn", label: "Nil return? (yes/no, optional)", type: "text", optional: true },
  ],
  itc_calculation_engine: [
    { key: "totalItcAvailable", label: "Total ITC available (₹)", type: "number" },
    { key: "blockedCreditAmount", label: "Blocked credit amount (₹)", type: "number" },
    { key: "exemptSupplyRatio", label: "Exempt supply ratio 0-1 (optional)", type: "number", optional: true },
  ],
}

// Generic entity actions -- real Worker Agents that operate "on a specific
// customer/vendor" (invoice prep, reminders, GST filing) aren't domain-
// grouped the same way as Finance/Compliance/etc. agents are, so this list
// is the placeholder leaf set until those get their own domain tagging.
const GENERIC_ENTITY_ACTIONS: CapabilityNode[] = [
  { key: "invoice_preparation", label: "Invoice preparation", leaf: true },
  { key: "send_reminder", label: "Send reminder", leaf: true },
  { key: "gst_filing", label: "GST filing", leaf: true },
]

// Same placeholder-leaf-set idea as GENERIC_ENTITY_ACTIONS, but for a
// specific real project -- each leaf carries that project's real id so the
// composer can pass it straight through to tasks.projectId (createTask
// already accepts projectId, Wave 19) instead of relying on breadcrumb text
// alone.
function genericProjectActions(projectId: string): CapabilityNode[] {
  return [
    { key: "status_update", label: "Status update", leaf: true, projectId },
    { key: "log_task", label: "Log a task", leaf: true, projectId },
    { key: "flag_risk", label: "Flag a risk", leaf: true, projectId },
  ]
}

export async function buildCapabilityTree(ctx: { orgId: string }): Promise<CapabilityNode[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const branchNodes = await buildBranchNodes(db, ctx.orgId)
    const productNodes = await buildProductNodes(db, ctx.orgId)
    const entityNodes = await buildEntityNodes(db, ctx.orgId)
    const complianceItemNodes = await buildComplianceItemNodes(db, ctx.orgId)
    const calculatorNodes = await buildCalculatorNodes(db)
    const gstReconciliationNodes = await buildGstReconciliationNodes(db, ctx.orgId)
    return [...branchNodes, ...productNodes, ...entityNodes, ...complianceItemNodes, ...calculatorNodes, ...gstReconciliationNodes]
  })
}

// Calculators -- sourced from the real computation_engines registry (VCEL),
// scoped to just the engine_keys dispatchTool() actually knows how to run
// (WIRED_ENGINE_INPUT_FIELDS above). Not org-scoped like the other branches
// (a calculator isn't a per-org capability), so this doesn't need a
// productBranch/enablement check the way buildBranchNodes does.
async function buildCalculatorNodes(db: TenantDb): Promise<CapabilityNode[]> {
  const wiredKeys = Object.keys(WIRED_ENGINE_INPUT_FIELDS)
  const engines = await db.query.computationEngines.findMany({
    where: and(inArray(computationEngines.engineKey, wiredKeys), eq(computationEngines.status, "implemented")),
  })
  if (engines.length === 0) return []

  const byCategory = new Map<string, CapabilityNode[]>()
  for (const engine of engines) {
    const leaf: CapabilityNode = {
      key: engine.engineKey, label: engine.name, leaf: true,
      engineKey: engine.engineKey, inputFields: WIRED_ENGINE_INPUT_FIELDS[engine.engineKey],
    }
    const bucket = byCategory.get(engine.category) ?? []
    bucket.push(leaf)
    byCategory.set(engine.category, bucket)
  }

  const categoryNodes: CapabilityNode[] = Array.from(byCategory.entries()).map(([category, leaves]) => ({
    key: category, label: category, leaf: false, children: leaves,
  }))

  return [{ key: "calculators", label: "Calculators", leaf: false, children: categoryNodes }]
}

async function buildBranchNodes(db: TenantDb, orgId: string): Promise<CapabilityNode[]> {
  const enablements = await db.query.orgProductBranchEnablements.findMany({
    where: and(eq(orgProductBranchEnablements.orgId, orgId), eq(orgProductBranchEnablements.isEnabled, true)),
  })
  if (enablements.length === 0) return []

  const branchIds = enablements.map((e) => e.productBranchId)
  const branches = await db.query.productBranches.findMany({ where: inArray(productBranches.id, branchIds) })

  const tree: CapabilityNode[] = []
  for (const branch of branches) {
    const links = await db.query.productBranchModules.findMany({
      where: and(eq(productBranchModules.productBranchId, branch.id), eq(productBranchModules.isEnabled, true)),
    })
    const moduleKeys = links.map((l) => l.moduleKey)
    if (moduleKeys.length === 0) continue

    const modules = await db.query.moduleRegistry.findMany({
      where: and(inArray(moduleRegistry.moduleKey, moduleKeys), eq(moduleRegistry.isActive, true)),
    })
    if (modules.length === 0) continue

    const domains = Array.from(new Set(modules.map((m) => m.domain)))
    const domainNodes: CapabilityNode[] = []
    for (const domain of domains) {
      const modsInDomain = modules.filter((m) => m.domain === domain)
      const agents = await db.query.workerAgents.findMany({
        where: and(
          inArray(workerAgents.lifecycleStatus, ["approved", "published"]),
          inArray(workerAgents.tier, ["global", "customer"]),
          eq(workerAgents.domain, domain)
        ),
      })
      const children: CapabilityNode[] = agents.length > 0
        ? agents.map((a) => ({ key: a.id, label: a.name, leaf: true, codeReference: a.codeReference }))
        : modsInDomain.map((m) => ({ key: m.moduleKey, label: m.displayName, leaf: true }))
      domainNodes.push({ key: domain, label: domain, leaf: false, children })
    }

    if (domainNodes.length > 0) {
      tree.push({ key: branch.branchKey, label: branch.displayName, leaf: false, children: domainNodes })
    }
  }
  return tree
}

async function buildProductNodes(db: TenantDb, orgId: string): Promise<CapabilityNode[]> {
  const activeProducts = await db.query.products.findMany({
    where: and(eq(products.orgId, orgId), eq(products.isActive, true)),
  })
  if (activeProducts.length === 0) return []

  const productIds = activeProducts.map((p) => p.id)
  const activeProjects = await db.query.projects.findMany({
    where: and(inArray(projects.productId, productIds), eq(projects.isActive, true)),
  })

  const productChildren: CapabilityNode[] = []
  for (const product of activeProducts) {
    const projectsForProduct = activeProjects.filter((pr) => pr.productId === product.id)
    if (projectsForProduct.length === 0) continue
    productChildren.push({
      key: product.id, label: product.name, leaf: false,
      children: projectsForProduct.map((pr) => ({
        key: pr.id, label: pr.name, leaf: false, children: genericProjectActions(pr.id),
      })),
    })
  }
  if (productChildren.length === 0) return []

  return [{ key: "product", label: "Product", leaf: false, children: productChildren }]
}

async function buildEntityNodes(db: TenantDb, orgId: string): Promise<CapabilityNode[]> {
  const [customers, suppliers] = await Promise.all([
    db.query.erpCustomers.findMany({ where: and(eq(erpCustomers.orgId, orgId), eq(erpCustomers.isActive, true)) }),
    db.query.erpSuppliers.findMany({ where: and(eq(erpSuppliers.orgId, orgId), eq(erpSuppliers.isActive, true)) }),
  ])

  const nodes: CapabilityNode[] = []
  if (customers.length > 0) {
    nodes.push({
      key: "customer", label: "Customer", leaf: false, multi: true,
      children: customers.map((c) => ({ key: c.id, label: c.customerName, leaf: false, children: GENERIC_ENTITY_ACTIONS })),
    })
  }
  if (suppliers.length > 0) {
    nodes.push({
      key: "vendor", label: "Vendor", leaf: false, multi: true,
      children: suppliers.map((s) => ({ key: s.id, label: s.supplierName, leaf: false, children: GENERIC_ENTITY_ACTIONS })),
    })
  }
  return nodes
}

// "Compliance Item -> [item] -> Mark as [status]" -- the real
// update_compliance_status worker agent, dispatched with zero typing (every
// value comes from tree position, not a form). Capped to the 20 nearest-due,
// not-yet-completed items -- an org's full register can run into the
// thousands, and this is a quick-action list, not a browse view (the real
// /compliance page already exists for that).
async function buildComplianceItemNodes(db: TenantDb, orgId: string): Promise<CapabilityNode[]> {
  const updateAgent = await db.query.workerAgents.findFirst({
    where: and(eq(workerAgents.codeReference, "update_compliance_status"), eq(workerAgents.tier, "global")),
  })
  if (!updateAgent) return [] // agent not registered for this org's platform tier -- nothing to dispatch

  const items = await db.query.complianceItems.findMany({
    where: and(eq(complianceItems.orgId, orgId), ne(complianceItems.status, "completed")),
    columns: { id: true, title: true, status: true },
    orderBy: asc(complianceItems.dueDate),
    limit: 20,
  })
  if (items.length === 0) return []

  return [{
    key: "compliance_item", label: "Compliance Item", leaf: false,
    children: items.map((item) => ({
      key: item.id, label: item.title, leaf: false,
      children: COMPLIANCE_STATUS_VALUES.filter((s) => s !== item.status).map((status) => ({
        key: `${item.id}::${status}`, label: `Mark as ${status.replace("_", " ")}`, leaf: true,
        codeReference: "update_compliance_status", agentId: updateAgent.id,
        fixedInputs: { complianceItemId: item.id, newStatus: status },
      })),
    })),
  }]
}

// GST Reconciliation -- unconditional like buildComplianceItemNodes (the
// module isn't behind a product-branch enablement flag, matching
// AppSidebar.tsx's "Finance section shown unconditionally" posture, so it's
// visible from the chain selector for every org/product experience,
// including Office and The Firm, not gated to a specific branch). Each
// sub-branch only appears once there's real data to act on -- an org with
// no staged batches never sees an empty "Import Batches" node.
async function buildGstReconciliationNodes(db: TenantDb, orgId: string): Promise<CapabilityNode[]> {
  const [confirmAgent, reconcileAgent, generateReturnAgent, aiReviewAgent] = await Promise.all([
    db.query.workerAgents.findFirst({ where: and(eq(workerAgents.codeReference, "confirm_gst_batch"), eq(workerAgents.tier, "global")) }),
    db.query.workerAgents.findFirst({ where: and(eq(workerAgents.codeReference, "run_gst_reconciliation"), eq(workerAgents.tier, "global")) }),
    db.query.workerAgents.findFirst({ where: and(eq(workerAgents.codeReference, "generate_gst_return"), eq(workerAgents.tier, "global")) }),
    db.query.workerAgents.findFirst({ where: and(eq(workerAgents.codeReference, "generate_gst_ai_review"), eq(workerAgents.tier, "global")) }),
  ])
  if (!confirmAgent && !reconcileAgent && !generateReturnAgent && !aiReviewAgent) return []

  const children: CapabilityNode[] = []

  // Import Batches (pending confirm) -> [batch] -> Confirm
  if (confirmAgent) {
    const stagedBatches = await db.query.gstImportBatches.findMany({
      where: and(eq(gstImportBatches.orgId, orgId), eq(gstImportBatches.status, "staged")),
      orderBy: desc(gstImportBatches.createdAt), limit: 20,
    })
    if (stagedBatches.length > 0) {
      children.push({
        key: "gst_import_batches", label: "Import Batches (pending confirm)", leaf: false,
        children: stagedBatches.map((b) => ({
          key: b.id, label: `${b.fileName} (${b.period})`, leaf: true,
          codeReference: "confirm_gst_batch", agentId: confirmAgent.id, fixedInputs: { batchId: b.id },
        })),
      })
    }
  }

  // Reconcile GSTR-2B -> [purchase batch] -> [2B batch] -> Run
  if (reconcileAgent) {
    const [purchaseBatches, gstr2bBatches] = await Promise.all([
      db.query.gstImportBatches.findMany({ where: and(eq(gstImportBatches.orgId, orgId), eq(gstImportBatches.direction, "purchase"), eq(gstImportBatches.status, "confirmed")), orderBy: desc(gstImportBatches.createdAt), limit: 10 }),
      db.query.gstImportBatches.findMany({ where: and(eq(gstImportBatches.orgId, orgId), eq(gstImportBatches.direction, "gstr2b"), eq(gstImportBatches.status, "confirmed")), orderBy: desc(gstImportBatches.createdAt), limit: 10 }),
    ])
    if (purchaseBatches.length > 0 && gstr2bBatches.length > 0) {
      children.push({
        key: "gst_reconcile", label: "Reconcile GSTR-2B", leaf: false,
        children: purchaseBatches.map((pb) => ({
          key: pb.id, label: `Purchase: ${pb.fileName} (${pb.period})`, leaf: false,
          children: gstr2bBatches.map((gb) => ({
            key: gb.id, label: `vs 2B: ${gb.fileName} (${gb.period})`, leaf: true,
            codeReference: "run_gst_reconciliation", agentId: reconcileAgent.id,
            fixedInputs: { purchaseBatchId: pb.id, gstr2bBatchId: gb.id, period: pb.period },
          })),
        })),
      })
    }
  }

  // Generate Return -> [period with confirmed sales invoices] -> GSTR-1 | GSTR-3B
  if (generateReturnAgent) {
    const periodRows = await db.selectDistinct({ period: gstCanonicalInvoices.period }).from(gstCanonicalInvoices)
      .where(and(eq(gstCanonicalInvoices.orgId, orgId), eq(gstCanonicalInvoices.direction, "sales")))
    if (periodRows.length > 0) {
      children.push({
        key: "gst_generate_return", label: "Generate Return", leaf: false,
        children: periodRows.map((p) => ({
          key: p.period, label: p.period, leaf: false,
          children: [
            { key: `${p.period}::gstr1`, label: "GSTR-1", leaf: true, codeReference: "generate_gst_return", agentId: generateReturnAgent.id, fixedInputs: { period: p.period, returnType: "gstr1" } },
            { key: `${p.period}::gstr3b`, label: "GSTR-3B", leaf: true, codeReference: "generate_gst_return", agentId: generateReturnAgent.id, fixedInputs: { period: p.period, returnType: "gstr3b" } },
          ],
        })),
      })
    }
  }

  // AI Review -> [generated return] -> Generate AI Review
  if (aiReviewAgent) {
    const returns = await db.query.gstReturnPeriods.findMany({
      where: and(eq(gstReturnPeriods.orgId, orgId), inArray(gstReturnPeriods.status, ["generated", "filed"])),
      orderBy: desc(gstReturnPeriods.createdAt), limit: 20,
    })
    if (returns.length > 0) {
      children.push({
        key: "gst_ai_review", label: "AI Review", leaf: false,
        children: returns.map((r) => ({
          key: r.id, label: `${r.returnType.toUpperCase()} — ${r.period}`, leaf: true,
          codeReference: "generate_gst_ai_review", agentId: aiReviewAgent.id, fixedInputs: { returnPeriodId: r.id },
        })),
      })
    }
  }

  if (children.length === 0) return []
  return [{ key: "gst_reconciliation", label: "GST Reconciliation", leaf: false, children }]
}
