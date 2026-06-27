import { z } from "zod";
import { Role } from "./enums";
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
//# sourceMappingURL=user.js.map