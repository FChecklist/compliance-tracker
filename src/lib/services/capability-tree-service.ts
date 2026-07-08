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
  workerAgents, erpCustomers, erpSuppliers, products, projects,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"

export type CapabilityNode = {
  key: string
  label: string
  leaf: boolean
  multi?: boolean
  codeReference?: string | null
  projectId?: string | null
  children?: CapabilityNode[]
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
    return [...branchNodes, ...productNodes, ...entityNodes]
  })
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
