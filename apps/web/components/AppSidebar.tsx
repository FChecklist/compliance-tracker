"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@compliance/ui";
import {
  LayoutDashboard, ClipboardCheck, Building2, Users, Settings, Bot,
  Bell, ChevronLeft, ChevronRight, Shield, LogOut,
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/compliance", label: "Compliance", icon: ClipboardCheck },
  { href: "/departments", label: "Departments", icon: Building2 },
  { href: "/users", label: "Users", icon: Users },
  { href: "/ai", label: "AI Assistant", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface AppSidebarProps {
  orgName?: string;
  userName?: string;
  userRole?: string;
}

export function AppSidebar({ orgName = "My Organisation", userName = "Admin User", userRole = "account_admin" }: AppSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={cn(
        "flex flex-col bg-[#1C2B3A] text-white h-screen sticky top-0 transition-all duration-200",
        collapsed ? "w-[68px]" : "w-64"
      )}
    >
      {/* Logo / Org Header */}
      <div className="px-4 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#F5820A] flex items-center justify-center flex-shrink-0">
            <Shield className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <h2 className="font-bold text-sm text-white truncate">{orgName}</h2>
              <p className="text-[10px] text-gray-400 truncate">ComplianceTrack</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-white/10 text-white"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="mx-3 mb-2 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <><ChevronLeft className="w-4 h-4" /> Collapse</>}
      </button>

      {/* User Section */}
      <div className="border-t border-white/10 px-4 py-4">
        {!collapsed ? (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{userName}</p>
              <p className="text-xs text-gray-400 capitalize">{userRole.replace(/_/g, " ")}</p>
            </div>
            <div className="flex items-center gap-1">
              <button className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white relative">
                <Bell className="w-4 h-4" />
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-[#F5820A] rounded-full border-2 border-[#1C2B3A]" />
              </button>
              <button className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <button className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white relative">
              <Bell className="w-4 h-4" />
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-[#F5820A] rounded-full border-2 border-[#1C2B3A]" />
            </button>
            <button className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}