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
};
export const ComplianceStatus = {
    DRAFT: "draft",
    PENDING: "pending",
    IN_PROGRESS: "in_progress",
    COMPLETED: "completed",
    OVERDUE: "overdue",
};
export const StatusTransitions = {
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
};
export const Role = {
    ACCOUNT_ADMIN: "account_admin",
    CLIENT_DEPARTMENT_ADMIN: "client_department_admin",
    EDITOR: "editor",
    VIEWER: "viewer",
};
export const NotificationType = {
    DEADLINE_APPROACHING: "deadline_approaching",
    OVERDUE: "overdue",
    ASSIGNED: "assigned",
    REASSIGNED: "reassigned",
    STATUS_CHANGED: "status_changed",
    COMMENT_ADDED: "comment_added",
    DOCUMENT_UPLOADED: "document_uploaded",
};
export const PendencyBucket = {
    DELAYED: "delayed",
    H24: "24h",
    D7: "7d",
    D30: "30d",
    D60: "60d",
    D90: "90d",
    D180: "180d",
    D365: "365d",
};
export const AgentType = {
    FREELANCE: "freelance",
    COMPANY: "company",
};
export const SalesChannelType = {
    FREELANCE_AGENT: "freelance_agent",
    AI_AGENT: "ai_agent",
    COMPANY_NETWORK: "company_network",
    DIGITAL_MARKETING: "digital_marketing",
    TELESALES: "telesales",
    FIRM_PARTNERSHIP: "firm_partnership",
    INDIVIDUAL: "individual",
    ENTERPRISE: "enterprise",
};
export const PlanType = {
    SINGLE_ENTITY: "single_entity",
    MULTI_CLIENT: "multi_client",
};
//# sourceMappingURL=enums.js.map