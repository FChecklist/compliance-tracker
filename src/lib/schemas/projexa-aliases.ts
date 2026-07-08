// Wave 124: zod schemas for the /api/v1/projexa/* aliasing namespace's
// construction-friendly request shapes (vendors/project-budgets, which
// rename fields from the generic erp_suppliers/erp_budgets shape).
import { z } from "zod"

export const createVendorSchema = z.object({
  vendorName: z.string().min(1),
  vendorType: z.string().optional(),
  gst: z.string().optional(),
  pan: z.string().optional(),
  trade: z.string().optional(),
  projectId: z.string().optional(),
  defaultPaymentTermsDays: z.number().int().optional(),
  creditLimit: z.number().optional(),
})

export const createProjectBudgetSchema = z.object({
  fiscalYearId: z.string(),
  companyId: z.string().optional(),
  costCenterId: z.string().optional(),
  name: z.string().min(1),
  actionIfExceeded: z.enum(["ignore", "warn", "stop"]).optional(),
  lineItems: z.array(z.object({ accountId: z.string(), annualAmount: z.number() })),
})

// Wave 129: the assistant's codeReference allowlist is enforced in the
// route (src/app/api/v1/projexa/assistant/route.ts), not duplicated here --
// this schema documents the request shape only.
export const assistantQuerySchema = z.object({
  codeReference: z.enum([
    "get_construction_project_dashboard",
    "list_delayed_activities",
    "get_construction_budget_status",
    "list_over_budget_projects",
    "get_construction_kpi_status",
    "generate_construction_progress_summary",
    "detect_construction_budget_schedule_risk",
  ]),
  inputs: z.object({ projectId: z.string().optional() }).optional(),
})

export const diffDrawingsSchema = z.object({
  documentIdA: z.string(),
  documentIdB: z.string(),
})
