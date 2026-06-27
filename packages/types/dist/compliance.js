import { z } from "zod";
import { ComplianceType, ComplianceStatus, Priority } from "./enums";
export const ComplianceSchema = z.object({
    id: z.string().uuid(),
    org_id: z.string().uuid(),
    department_id: z.string().uuid().nullable(),
    title: z.string().min(1).max(500),
    description: z.string(),
    compliance_type: z.nativeEnum(ComplianceType),
    status: z.nativeEnum(ComplianceStatus),
    priority: z.nativeEnum(Priority),
    assignee_id: z.string().uuid().nullable(),
    due_date: z.string().datetime().nullable(),
    unique_url_slug: z.string().min(1).max(255),
    metadata: z.record(z.unknown()).default({}),
});
export const CreateComplianceSchema = ComplianceSchema.omit({
    id: true, status: true, unique_url_slug: true,
});
export const UpdateComplianceSchema = ComplianceSchema.partial().omit({
    id: true,
});
export const ChangeStatusSchema = z.object({
    new_status: z.nativeEnum(ComplianceStatus),
    reason: z.string().min(1).max(1000).optional(),
});
export const ReassignSchema = z.object({
    assignee_id: z.string().uuid(),
    reason: z.string().min(1).max(500).optional(),
});
export const BulkStatusChangeSchema = z.object({
    compliance_ids: z.array(z.string().uuid()).min(1).max(100),
    new_status: z.nativeEnum(ComplianceStatus),
    reason: z.string().min(1).max(1000).optional(),
});
export const ComplianceFiltersSchema = z.object({
    status: z.nativeEnum(ComplianceStatus).optional(),
    priority: z.nativeEnum(Priority).optional(),
    compliance_type: z.nativeEnum(ComplianceType).optional(),
    department_id: z.string().uuid().optional(),
    assignee_id: z.string().uuid().optional(),
    search: z.string().optional(),
    due_before: z.string().datetime().optional(),
    due_after: z.string().datetime().optional(),
    page: z.number().int().min(1).default(1),
    per_page: z.number().int().min(1).max(100).default(25),
    sort_by: z.enum(["due_date", "priority", "status", "created_at", "title"]).default("due_date"),
    sort_order: z.enum(["asc", "desc"]).default("asc"),
});
//# sourceMappingURL=compliance.js.map