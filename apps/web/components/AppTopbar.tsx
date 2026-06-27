"use client";

import { usePathname } from "next/navigation";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/compliance": "Compliance",
  "/departments": "Departments",
  "/users": "Users",
  "/settings": "Settings",
  "/audit-log": "Audit Log",
  "/admin": "Admin",
  "/onboarding": "Onboarding",
};

function getPageTitle(pathname: string): string {
  return PAGE_TITLES[pathname] ?? "ComplianceTrack";
}

export function AppTopbar() {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6 shrink-0">
      {/* Left — mobile hamburger */}
      <button
        type="button"
        className="lg:hidden inline-flex items-center justify-center rounded-md p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        aria-label="Toggle sidebar"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("toggle-sidebar"));
        }}
      >
        {/* Hamburger icon — three lines */}
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
          />
        </svg>
      </button>

      {/* Center — page title */}
      <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold text-gray-900 truncate max-w-[60%] sm:max-w-none sm:static sm:translate-x-0">
        {title}
      </h1>

      {/* Right — notifications + avatar */}
      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <button
          type="button"
          className="relative inline-flex items-center justify-center rounded-full p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Notifications"
        >
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
            />
          </svg>
          {/* Red dot badge */}
          <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none text-white">
            3
          </span>
        </button>

        {/* User avatar circle */}
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white select-none"
          aria-label="User avatar"
        >
          U
        </div>
      </div>
    </header>
  );
}