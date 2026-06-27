"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "🏠" },
  { href: "/compliance", label: "Compliance", icon: "✅" },
  { href: "/departments", label: "Departments", icon: "🏢" },
  { href: "/users", label: "Users", icon: "👥" },
  { href: "/ai", label: "AI Library", icon: "🤖" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function AppSidebar() {
  const path = usePathname();
  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <span className="font-bold text-blue-600 text-lg">ComplianceTrack</span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map(item => (
          <Link key={item.href} href={item.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${path.startsWith(item.href) ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-100"}`}>
            <span>{item.icon}</span>{item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}