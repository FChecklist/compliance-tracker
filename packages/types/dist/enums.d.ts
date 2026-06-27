export declare const ComplianceType: {
    readonly IT: "it";
    readonly TAX: "tax";
    readonly LEGAL: "legal";
    readonly REGULATORY: "regulatory";
    readonly OPERATIONAL: "operational";
    readonly ENVIRONMENTAL: "environmental";
    readonly HR: "hr";
    readonly FINANCE: "finance";
    readonly OTHER: "other";
};
export type ComplianceType = (typeof ComplianceType)[keyof typeof ComplianceType];
export declare const ComplianceStatus: {
    readonly DRAFT: "draft";
    readonly PENDING: "pending";
    readonly IN_PROGRESS: "in_progress";
    readonly COMPLETED: "completed";
    readonly OVERDUE: "overdue";
};
export type ComplianceStatus = (typeof ComplianceStatus)[keyof typeof ComplianceStatus];
export declare const StatusTransitions: Record<ComplianceStatus, ComplianceStatus[]>;
export declare const Priority: {
    readonly CRITICAL: "critical";
    readonly HIGH: "high";
    readonly MEDIUM: "medium";
    readonly LOW: "low";
};
export type Priority = (typeof Priority)[keyof typeof Priority];
export declare const Role: {
    readonly ACCOUNT_ADMIN: "account_admin";
    readonly CLIENT_DEPARTMENT_ADMIN: "client_department_admin";
    readonly EDITOR: "editor";
    readonly VIEWER: "viewer";
};
export type Role = (typeof Role)[keyof typeof Role];
export declare const NotificationType: {
    readonly DEADLINE_APPROACHING: "deadline_approaching";
    readonly OVERDUE: "overdue";
    readonly ASSIGNED: "assigned";
    readonly REASSIGNED: "reassigned";
    readonly STATUS_CHANGED: "status_changed";
    readonly COMMENT_ADDED: "comment_added";
    readonly DOCUMENT_UPLOADED: "document_uploaded";
};
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
export declare const PendencyBucket: {
    readonly DELAYED: "delayed";
    readonly H24: "24h";
    readonly D7: "7d";
    readonly D30: "30d";
    readonly D60: "60d";
    readonly D90: "90d";
    readonly D180: "180d";
    readonly D365: "365d";
};
export type PendencyBucket = (typeof PendencyBucket)[keyof typeof PendencyBucket];
export declare const AgentType: {
    readonly FREELANCE: "freelance";
    readonly COMPANY: "company";
};
export type AgentType = (typeof AgentType)[keyof typeof AgentType];
export declare const SalesChannelType: {
    readonly FREELANCE_AGENT: "freelance_agent";
    readonly AI_AGENT: "ai_agent";
    readonly COMPANY_NETWORK: "company_network";
    readonly DIGITAL_MARKETING: "digital_marketing";
    readonly TELESALES: "telesales";
    readonly FIRM_PARTNERSHIP: "firm_partnership";
    readonly INDIVIDUAL: "individual";
    readonly ENTERPRISE: "enterprise";
};
export type SalesChannelType = (typeof SalesChannelType)[keyof typeof SalesChannelType];
export declare const PlanType: {
    readonly SINGLE_ENTITY: "single_entity";
    readonly MULTI_CLIENT: "multi_client";
};
export type PlanType = (typeof PlanType)[keyof typeof PlanType];
//# sourceMappingURL=enums.d.ts.map