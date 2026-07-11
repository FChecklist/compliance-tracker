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
  gstImportBatches, gstCanonicalInvoices, gstReturnPeriods, departments,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, ne, asc, desc } from "drizzle-orm"
import { VALID_TYPES as VALID_COMPLIANCE_TYPES } from "./compliance-service"

// The 6 real compliance_status enum values -- shown as clickable targets,
// not a free-text field, so "update status" dispatch needs zero typing.
const COMPLIANCE_STATUS_VALUES = ["pending", "in_progress", "completed", "overdue", "not_applicable", "draft"] as const

// Gap closure, 2026-07-10 (CAPABILITY_COVERAGE.md): "select" is a fixed
// set of choices rendered as a dropdown, not a free-text field the user has
// to type correctly -- used for engines that bundle several related
// functions behind one engine_key (e.g. Basic Arithmetic Engine covers
// add/subtract/multiply/divide) so picking the operation stays a click, not
// typing. "number_list" is a comma-separated list of numbers, parsed
// server-side into number[] -- covers functions whose real argument is an
// array (statistics, moving average, regression) without needing a grid/
// matrix editor UI.
export type CapabilityInputField = {
  key: string
  label: string
  type: "number" | "text" | "select" | "number_list"
  optional?: boolean
  options?: { value: string; label: string }[] // required when type === "select"
}

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
  // Gap closure, 2026-07-10 (CAPABILITY_COVERAGE.md): true when this leaf
  // carries a real codeReference or engineKey -- the selection is
  // guaranteed to run as real software with zero AI involvement. False (or
  // unset, for a non-leaf) means this selection currently falls back to the
  // free-text/AI-planning path. Computed once in buildCapabilityTree() via
  // markDeterministic(), not hand-set per leaf, so it can never drift out of
  // sync with what's actually dispatchable.
  deterministic?: boolean
  children?: CapabilityNode[]
}

function markDeterministic(nodes: CapabilityNode[]): CapabilityNode[] {
  for (const node of nodes) {
    if (node.leaf) {
      node.deterministic = Boolean(node.codeReference || node.engineKey)
    } else if (node.children) {
      markDeterministic(node.children)
    }
  }
  return nodes
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
  // Gap closure, 2026-07-10: completes GST Engine 16/16 -- the one holdout
  // (`lineItems: unknown[]`) is resolved by NOT asking the user to type
  // line items at all. This leaf only ever appears under a specific real
  // return period (buildGstReconciliationNodes' "Validate Return" branch,
  // fixedInputs carries returnPeriodId) -- dispatchEngine() fetches the
  // real gstin/period/taxable value/tax paid/line items from that period's
  // own confirmed invoices. Zero typed fields, matching the "AI Review"
  // leaf's zero-inputFields shape.
  gst_return_validation_engine: [],
}

// Mathematical Computation Engine -- second full category wired end to end
// (proves the pattern generalizes past GST), 10 of 13 registered engines.
// The other 3 (Matrix Computation, Linear Algebra, Optimization) take a
// real matrix or an LP model as input -- there's no grid/JSON-editor UI in
// the composer yet, so those stay honestly unwired rather than forced into
// a bad-fit text field; see CAPABILITY_COVERAGE.md.
const ARITHMETIC_OPS = [
  { value: "add", label: "Add" }, { value: "subtract", label: "Subtract" },
  { value: "multiply", label: "Multiply" }, { value: "divide", label: "Divide" },
]
const FINANCIAL_MATH_OPS = [
  { value: "present_value", label: "Present value" }, { value: "future_value", label: "Future value" },
  { value: "compound_interest", label: "Compound interest" },
]
const PERCENTAGE_OPS = [
  { value: "percentage_of", label: "X% of a value" }, { value: "percentage_change", label: "% change between two values" },
]
const PROBABILITY_OPS = [
  { value: "combinations", label: "Combinations (nCr)" }, { value: "permutations", label: "Permutations (nPr)" },
  { value: "normal_cdf", label: "Normal CDF" },
]

