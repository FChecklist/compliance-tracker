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

export const NotificationPreferencesSchema = z.object({
  email_deadline_reminder: z.boolean().default(true),
  email_overdue: z.boolean().default(true),
  email_assignment: z.boolean().default(true),
  push_deadline_reminder: z.boolean().default(true),
  push_overdue: z.boolean().default(true),
  push_assignment: z.boolean().default(true),
});
