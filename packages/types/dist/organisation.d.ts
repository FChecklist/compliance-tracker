import { z } from "zod";
export interface Organisation {
    id: string;
    name: string;
    slug: string;
    plan_type: "single_entity" | "multi_client";
    owner_id: string;
    is_active: boolean;
    settings: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}
export declare const OrganisationSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    slug: z.ZodString;
    plan_type: z.ZodEnum<["single_entity", "multi_client"]>;
    owner_id: z.ZodString;
    is_active: z.ZodDefault<z.ZodBoolean>;
    settings: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    id: string;
    slug: string;
    plan_type: "single_entity" | "multi_client";
    owner_id: string;
    is_active: boolean;
    settings: Record<string, unknown>;
}, {
    name: string;
    id: string;
    slug: string;
    plan_type: "single_entity" | "multi_client";
    owner_id: string;
    is_active?: boolean | undefined;
    settings?: Record<string, unknown> | undefined;
}>;
export declare const CreateOrganisationSchema: z.ZodObject<Omit<{
    id: z.ZodString;
    name: z.ZodString;
    slug: z.ZodString;
    plan_type: z.ZodEnum<["single_entity", "multi_client"]>;
    owner_id: z.ZodString;
    is_active: z.ZodDefault<z.ZodBoolean>;
    settings: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "id">, "strip", z.ZodTypeAny, {
    name: string;
    slug: string;
    plan_type: "single_entity" | "multi_client";
    owner_id: string;
    is_active: boolean;
    settings: Record<string, unknown>;
}, {
    name: string;
    slug: string;
    plan_type: "single_entity" | "multi_client";
    owner_id: string;
    is_active?: boolean | undefined;
    settings?: Record<string, unknown> | undefined;
}>;
export declare const UpdateOrganisationSchema: z.ZodObject<Omit<{
    id: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    slug: z.ZodOptional<z.ZodString>;
    plan_type: z.ZodOptional<z.ZodEnum<["single_entity", "multi_client"]>>;
    owner_id: z.ZodOptional<z.ZodString>;
    is_active: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    settings: z.ZodOptional<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, "id">, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    slug?: string | undefined;
    plan_type?: "single_entity" | "multi_client" | undefined;
    owner_id?: string | undefined;
    is_active?: boolean | undefined;
    settings?: Record<string, unknown> | undefined;
}, {
    name?: string | undefined;
    slug?: string | undefined;
    plan_type?: "single_entity" | "multi_client" | undefined;
    owner_id?: string | undefined;
    is_active?: boolean | undefined;
    settings?: Record<string, unknown> | undefined;
}>;
//# sourceMappingURL=organisation.d.ts.map