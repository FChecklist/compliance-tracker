import { z } from "zod";
export const NotificationPreferencesSchema = z.object({
    email_deadline_reminder: z.boolean().default(true),
    email_overdue: z.boolean().default(true),
    email_assignment: z.boolean().default(true),
    push_deadline_reminder: z.boolean().default(true),
    push_overdue: z.boolean().default(true),
    push_assignment: z.boolean().default(true),
});
//# sourceMappingURL=notification.js.map