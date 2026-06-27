import { z } from "zod";
import { ComplianceType, ComplianceStatus, Priority } from "./enums";
export interface Compliance {
    id: string;
    org_id: string;
    department_id: string | null;
    title: string;
    description: string;
    compliance_type: ComplianceType;
    status: ComplianceStatus;
    priority: Priority;
    assignee_id: string | null;
    due_date: string | null;
    unique_url_slug: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}
export interface ComplianceHistory {
    id: string;
    compliance_id: string;
    old_status: ComplianceStatus | null;
    new_status: ComplianceStatus;
    changed_by: string;
    change_reason: string;
    created_at: string;
}
export declare const ComplianceSchema: z.ZodObject<{
    id: z.ZodString;
    org_id: z.ZodString;
    department_id: z.ZodNullable<z.ZodString>;
    title: z.ZodString;
    description: z.ZodString;
    compliance_type: z.ZodNativeEnum<{
        readonly IT: "it";
        readonly TAX: "tax";
        readonly LEGAL: "legal";
        readonly REGULATORY: "regulatory";
        readonly OPERATIONAL: "operational";
        readonly ENVIRONMENTAL: "environmental";
        readonly HR: "hr";
        readonly FINANCE: "finance";
        readonly OTHER: "other";
    }>;
    status: z.ZodNativeEnum<{
        readonly DRAFT: "draft";
        readonly PENDING: "pending";
        readonly IN_PROGRESS: "in_progress";
        readonly COMPLETED: "completed";
        readonly OVERDUE: "overdue";
    }>;
    priority: z.ZodNativeEnum<{
        readonly CRITICAL: "critical";
        readonly HIGH: "high";
        readonly MEDIUM: "medium";
        readonly LOW: "low";
    }>;
    assignee_id: z.ZodNullable<z.ZodString>;
    due_date: z.ZodNullable<z.ZodString>;
    unique_url_slug: z.ZodString;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    status: "draft" | "pending" | "in_progress" | "completed" | "overdue";
    id: string;
    org_id: string;
    department_id: string | null;
    title: string;
    description: string;
    compliance_type: "it" | "tax" | "legal" | "regulatory" | "operational" | "environmental" | "hr" | "finance" | "other";
    priority: "critical" | "high" | "medium" | "low";
    assignee_id: string | null;
    due_date: string | null;
    unique_url_slug: string;
    metadata: Record<string, unknown>;
}, {
    status: "draft" | "pending" | "in_progress" | "completed" | "overdue";
    id: string;
    org_id: string;
    department_id: string | null;
    title: string;
    description: string;
    compliance_type: "it" | "tax" | "legal" | "regulatory" | "operational" | "environmental" | "hr" | "finance" | "other";
    priority: "critical" | "high" | "medium" | "low";
    assignee_id: string | null;
    due_date: string | null;
    unique_url_slug: string;
    metadata?: Record<string, unknown> | undefined;
}>;
export declare const CreateComplianceSchema: z.ZodObject<Omit<{
    id: z.ZodString;
    org_id: z.ZodString;
    department_id: z.ZodNullable<z.ZodString>;
    title: z.ZodString;
    description: z.ZodString;
    compliance_type: z.ZodNativeEnum<{
        readonly IT: "it";
        readonly TAX: "tax";
        readonly LEGAL: "legal";
        readonly REGULATORY: "regulatory";
        readonly OPERATIONAL: "operational";
        readonly ENVIRONMENTAL: "environmental";
        readonly HR: "hr";
        readonly FINANCE: "finance";
        readonly OTHER: "other";
    }>;
    status: z.ZodNativeEnum<{
        readonly DRAFT: "draft";
        readonly PENDING: "pending";
        readonly IN_PROGRESS: "in_progress";
        readonly COMPLETED: "completed";
        readonly OVERDUE: "overdue";
    }>;
    priority: z.ZodNativeEnum<{
        readonly CRITICAL: "critical";
        readonly HIGH: "high";
        readonly MEDIUM: "medium";
        readonly LOW: "low";
    }>;
    assignee_id: z.ZodNullable<z.ZodString>;
    due_date: z.ZodNullable<z.ZodString>;
    unique_url_slug: z.ZodString;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "status" | "id" | "unique_url_slug">, "strip", z.ZodTypeAny, {
    org_id: string;
    department_id: string | null;
    title: string;
    description: string;
    compliance_type: "it" | "tax" | "legal" | "regulatory" | "operational" | "environmental" | "hr" | "finance" | "other";
    priority: "critical" | "high" | "medium" | "low";
    assignee_id: string | null;
    due_date: string | null;
    metadata: Record<string, unknown>;
}, {
    org_id: string;
    department_id: string | null;
    title: string;
    description: string;
    compliance_type: "it" | "tax" | "legal" | "regulatory" | "operational" | "environmental" | "hr" | "finance" | "other";
    priority: "critical" | "high" | "medium" | "low";
    assignee_id: string | null;
    due_date: string | null;
    metadata?: Record<string, unknown> | undefined;
}>;
export declare const UpdateComplianceSchema: z.ZodObject<Omit<{
    id: z.ZodOptional<z.ZodString>;
    org_id: z.ZodOptional<z.ZodString>;
    department_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    compliance_type: z.ZodOptional<z.ZodNativeEnum<{
        readonly IT: "it";
        readonly TAX: "tax";
        readonly LEGAL: "legal";
        readonly REGULATORY: "regulatory";
        readonly OPERATIONAL: "operational";
        readonly ENVIRONMENTAL: "environmental";
        readonly HR: "hr";
        readonly FINANCE: "finance";
        readonly OTHER: "other";
    }>>;
    status: z.ZodOptional<z.ZodNativeEnum<{
        readonly DRAFT: "draft";
        readonly PENDING: "pending";
        readonly IN_PROGRESS: "in_progress";
        readonly COMPLETED: "completed";
        readonly OVERDUE: "overdue";
    }>>;
    priority: z.ZodOptional<z.ZodNativeEnum<{
        readonly CRITICAL: "critical";
        readonly HIGH: "high";
        readonly MEDIUM: "medium";
        readonly LOW: "low";
    }>>;
    assignee_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    due_date: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    unique_url_slug: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, "id">, "strip", z.ZodTypeAny, {
    status?: "draft" | "pending" | "in_progress" | "completed" | "overdue" | undefined;
    org_id?: string | undefined;
    department_id?: string | null | undefined;
    title?: string | undefined;
    description?: string | undefined;
    compliance_type?: "it" | "tax" | "legal" | "regulatory" | "operational" | "environmental" | "hr" | "finance" | "other" | undefined;
    priority?: "critical" | "high" | "medium" | "low" | undefined;
    assignee_id?: string | null | undefined;
    due_date?: string | null | undefined;
    unique_url_slug?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    status?: "draft" | "pending" | "in_progress" | "completed" | "overdue" | undefined;
    org_id?: string | undefined;
    department_id?: string | null | undefined;
    title?: string | undefined;
    description?: string | undefined;
    compliance_type?: "it" | "tax" | "legal" | "regulatory" | "operational" | "environmental" | "hr" | "finance" | "other" | undefined;
    priority?: "critical" | "high" | "medium" | "low" | undefined;
    assignee_id?: string | null | undefined;
    due_date?: string | null | undefined;
    unique_url_slug?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export declare const ChangeStatusSchema: z.ZodObject<{
    new_status: z.ZodNativeEnum<{
        readonly DRAFT: "draft";
        readonly PENDING: "pending";
        readonly IN_PROGRESS: "in_progress";
        readonly COMPLETED: "completed";
        readonly OVERDUE: "overdue";
    }>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    new_status: "draft" | "pending" | "in_progress" | "completed" | "overdue";
    reason?: string | undefined;
}, {
    new_status: "draft" | "pending" | "in_progress" | "completed" | "overdue";
    reason?: string | undefined;
}>;
export declare const ReassignSchema: z.ZodObject<{
    assignee_id: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    assignee_id: string;
    reason?: string | undefined;
}, {
    assignee_id: string;
    reason?: string | undefined;
}>;
export declare const BulkStatusChangeSchema: z.ZodObject<{
    compliance_ids: z.ZodArray<z.ZodString, "many">;
    new_status: z.ZodNativeEnum<{
        readonly DRAFT: "draft";
        readonly PENDING: "pending";
        readonly IN_PROGRESS: "in_progress";
        readonly COMPLETED: "completed";
        readonly OVERDUE: "overdue";
    }>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    new_status: "draft" | "pending" | "in_progress" | "completed" | "overdue";
    compliance_ids: string[];
    reason?: string | undefined;
}, {
    new_status: "draft" | "pending" | "in_progress" | "completed" | "overdue";
    compliance_ids: string[];
    reason?: string | undefined;
}>;
export declare const ComplianceFiltersSchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodNativeEnum<{
        readonly DRAFT: "draft";
        readonly PENDING: "pending";
        readonly IN_PROGRESS: "in_progress";
        readonly COMPLETED: "completed";
        readonly OVERDUE: "overdue";
    }>>;
    priority: z.ZodOptional<z.ZodNativeEnum<{
        readonly CRITICAL: "critical";
        readonly HIGH: "high";
        readonly MEDIUM: "medium";
        readonly LOW: "low";
    }>>;
    compliance_type: z.ZodOptional<z.ZodNativeEnum<{
        readonly IT: "it";
        readonly TAX: "tax";
        readonly LEGAL: "legal";
        readonly REGULATORY: "regulatory";
        readonly OPERATIONAL: "operational";
        readonly ENVIRONMENTAL: "environmental";
        readonly HR: "hr";
        readonly FINANCE: "finance";
        readonly OTHER: "other";
    }>>;
    department_id: z.ZodOptional<z.ZodString>;
    assignee_id: z.ZodOptional<z.ZodString>;
    search: z.ZodOptional<z.ZodString>;
    due_before: z.ZodOptional<z.ZodString>;
    due_after: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    per_page: z.ZodDefault<z.ZodNumber>;
    sort_by: z.ZodDefault<z.ZodEnum<["due_date", "priority", "status", "created_at", "title"]>>;
    sort_order: z.ZodDefault<z.ZodEnum<["asc", "desc"]>>;
}, "strip", z.ZodTypeAny, {
    page: number;
    per_page: number;
    sort_by: "status" | "title" | "priority" | "due_date" | "created_at";
    sort_order: "asc" | "desc";
    status?: "draft" | "pending" | "in_progress" | "completed" | "overdue" | undefined;
    department_id?: string | undefined;
    compliance_type?: "it" | "tax" | "legal" | "regulatory" | "operational" | "environmental" | "hr" | "finance" | "other" | undefined;
    priority?: "critical" | "high" | "medium" | "low" | undefined;
    assignee_id?: string | undefined;
    search?: string | undefined;
    due_before?: string | undefined;
    due_after?: string | undefined;
}, {
    status?: "draft" | "pending" | "in_progress" | "completed" | "overdue" | undefined;
    department_id?: string | undefined;
    compliance_type?: "it" | "tax" | "legal" | "regulatory" | "operational" | "environmental" | "hr" | "finance" | "other" | undefined;
    priority?: "critical" | "high" | "medium" | "low" | undefined;
    assignee_id?: string | undefined;
    search?: string | undefined;
    due_before?: string | undefined;
    due_after?: string | undefined;
    page?: number | undefined;
    per_page?: number | undefined;
    sort_by?: "status" | "title" | "priority" | "due_date" | "created_at" | undefined;
    sort_order?: "asc" | "desc" | undefined;
}>;
//# sourceMappingURL=compliance.d.ts.map