import { z } from "zod";
import { Role } from "./enums";
export interface User {
    id: string;
    email: string;
    phone: string | null;
    full_name: string;
    avatar_url: string | null;
    org_id: string;
    role: Role;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
}
export interface UserProfile {
    id: string;
    email: string;
    full_name: string;
    avatar_url: string | null;
    role: Role;
    org_id: string;
    org_name: string;
}
export interface AccessRequest {
    id: string;
    org_id: string;
    requester_id: string;
    compliance_id: string | null;
    requested_access_level: "edit" | "view";
    status: "pending" | "approved" | "rejected";
    created_at: string;
}
export declare const UserSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    phone: z.ZodNullable<z.ZodString>;
    full_name: z.ZodString;
    avatar_url: z.ZodNullable<z.ZodString>;
    org_id: z.ZodString;
    role: z.ZodNativeEnum<{
        readonly ACCOUNT_ADMIN: "account_admin";
        readonly CLIENT_DEPARTMENT_ADMIN: "client_department_admin";
        readonly EDITOR: "editor";
        readonly VIEWER: "viewer";
    }>;
    is_active: z.ZodDefault<z.ZodBoolean>;
    last_login_at: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    email: string;
    phone: string | null;
    id: string;
    org_id: string;
    is_active: boolean;
    full_name: string;
    avatar_url: string | null;
    role: "account_admin" | "client_department_admin" | "editor" | "viewer";
    last_login_at: string | null;
}, {
    email: string;
    phone: string | null;
    id: string;
    org_id: string;
    full_name: string;
    avatar_url: string | null;
    role: "account_admin" | "client_department_admin" | "editor" | "viewer";
    last_login_at: string | null;
    is_active?: boolean | undefined;
}>;
export declare const InviteUserSchema: z.ZodObject<{
    email: z.ZodString;
    full_name: z.ZodString;
    role: z.ZodNativeEnum<{
        readonly ACCOUNT_ADMIN: "account_admin";
        readonly CLIENT_DEPARTMENT_ADMIN: "client_department_admin";
        readonly EDITOR: "editor";
        readonly VIEWER: "viewer";
    }>;
    department_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    email: string;
    full_name: string;
    role: "account_admin" | "client_department_admin" | "editor" | "viewer";
    department_id?: string | undefined;
}, {
    email: string;
    full_name: string;
    role: "account_admin" | "client_department_admin" | "editor" | "viewer";
    department_id?: string | undefined;
}>;
export declare const UpdateUserRoleSchema: z.ZodObject<{
    role: z.ZodNativeEnum<{
        readonly ACCOUNT_ADMIN: "account_admin";
        readonly CLIENT_DEPARTMENT_ADMIN: "client_department_admin";
        readonly EDITOR: "editor";
        readonly VIEWER: "viewer";
    }>;
}, "strip", z.ZodTypeAny, {
    role: "account_admin" | "client_department_admin" | "editor" | "viewer";
}, {
    role: "account_admin" | "client_department_admin" | "editor" | "viewer";
}>;
//# sourceMappingURL=user.d.ts.map