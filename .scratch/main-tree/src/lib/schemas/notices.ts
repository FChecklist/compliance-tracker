// Wave 11: zod schemas for the notices domain -- see compliance.ts's header
// comment for the documentation-contract-vs-validation-layer scope note.
import { z } from "zod"

export const noticeStatusSchema = z.enum(["received", "in_progress", "replied", "closed", "appealed"])

export const createNoticeSchema = z.object({
  noticeNumber: z.string().optional(),
  authority: z.string().optional(),
  dateReceived: z.string(),
  demandAmount: z.union([z.string(), z.number()]).optional(),
  replyDeadline: z.string().optional(),
  status: noticeStatusSchema.optional(),
  description: z.string().optional(),
  departmentId: z.string(),
  assignedToId: z.string().optional(),
  complianceItemId: z.string().optional(),
  clientId: z.string().optional(),
})

export const updateNoticeSchema = createNoticeSchema.partial()

export const listNoticesQuerySchema = z.object({
  search: z.string().optional(),
  status: noticeStatusSchema.optional(),
  departmentId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
