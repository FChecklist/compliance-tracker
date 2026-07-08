// Wave 119: zod schemas for the existing ERP/PMS/Documents modules newly
// exposed on /api/v1 for external consumers (PROJEXA first). Mirrors
// src/lib/schemas/compliance.ts's shape.
import { z } from "zod"

export const createBudgetSchema = z.object({
  fiscalYearId: z.string(),
  companyId: z.string().optional(),
  costCenterId: z.string().optional(),
  name: z.string().min(1),
  actionIfExceeded: z.enum(["ignore", "warn", "stop"]).optional(),
  lineItems: z.array(z.object({ accountId: z.string(), annualAmount: z.number() })),
})

export const recordStockReceiptSchema = z.object({
  itemId: z.string(),
  warehouseId: z.string(),
  quantity: z.number().positive(),
  rate: z.number().min(0),
  postingDate: z.string(),
  voucherType: z.string(),
  voucherId: z.string(),
  uom: z.string().optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().optional(),
})

export const recordStockIssueSchema = z.object({
  itemId: z.string(),
  warehouseId: z.string(),
  quantity: z.number().positive(),
  postingDate: z.string(),
  voucherType: z.string(),
  voucherId: z.string(),
  uom: z.string().optional(),
})

export const createPurchaseRequisitionSchema = z.object({
  departmentId: z.string().optional(),
  purpose: z.string().optional(),
  postingDate: z.string(),
  items: z.array(z.object({
    itemId: z.string().optional(),
    description: z.string().optional(),
    quantity: z.number().optional(),
    estimatedRate: z.number().optional(),
  })),
})

export const createMeetingSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  scheduledAt: z.string(),
  durationMinutes: z.number().int().optional(),
  agendaItems: z.array(z.string()).optional(),
  participantUserIds: z.array(z.string()).optional(),
})

export const logTimeSchema = z.object({
  issueId: z.string(),
  hours: z.string(),
  spentOn: z.string(),
  activityType: z.string().optional(),
  comments: z.string().optional(),
})