const MATH_WIRED_ENGINE_INPUT_FIELDS: Record<string, CapabilityInputField[]> = {
  basic_arithmetic_engine: [
    { key: "operation", label: "Operation", type: "select", options: ARITHMETIC_OPS },
    { key: "a", label: "First number", type: "number" },
    { key: "b", label: "Second number", type: "number" },
  ],
  scientific_calculator_engine: [{ key: "expr", label: "Expression (e.g. 2*(3+4)/5)", type: "text" }],
  financial_mathematics_engine: [
    { key: "operation", label: "Calculation", type: "select", options: FINANCIAL_MATH_OPS },
    { key: "amount", label: "Amount (present or principal, ₹)", type: "number" },
    { key: "rate", label: "Rate (decimal, e.g. 0.08 for 8%)", type: "number" },
    { key: "periodsOrYears", label: "Periods / years", type: "number" },
    { key: "timesCompoundedPerYear", label: "Times compounded per year (compound interest only)", type: "number", optional: true },
  ],
  percentage_engine: [
    { key: "operation", label: "Calculation", type: "select", options: PERCENTAGE_OPS },
    { key: "value1", label: "Value (or old value for % change)", type: "number" },
    { key: "value2", label: "Percent (or new value for % change)", type: "number" },
  ],
  ratio_engine: [
    { key: "a", label: "First number", type: "number" },
    { key: "b", label: "Second number", type: "number" },
  ],
  fraction_engine: [
    { key: "n1", label: "First numerator", type: "number" }, { key: "d1", label: "First denominator", type: "number" },
    { key: "n2", label: "Second numerator", type: "number" }, { key: "d2", label: "Second denominator", type: "number" },
  ],
  statistical_engine: [{ key: "values", label: "Values (comma-separated, e.g. 4, 8, 15, 16, 23)", type: "number_list" }],
  probability_engine: [
    { key: "operation", label: "Calculation", type: "select", options: PROBABILITY_OPS },
    { key: "n", label: "n (or x, for Normal CDF)", type: "number" },
    { key: "k", label: "k (or mean, for Normal CDF, optional)", type: "number", optional: true },
    { key: "stdDev", label: "Std deviation (Normal CDF only, optional)", type: "number", optional: true },
  ],
  regression_engine: [
    { key: "xValues", label: "X values (comma-separated)", type: "number_list" },
    { key: "yValues", label: "Y values (comma-separated, same count as X)", type: "number_list" },
  ],
  time_series_engine: [
    { key: "values", label: "Values (comma-separated)", type: "number_list" },
    { key: "windowSize", label: "Window size", type: "number" },
  ],
}
Object.assign(WIRED_ENGINE_INPUT_FIELDS, MATH_WIRED_ENGINE_INPUT_FIELDS)

