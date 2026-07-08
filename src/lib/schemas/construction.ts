// Wave 119: zod schemas for the construction domain (PROJEXA's primary
// consumption surface). Mirrors src/lib/schemas/compliance.ts's shape --
// documented, OpenAPI-facing contract for /api/v1/construction/*.
import { z } from "zod"

export const createBoqSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  lineItems: z.array(z.object({
    activityId: z.string().optional(),
    itemCode: z.string().optional(),
    description: z.string().min(1),
    unit: z.string().min(1),
    quantity: z.number(),
    rate: z.number(),
  })).default([]),
})

export const createBoqRevisionSchema = z.object({
  title: z.string().optional(),
  lineItems: z.array(z.object({
    activityId: z.string().optional(),
    itemCode: z.string().optional(),
    description: z.string().min(1),
    unit: z.string().min(1),
    quantity: z.number(),
    rate: z.number(),
  })).default([]),
})

export const createProgressEntrySchema = z.object({
  projectId: z.string(),
  activityId: z.string(),
  entryDate: z.string(),
  quantityDone: z.number(),
  percentComplete: z.number().min(0).max(100),
  remarks: z.string().optional(),
})

export const createSiteDiarySchema = z.object({
  projectId: z.string(),
  diaryDate: z.string(),
  weather: z.string().optional(),
  workDone: z.string().optional(),
  visitors: z.string().optional(),
  issues: z.string().optional(),
  instructions: z.string().optional(),
  materialReceived: z.string().optional(),
  labourCount: z.number().int().optional(),
  remarks: z.string().optional(),
})

export const createRosterEntrySchema = z.object({
  projectId: z.string(),
  name: z.string().min(1),
  trade: z.string().optional(),
  skillLevel: z.string().optional(),
  vendorId: z.string().optional(),
  dailyRate: z.number(),
})

export const recordAttendanceSchema = z.object({
  projectId: z.string(),
  rosterId: z.string(),
  attendanceDate: z.string(),
  status: z.enum(["present", "absent", "half_day"]).optional(),
  hoursWorked: z.number().optional(),
})

export const createKpiDefinitionSchema = z.object({
  projectId: z.string().optional(),
  metricName: z.string().min(1),
  targetValue: z.number().optional(),
  unit: z.string().optional(),
  period: z.enum(["monthly", "quarterly", "milestone"]).optional(),
  ownerId: z.string().optional(),
})

export const submitKpiEntrySchema = z.object({
  kpiDefinitionId: z.string(),
  period: z.string(),
  actualValue: z.number(),
})
