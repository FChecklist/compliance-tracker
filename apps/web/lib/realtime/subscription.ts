/**
 * Supabase Realtime Subscription Helpers
 *
 * Provides typed subscription functions for live compliance updates,
 * notifications, and audit events. Uses the Supabase JS client
 * (separate from Drizzle ORM which handles queries).
 */

import type { RealtimeChannel } from "@supabase/supabase-js";

/* ------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------ */

export type RealtimeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

export interface CompliancePayload {
  eventType: RealtimeEvent;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

export interface NotificationPayload {
  eventType: RealtimeEvent;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

export type ComplianceCallback = (payload: CompliancePayload) => void;
export type NotificationCallback = (payload: NotificationPayload) => void;

/* ------------------------------------------------------------------
 * Channel name helpers
 * ------------------------------------------------------------------ */

/** Org-scoped channel: each org gets its own channel for isolation. */
export function orgChannel(orgId: string): string {
  return `org:${orgId}`;
}

/** User-scoped notification channel. */
export function userNotificationChannel(userId: string): string {
  return `user:notifications:${userId}`;
}

/* ------------------------------------------------------------------
 * Lazy Supabase client
 * ------------------------------------------------------------------ */

let _supabase: ReturnType<typeof import("@supabase/supabase-js").createClient> | null = null;

async function getSupabase() {
  if (_supabase) return _supabase;
  const { createClient } = await import("@supabase/supabase-js");
  _supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return _supabase;
}

/* ------------------------------------------------------------------
 * subscribeToComplianceChanges
 *
 * Listens for INSERT/UPDATE/DELETE on the `compliance_items` table
 * filtered to a specific organisation.
 *
 * Returns an unsubscribe function.
 * ------------------------------------------------------------------ */

export async function subscribeToComplianceChanges(
  orgId: string,
  callback: ComplianceCallback,
  events: RealtimeEvent[] = ["INSERT", "UPDATE", "DELETE"],
): Promise<() => void> {
  const supabase = await getSupabase();
  const channelName = orgChannel(orgId);

  const channel: RealtimeChannel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: events.length === 1 ? events[0] : "*",
        schema: "compliance_tracker",
        table: "compliance_items",
        filter: `organisation_id=eq.${orgId}`,
      },
      (payload) => callback(payload as CompliancePayload),
    );

  await channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}

/* ------------------------------------------------------------------
 * subscribeToNotifications
 *
 * Listens for new INSERT rows in the `notifications` table
 * for a specific user.
 * ------------------------------------------------------------------ */

export async function subscribeToNotifications(
  userId: string,
  callback: NotificationCallback,
): Promise<() => void> {
  const supabase = await getSupabase();
  const channelName = userNotificationChannel(userId);

  const channel: RealtimeChannel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "compliance_tracker",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => callback(payload as NotificationPayload),
    );

  await channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}

/* ------------------------------------------------------------------
 * unsubscribeAll
 *
 * Removes every active channel. Call on logout / page unmount.
 * ------------------------------------------------------------------ */

export async function unsubscribeAll(): Promise<void> {
  const supabase = await getSupabase();
  supabase.removeAllChannels();
}