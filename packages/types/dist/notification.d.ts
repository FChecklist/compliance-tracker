import { z } from "zod";
import { NotificationType, PendencyBucket } from "./enums";
export interface Notification {
    id: string;
    org_id: string;
    user_id: string;
    type: NotificationType;
    title: string;
    body: string;
    is_read: boolean;
    link_url: string | null;
    created_at: string;
}
export interface PendencyItem {
    bucket: PendencyBucket;
    label: string;
    count: number;
    compliance_ids: string[];
}
export declare const NotificationPreferencesSchema: z.ZodObject<{
    email_deadline_reminder: z.ZodDefault<z.ZodBoolean>;
    email_overdue: z.ZodDefault<z.ZodBoolean>;
    email_assignment: z.ZodDefault<z.ZodBoolean>;
    push_deadline_reminder: z.ZodDefault<z.ZodBoolean>;
    push_overdue: z.ZodDefault<z.ZodBoolean>;
    push_assignment: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    email_deadline_reminder: boolean;
    email_overdue: boolean;
    email_assignment: boolean;
    push_deadline_reminder: boolean;
    push_overdue: boolean;
    push_assignment: boolean;
}, {
    email_deadline_reminder?: boolean | undefined;
    email_overdue?: boolean | undefined;
    email_assignment?: boolean | undefined;
    push_deadline_reminder?: boolean | undefined;
    push_overdue?: boolean | undefined;
    push_assignment?: boolean | undefined;
}>;
//# sourceMappingURL=notification.d.ts.map