// Costing Engine -- third full category wired end to end, 8 of 8 registered
// engines (job/contract/service costing, allocation, variance). The two
// array-of-objects inputs (activity_based_costing_engine's costPools/
// objectDriverUsage and cost_allocation_engine's allocationBasis) have no
// UI field type that supports a grid/JSON-editor, so those two stay
// dispatch-only -- callable programmatically, not from the chain selector
// form -- the same skip pattern the Mathematical Computation Engine's 3
// matrix/model-input engines already follow above.
const COSTING_WIRED_ENGINE_INPUT_FIELDS: Record<string, CapabilityInputField[]> = {
  job_costing_engine: [
    { key: "directMaterial", label: "Direct material cost (₹)", type: "number" },
    { key: "directLabor", label: "Direct labor cost (₹)", type: "number" },
    { key: "overheadAllocated", label: "Overhead allocated (₹)", type: "number" },
  ],
  standard_costing_engine: [
    { key: "standardPrice", label: "Standard price (₹)", type: "number" },
    { key: "actualPrice", label: "Actual price (₹)", type: "number" },
    { key: "standardQuantity", label: "Standard quantity", type: "number" },
    { key: "actualQuantity", label: "Actual quantity", type: "number" },
  ],
  marginal_costing_engine: [
    { key: "sellingPricePerUnit", label: "Selling price per unit (₹)", type: "number" },
    { key: "variableCostPerUnit", label: "Variable cost per unit (₹)", type: "number" },
    { key: "fixedCosts", label: "Fixed costs (₹)", type: "number" },
  ],
  batch_costing_engine_2: [
    { key: "totalBatchCost", label: "Total batch cost (₹)", type: "number" },
    { key: "unitsInBatch", label: "Units in batch", type: "number" },
  ],
  service_costing_engine: [
    { key: "directCost", label: "Direct cost (₹)", type: "number" },
    { key: "indirectCostAllocated", label: "Indirect cost allocated (₹)", type: "number" },
    { key: "serviceUnits", label: "Service units", type: "number" },
  ],
  variance_analysis_engine: [
    { key: "actual", label: "Actual amount (₹)", type: "number" },
    { key: "budget", label: "Budget amount (₹)", type: "number" },
    { key: "higherIsFavorable", label: "Higher is favorable? (yes/no, optional, default yes)", type: "text", optional: true },
  ],
}
Object.assign(WIRED_ENGINE_INPUT_FIELDS, COSTING_WIRED_ENGINE_INPUT_FIELDS)

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
    const constructionNodes = await buildConstructionNodes(db, ctx.orgId)
    return markDeterministic([...branchNodes, ...productNodes, ...entityNodes, ...complianceItemNodes, ...calculatorNodes, ...gstReconciliationNodes, ...constructionNodes])
  })
}

// Construction Intelligence (PROJEXA), Wave 128. Mirrors
// buildGstReconciliationNodes()'s shape: check the worker_agents actually
// exist for this platform tier first (empty tree if this wave hasn't been
// applied), then build real per-project leaf nodes. Unlike the GST tree,
// these don't need dynamic batch-pairing -- each is a single project-scoped
// (or org-wide) read query, so this reuses genericProjectActions()'s
// projectId-carrying leaf shape rather than a bespoke structure. Project
// scoping here is generic `projects` (there's no dedicated "construction
// project" flag -- a project becomes construction-flavored simply by having
// constructionBoqs/constructionCategories rows, matching how buildProductNodes
// above also lists all active projects without a domain filter).
// Exported (unlike the other builders here) so /api/v1/projexa/capability-tree
// can call this subtree directly instead of the full buildCapabilityTree() --
// PROJEXA must never see GST/compliance/other product nodes, only its own.
export async function buildConstructionNodes(db: TenantDb, orgId: string): Promise<CapabilityNode[]> {
  const codeRefs = [
    "get_construction_project_dashboard", "get_construction_budget_status", "get_construction_kpi_status",
    "generate_construction_progress_summary", "detect_construction_budget_schedule_risk",
    "list_delayed_activities", "list_over_budget_projects",
  ]
  const agents = await db.query.workerAgents.findMany({
    where: and(inArray(workerAgents.codeReference, codeRefs), eq(workerAgents.tier, "global")),
  })
  if (agents.length === 0) return []
  const agentByRef = new Map(agents.map((a) => [a.codeReference, a]))

  const children: CapabilityNode[] = []

  const orgWideRefs: { ref: string; label: string }[] = [
    { ref: "list_delayed_activities", label: "Delayed Activities (all projects)" },
    { ref: "list_over_budget_projects", label: "Over-Budget Projects" },
  ]
  for (const { ref, label } of orgWideRefs) {
    const agent = agentByRef.get(ref)
    if (agent) children.push({ key: ref, label, leaf: true, codeReference: ref, agentId: agent.id })
  }

  const projectScopedRefs: { ref: string; label: string }[] = [
    { ref: "get_construction_project_dashboard", label: "Project Dashboard" },
    { ref: "get_construction_budget_status", label: "Budget Status" },
    { ref: "get_construction_kpi_status", label: "KPI Status" },
    { ref: "generate_construction_progress_summary", label: "AI Progress Summary" },
    { ref: "detect_construction_budget_schedule_risk", label: "AI Budget/Schedule Risk" },
  ]
  const availableProjectRefs = projectScopedRefs.filter(({ ref }) => agentByRef.has(ref))
  if (availableProjectRefs.length > 0) {
    const activeProjects = await db.query.projects.findMany({ where: and(eq(projects.orgId, orgId), eq(projects.isActive, true)), limit: 50 })
    if (activeProjects.length > 0) {
      children.push({
        key: "construction_projects", label: "By Project", leaf: false,
        children: activeProjects.map((p) => ({
          key: p.id, label: p.name, leaf: false,
          children: availableProjectRefs.map(({ ref, label }) => ({
            key: `${p.id}_${ref}`, label, leaf: true, codeReference: ref, agentId: agentByRef.get(ref)!.id,
            fixedInputs: { projectId: p.id },
          })),
        })),
      })
    }
  }

  if (children.length === 0) return []
  return [{ key: "construction_intelligence", label: "Construction Intelligence", leaf: false, children }]
}

