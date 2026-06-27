"use client";
import { useEffect, useState } from "react";
import { useUIStore } from "@/stores/ui-store";
import { useNotificationStore } from "@/stores/notification-store";
import Link from "next/link";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/compliance": "Compliance",
  "/compliance/new": "New Compliance",
  "/settings": "Settings",
  "/users": "Users",
  "/departments": "Departments",
  "/ai": "AI Library",
  "/ai-chat": "AI Chat",
  "/audit-log": "Audit Log",
};

export function AppTopbar() {
  const { toggleSidebar } = useUIStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
  const [pathname, setPathname] = useState("");
  const [pageTitle, setPageTitle] = useState("Dashboard");

  // Fetch notifications on mount
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Poll every 60 seconds
  useEffect(() => {
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    setPathname(window.location.pathname);
    const match = Object.entries(PAGE_TITLES).find(([path]) =>
      window.location.pathname.startsWith(path)
    );
    setPageTitle(match ? match[1] : "ComplianceTrack");
  }, []);

  return (
    <header className="h-14 border-b border-gray-200 bg-white flex items-center px-4 gap-4 shrink-0">
      {/* Hamburger */}
      <button
        onClick={toggleSidebar}
        className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100"
        aria-label="Toggle sidebar"
      >
        <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Page title */}
      <h1 className="text-lg font-semibold text-gray-900 flex-1 truncate">{pageTitle}</h1>

      {/* Right section */}
      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <Link href="/notifications" className="relative p-2 rounded-lg hover:bg-gray-100" aria-label="Notifications">
          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>

        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
          <span className="text-white text-xs font-bold">U</span>
        </div>
      </div>
    </header>
  );
}