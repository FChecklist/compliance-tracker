// Wave 11: zod schemas for the task domain -- see compliance.ts's header
// comment for the documentation-contract-vs-validation-layer scope note.
import { z } from "zod"

export const taskStatusSchema = z.enum(["pending", "in_progress", "completed", "failed", "cancelled"])

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assistantId: z.string().optional(),
})

export const updateTaskSchema = z.object({
  status: taskStatusSchema.optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
})

export const listTasksQuerySchema = z.object({
  assistantId: z.string().optional(),
})
