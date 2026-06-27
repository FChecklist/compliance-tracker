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

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  phone: z.string().nullable(),
  full_name: z.string().min(1).max(255),
  avatar_url: z.string().url().nullable(),
  org_id: z.string().uuid(),
  role: z.nativeEnum(Role),
  is_active: z.boolean().default(true),
  last_login_at: z.string().datetime().nullable(),
});

export const InviteUserSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  role: z.nativeEnum(Role),
  department_id: z.string().uuid().optional(),
});

export const UpdateUserRoleSchema = z.object({
  role: z.nativeEnum(Role),
});