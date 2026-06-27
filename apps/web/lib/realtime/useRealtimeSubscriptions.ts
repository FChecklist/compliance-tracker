"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { useComplianceStore } from "../stores/compliance";
import { useNotificationStore } from "../stores/notifications";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Hook that subscribes to Supabase Realtime channels for live updates.
 * Call once in the (app)/layout.tsx — it handles cleanup automatically.
 */
export function useRealtimeSubscriptions(orgId: string | null) {
  const { updateItem, removeItem, setItems, pagination } = useComplianceStore();
  const { setNotifications } = useNotificationStore();
  const channelsRef = useRef<ReturnType<typeof createClient>["channel"][]>([]);

  useEffect(() => {
    if (!orgId) return;

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Channel 1: Compliance items changes
    const complianceChannel = supabase
      .channel(`compliance:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "compliance_tracker",
          table: "compliance",
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            updateItem(payload.new.id, payload.new as Record<string, unknown>);
          } else if (payload.eventType === "DELETE") {
            removeItem(payload.old.id);
          }
          // For INSERTs, the list will refresh on next navigation/fetch
          // to keep things simple and avoid complex ordering logic
        }
      )
      .subscribe();

    // Channel 2: New notifications
    const notificationChannel = supabase
      .channel(`notifications:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "compliance_tracker",
          table: "notifications",
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          // Prepend the new notification to the store
          const newNotification = {
            id: payload.new.id,
            org_id: payload.new.org_id,
            user_id: payload.new.user_id,
            type: payload.new.type,
            title: payload.new.title,
            message: payload.new.message,
            is_read: payload.new.is_read,
            created_at: payload.new.created_at,
          };
          useNotificationStore.setState((state) => ({
            notifications: [newNotification, ...state.notifications],
            unreadCount: state.unreadCount + 1,
          }));
        }
      )
      .subscribe();

    channelsRef.current = [complianceChannel, notificationChannel];

    return () => {
      channelsRef.current.forEach((ch) => {
        supabase.removeChannel(ch);
      });
      channelsRef.current = [];
    };
  }, [orgId, updateItem, removeItem, setNotifications, setItems, pagination]);
}