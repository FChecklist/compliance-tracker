export const ComplianceType = {
  IT: "it",
  TAX: "tax",
  LEGAL: "legal",
  REGULATORY: "regulatory",
  OPERATIONAL: "operational",
  ENVIRONMENTAL: "environmental",
  HR: "hr",
  FINANCE: "finance",
  OTHER: "other",
} as const;
export type ComplianceType = (typeof ComplianceType)[keyof typeof ComplianceType];

export const ComplianceStatus = {
  DRAFT: "draft",
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  OVERDUE: "overdue",
} as const;
export type ComplianceStatus = (typeof ComplianceStatus)[keyof typeof ComplianceStatus];

export const StatusTransitions: Record<ComplianceStatus, ComplianceStatus[]> = {
  draft: ["pending", "in_progress"],
  pending: ["in_progress", "completed", "overdue"],
  in_progress: ["completed", "pending", "overdue"],
  completed: ["in_progress", "pending"],
  overdue: ["in_progress", "pending", "completed"],
};

export const Priority = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const Role = {
  ACCOUNT_ADMIN: "account_admin",
  CLIENT_DEPARTMENT_ADMIN: "client_department_admin",
  EDITOR: "editor",
  VIEWER: "viewer",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const NotificationType = {
  DEADLINE_APPROACHING: "deadline_approaching",
  OVERDUE: "overdue",
  ASSIGNED: "assigned",
  REASSIGNED: "reassigned",
  STATUS_CHANGED: "status_changed",
  COMMENT_ADDED: "comment_added",
  DOCUMENT_UPLOADED: "document_uploaded",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const PendencyBucket = {
  DELAYED: "delayed",
  H24: "24h",
  D7: "7d",
  D30: "30d",
  D60: "60d",
  D90: "90d",
  D180: "180d",
  D365: "365d",
} as const;
export type PendencyBucket = (typeof PendencyBucket)[keyof typeof PendencyBucket];

export const AgentType = {
  FREELANCE: "freelance",
  COMPANY: "company",
} as const;
export type AgentType = (typeof AgentType)[keyof typeof AgentType];

export const SalesChannelType = {
  FREELANCE_AGENT: "freelance_agent",
  AI_AGENT: "ai_agent",
  COMPANY_NETWORK: "company_network",
  DIGITAL_MARKETING: "digital_marketing",
  TELESALES: "telesales",
  FIRM_PARTNERSHIP: "firm_partnership",
  INDIVIDUAL: "individual",
  ENTERPRISE: "enterprise",
} as const;
export type SalesChannelType = (typeof SalesChannelType)[keyof typeof SalesChannelType];

export const PlanType = {
  SINGLE_ENTITY: "single_entity",
  MULTI_CLIENT: "multi_client",
} as const;
export type PlanType = (typeof PlanType)[keyof typeof PlanType];