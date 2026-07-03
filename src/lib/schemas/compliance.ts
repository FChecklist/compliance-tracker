// Wave 11: zod schemas for the compliance domain. These are the documented,
// OpenAPI-facing contract (src/lib/openapi/generate.ts converts them via
// zod's built-in z.toJSONSchema()) for /api/v1/compliance/*. The service
// layer (src/lib/services/compliance-service.ts) still does its own
// hand-written validation internally, preserved verbatim from the original
// routes to keep this a behavior-identical refactor -- these schemas are
// the external contract description, not (yet) wired in as a second
// validation pass. Wiring the service layer to validate via these directly
// is a natural follow-up, not required for this wave's OpenAPI goal.
import { z } from "zod"

export const complianceTypeSchema = z.enum(["GST", "TDS", "MCA", "PF", "ESIC", "INCOME_TAX", "ROC", "LABOUR", "ENVIRONMENTAL", "OTHER"])
export const complianceStatusSchema = z.enum(["pending", "in_progress", "completed", "overdue", "not_applicable", "draft"])
export const prioritySchema = z.enum(["low", "medium", "high", "critical"])

export const createComplianceItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  complianceType: complianceTypeSchema,
  priority: prioritySchema.optional(),
  dueDate: z.string(),
  departmentId: z.string(),
  assignedToId: z.string().optional(),
  period: z.string().optional(),
  financialYear: z.string().optional(),
  acknowledgementNumber: z.string().optional(),
  registrationNumber: z.string().optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  filedDate: z.string().optional(),
  paidDate: z.string().optional(),
  recurrenceType: z.enum(["none", "monthly", "quarterly", "half_yearly", "annually"]).optional(),
  clientId: z.string().optional(),
})

export const updateComplianceItemSchema = createComplianceItemSchema.partial().extend({
  status: complianceStatusSchema.optional(),
})

export const listComplianceQuerySchema = z.object({
  search: z.string().optional(),
  status: complianceStatusSchema.optional(),
  departmentId: z.string().optional(),
  complianceType: complianceTypeSchema.optional(),
  sort: z.enum(["dueDate", "createdAt", "title"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
