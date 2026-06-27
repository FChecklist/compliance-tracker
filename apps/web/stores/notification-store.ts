import { create } from "zustand";

type Notification = {
  id: string;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  created_at: string;
  link_url?: string;
};

interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;
  setNotifications: (notifications: Notification[]) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  fetchNotifications: () => Promise<void>;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  unreadCount: 0,
  setNotifications: (notifications) =>
    set({
      notifications,
      unreadCount: notifications.filter((n) => !n.is_read).length,
    }),
  markRead: (id) =>
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, is_read: true } : n,
      );
      return { notifications, unreadCount: notifications.filter((n) => !n.is_read).length };
    }),
  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
      unreadCount: 0,
    })),
  fetchNotifications: async () => {
    try {
      const res = await fetch("/api/notifications", { credentials: "include" });
      const json = await res.json();
      if (json.success) {
        set({ notifications: json.data ?? [], unreadCount: json.meta?.unread_count ?? 0 });
      }
    } catch {
      // silent fail — polling will retry next cycle
    }
  },
}));
