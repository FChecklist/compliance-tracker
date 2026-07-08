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
