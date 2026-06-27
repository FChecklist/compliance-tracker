"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useNotificationStore } from "@/stores/notification-store";

type Notification = {
  id: string;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  created_at: string;
  link_url?: string;
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const TYPE_ICON: Record<string, { bg: string; label: string }> = {
  deadline: { bg: "bg-red-100 text-red-600", label: "DL" },
  status_change: { bg: "bg-blue-100 text-blue-600", label: "SC" },
  assignment: { bg: "bg-purple-100 text-purple-600", label: "AS" },
  reminder: { bg: "bg-yellow-100 text-yellow-600", label: "RM" },
  system: { bg: "bg-gray-100 text-gray-600", label: "SY" },
};

export default function NotificationsPage() {
  const { notifications, unreadCount, markRead, markAllRead, fetchNotifications } =
    useNotificationStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotifications().finally(() => setLoading(false));
  }, [fetchNotifications]);

  const handleMarkRead = async (id: string) => {
    markRead(id);
    await fetch("/api/notifications/[id]/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notification_id: id }),
    }).catch(() => {});
  };

  const handleMarkAllRead = async () => {
    markAllRead();
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark_all: true }),
    }).catch(() => {});
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {unreadCount > 0
              ? `${unreadCount} unread`
              : "You're all caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Mark all as read
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🔔</div>
          <p className="text-gray-500">No notifications yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n: Notification) => {
            const icon = TYPE_ICON[n.type] ?? TYPE_ICON.system;
            const Wrapper = n.link_url ? Link : "div";
            return (
              <Wrapper
                key={n.id}
                href={n.link_url ?? ""}
                onClick={() => !n.is_read && handleMarkRead(n.id)}
                className={`flex items-start gap-4 p-4 rounded-xl border transition-colors cursor-pointer ${
                  n.is_read
                    ? "bg-white border-gray-100"
                    : "bg-blue-50/50 border-blue-100"
                } hover:bg-gray-50`}
              >
                {/* Type badge */}
                <span
                  className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold ${icon.bg}`}
                >
                  {icon.label}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${!n.is_read ? "font-semibold text-gray-900" : "text-gray-700"}`}>
                    {n.title}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                  <p className="text-xs text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                </div>

                {/* Unread dot */}
                {!n.is_read && (
                  <span className="shrink-0 w-2.5 h-2.5 bg-blue-500 rounded-full mt-1.5" />
                )}
              </Wrapper>
            );
          })}
        </div>
      )}
    </div>
  );
}