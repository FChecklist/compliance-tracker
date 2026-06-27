"use client";
import { Search } from "lucide-react";
import { Input } from "@compliance/ui";
import { usePathname } from "next/navigation";
import { NotificationBell } from "./NotificationBell";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/compliance": "Compliance",
  "/compliance/new": "New Compliance",
  "/departments": "Departments",
  "/users": "Users",
  "/ai": "AI Assistant",
  "/settings": "Settings",
};

export function AppTopbar() {
  const pathname = usePathname();
  // Find the best matching title
  let title = "ComplianceTrack";
  for (const [path, label] of Object.entries(pageTitles)) {
    if (pathname === path || (path !== "/dashboard" && pathname.startsWith(path))) {
      title = label;
      break;
    }
  }
  if (pathname === "/") title = "Dashboard";

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
      <div className="flex items-center gap-4">
        <div className="relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Quick search..."
            className="pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 w-64 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white"
          />
        </div>
        <NotificationBell />
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-semibold">A</div>
      </div>
    </header>
  );
}