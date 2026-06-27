import type { Role } from "@compliancetrack/types";

const ROLE_HIERARCHY: Record<Role, number> = {
  account_admin: 1,
  client_department_admin: 2,
  editor: 3,
  viewer: 4,
};

const ROLE_PERMISSIONS: Record<Role, Record<string, string[]>> = {
  account_admin: {
    organisations: ["create", "read", "update", "delete", "manage"],
    users: ["create", "read", "update", "delete", "invite", "change_role"],
    departments: ["create", "read", "update", "delete"],
    compliance: ["create", "read", "update", "delete", "status_change", "reassign", "bulk"],
    documents: ["create", "read", "delete"],
    audit_log: ["read"],
    api_tokens: ["create", "read", "delete"],
    webhooks: ["create", "read", "update", "delete"],
    sales: ["create", "read", "update", "delete"],
    settings: ["read", "update"],
  },
  client_department_admin: {
    organisations: ["read"],
    users: ["create", "read", "update", "invite", "change_role"],
    departments: ["create", "read", "update"],
    compliance: ["create", "read", "update", "status_change", "reassign"],
    documents: ["create", "read", "delete"],
    audit_log: ["read"],
  },
  editor: {
    compliance: ["create", "read", "update"],
    documents: ["create", "read", "delete"],
    comments: ["create", "read", "update", "delete"],
  },
  viewer: {
    compliance: ["read"],
    documents: ["read"],
    audit_log: ["read"],
    comments: ["read"],
  },
};

export function hasPermission(userRole: Role, resource: string, action: string): boolean {
  const permissions = ROLE_PERMISSIONS[userRole];
  if (!permissions) return false;
  const resourcePerms = permissions[resource];
  if (!resourcePerms) return false;
  return resourcePerms.includes(action) || resourcePerms.includes("manage");
}

export function canManageUser(actorRole: Role, targetRole: Role): boolean {
  return ROLE_HIERARCHY[actorRole] <= ROLE_HIERARCHY[targetRole];
}

export function canAccessCompliance(
  userRole: Role,
  userOrgId: string,
  userDepartmentIds: string[],
  complianceOrgId: string,
  complianceDepartmentId: string | null,
  complianceAssigneeId: string | null,
  userId: string,
): boolean {
  if (userOrgId !== complianceOrgId) return false;
  if (userRole === "account_admin") return true;
  if (complianceAssigneeId === userId) return true;
  if (complianceDepartmentId && userDepartmentIds.includes(complianceDepartmentId)) return true;
  return userRole === "viewer" || userRole === "editor" || userRole === "client_department_admin";
}
