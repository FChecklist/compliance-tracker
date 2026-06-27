"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ADMIN_NAV = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/org-settings", label: "Org Settings" },
  { href: "/admin/roles", label: "Roles" },
  { href: "/admin/departments", label: "Departments" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
      </div>
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {ADMIN_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${
              path === item.href
                ? "bg-white text-blue-700 border border-b-white -mb-px"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
      {children}
    </div>
  );
}