// Calculators -- sourced from the real computation_engines registry (VCEL),
// scoped to just the engine_keys dispatchTool() actually knows how to run
// (WIRED_ENGINE_INPUT_FIELDS above). Not org-scoped like the other branches
// (a calculator isn't a per-org capability), so this doesn't need a
// productBranch/enablement check the way buildBranchNodes does.
async function buildCalculatorNodes(db: TenantDb): Promise<CapabilityNode[]> {
  // gst_return_validation_engine is deliberately excluded here -- it needs
  // a real return-period picker (see buildGstReconciliationNodes' "Validate
  // Return" branch), not a typed-fields form; its zero-length inputFields
  // entry in WIRED_ENGINE_INPUT_FIELDS exists only for that branch to reuse.
  const wiredKeys = Object.keys(WIRED_ENGINE_INPUT_FIELDS).filter((k) => k !== "gst_return_validation_engine")
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
// Gap closure, 2026-07-10 (CAPABILITY_COVERAGE.md): create_compliance_item
// was a registered worker agent with zero implementation -- clicking it
// threw "No dispatcher implemented". Fixed via the same structured-inputs
// mechanism VCEL calculator leaves already use (inputFields), so the
// human-typed values still arrive as a validated form submission, never as
// LLM-guessed free text -- matches this file's own "never AI-guessed"
// discipline for every other write dispatcher.
const CREATE_COMPLIANCE_ITEM_FIELDS: CapabilityInputField[] = [
  { key: "title", label: "Title", type: "text" },
  { key: "complianceType", label: "Type", type: "select", options: VALID_COMPLIANCE_TYPES.map((t) => ({ value: t, label: t })) },
  { key: "dueDate", label: "Due date (YYYY-MM-DD)", type: "text" },
  { key: "amount", label: "Amount, ₹ (optional -- enables penalty estimation later)", type: "number", optional: true },
]

async function buildComplianceItemNodes(db: TenantDb, orgId: string): Promise<CapabilityNode[]> {
  const [updateAgent, createAgent] = await Promise.all([
    db.query.workerAgents.findFirst({ where: and(eq(workerAgents.codeReference, "update_compliance_status"), eq(workerAgents.tier, "global")) }),
    db.query.workerAgents.findFirst({ where: and(eq(workerAgents.codeReference, "create_compliance_item"), eq(workerAgents.tier, "global")) }),
  ])

  const items = await db.query.complianceItems.findMany({
    where: and(eq(complianceItems.orgId, orgId), ne(complianceItems.status, "completed")),
    columns: { id: true, title: true, status: true, amount: true },
    orderBy: asc(complianceItems.dueDate),
    limit: 20,
  })

  const children: CapabilityNode[] = []

  if (createAgent) {
    // First-class department picker so departmentId is a real click, not
    // typed text a human could get wrong -- one leaf per active department.
    const depts = await db.query.departments.findMany({ where: eq(departments.orgId, orgId), columns: { id: true, name: true }, limit: 30 })
    if (depts.length > 0) {
      children.push({
        key: "compliance_item_create", label: "Create New", leaf: false,
        children: depts.map((d) => ({
          key: `create::${d.id}`, label: d.name, leaf: true,
          codeReference: "create_compliance_item", agentId: createAgent.id,
          fixedInputs: { departmentId: d.id },
          inputFields: CREATE_COMPLIANCE_ITEM_FIELDS,
        })),
      })
    }
  }

  for (const item of items) {
    const itemChildren: CapabilityNode[] = updateAgent
      ? COMPLIANCE_STATUS_VALUES.filter((s) => s !== item.status).map((status) => ({
          key: `${item.id}::${status}`, label: `Mark as ${status.replace("_", " ")}`, leaf: true,
          codeReference: "update_compliance_status", agentId: updateAgent.id,
          fixedInputs: { complianceItemId: item.id, newStatus: status },
        }))
      : []
    if (item.amount != null) {
      const penaltyAgent = await db.query.workerAgents.findFirst({ where: and(eq(workerAgents.codeReference, "get_penalty_estimate"), eq(workerAgents.tier, "global")) })
      if (penaltyAgent) {
        itemChildren.push({
          key: `${item.id}::penalty`, label: "Estimate Penalty", leaf: true,
          codeReference: "get_penalty_estimate", agentId: penaltyAgent.id,
          fixedInputs: { complianceItemId: item.id },
          inputFields: [{ key: "annualRatePercent", label: "Annual interest rate (%)", type: "number" }],
        })
      }
    }
    if (itemChildren.length > 0) {
      children.push({ key: item.id, label: item.title, leaf: false, children: itemChildren })
    }
  }

  if (children.length === 0) return []
  return [{ key: "compliance_item", label: "Compliance Item", leaf: false, children }]
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
  const validationEngine = await db.query.computationEngines.findFirst({
    where: and(eq(computationEngines.engineKey, "gst_return_validation_engine"), eq(computationEngines.status, "implemented")),
  })
  if (!confirmAgent && !reconcileAgent && !generateReturnAgent && !aiReviewAgent && !validationEngine) return []

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

  // Validate Return -> [generated return] -> Validate (VCEL
  // gst_return_validation_engine, the GST category's last unwired engine).
  // Zero typed fields: dispatchEngine() fetches this return period's real
  // gstin/period/taxable value/tax paid/line items from its own confirmed
  // sales invoices, never asks a human to type a line-items list.
  if (validationEngine) {
    const returnsToValidate = await db.query.gstReturnPeriods.findMany({
      where: and(eq(gstReturnPeriods.orgId, orgId), inArray(gstReturnPeriods.status, ["generated", "filed"])),
      orderBy: desc(gstReturnPeriods.createdAt), limit: 20,
    })
    if (returnsToValidate.length > 0) {
      children.push({
        key: "gst_validate_return", label: "Validate Return", leaf: false,
        children: returnsToValidate.map((r) => ({
          key: r.id, label: `${r.returnType.toUpperCase()} — ${r.period}`, leaf: true,
          engineKey: "gst_return_validation_engine", fixedInputs: { returnPeriodId: r.id }, inputFields: [],
        })),
      })
    }
  }

  if (children.length === 0) return []
  return [{ key: "gst_reconciliation", label: "GST Reconciliation", leaf: false, children }]
}
