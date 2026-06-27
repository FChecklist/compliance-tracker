export interface AuditLog {
  id: string;
  org_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  ip_address: string | null;
  machine_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type AuditAction =
  | "compliance.created"
  | "compliance.updated"
  | "compliance.status_changed"
  | "compliance.reassigned"
  | "compliance.deleted"
  | "user.invited"
  | "user.role_changed"
  | "user.deactivated"
  | "org.created"
  | "org.updated"
  | "department.created"
  | "department.updated"
  | "document.uploaded"
  | "document.deleted"
  | "auth.login"
  | "auth.logout"
  | "ai.query";