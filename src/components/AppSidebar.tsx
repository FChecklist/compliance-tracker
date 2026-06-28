"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  AlertTriangle,
  ClipboardList,
  FileCheck,
  FileText,
  Users,
  Building2,
  Settings,
  History,
  Bot,
  X,
  CheckSquare,
  ListTodo,
  BarChart3,
  AlertCircle,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: { count: number; color: string };
};

type NavSection = {
  title: string;
  items: NavItem[];
};

function getNavSections(overdueCount: number, docCount: number): NavSection[] {
  return [
    {
      title: "OVERVIEW",
      items: [
        {
          label: "Dashboard",
          href: "/dashboard",
          icon: LayoutDashboard,
        },
        {
          label: "Pendency View",
          href: "/compliance?status=overdue",
          icon: AlertTriangle,
          badge: overdueCount > 0 ? { count: overdueCount, color: "bg-red-500 text-white" } : undefined,
        },
      ],
    },
    {
      title: "COMPLIANCE",
      items: [
        {
          label: "Register",
          href: "/compliance",
          icon: ClipboardList,
        },
        {
          label: "Audit Points",
          href: "/compliance?status=in_progress",
          icon: FileCheck,
        },
        {
          label: "Documents",
          href: "/compliance",
          icon: FileText,
          badge: docCount > 0 ? { count: docCount, color: "bg-amber-500 text-white" } : undefined,
        },
      ],
    },
    {
      title: "ADMIN",
      items: [
        {
          label: "Users",
          href: "/users",
          icon: Users,
        },
        {
          label: "Departments",
          href: "/departments",
          icon: Building2,
        },
        {
          label: "Settings",
          href: "/settings",
          icon: Settings,
        },
        {
          label: "Audit Log",
          href: "/audit",
          icon: History,
        },
      ],
    },
    {
      title: "TOOLS",
      items: [
        {
          label: "AI Assistant",
          href: "/dashboard",
          icon: Bot,
        },
        {
          label: "Checklists",
          href: "/checklists",
          icon: CheckSquare,
        },
        {
          label: "Tasks",
          href: "/tasks",
          icon: ListTodo,
        },
        {
          label: "Reports",
          href: "/reports",
          icon: BarChart3,
        },
        {
          label: "Penalty Tracker",
          href: "/penalties",
          icon: AlertCircle,
        },
        {
          label: "Team",
          href: "/team",
          icon: Users,
        },
      ],
    },
  ];
}

function SidebarContent({ overdueCount, docCount }: { overdueCount: number; docCount: number }) {
  const pathname = usePathname();
  const sections = getNavSections(overdueCount, docCount);

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex size-[34px] items-center justify-center rounded-lg bg-ct-saffron text-white font-bold text-sm shadow-saffron">
          CT
        </div>
        <span className="font-heading text-lg text-ct-navy tracking-tight">
          ComplianceTrack
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {sections.map((section) => (
          <div key={section.title} className="mb-4">
            <p className="px-3 mb-1.5 text-[10px] font-bold tracking-widest text-ct-muted uppercase">
              {section.title}
            </p>
            {section.items.map((item) => {
              const isActive =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href.split("?")[0]) && item.href !== "/dashboard";

              return (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 relative",
                    isActive
                      ? "bg-ct-accent text-ct-saffron font-bold border-l-[3px] border-ct-saffron"
                      : "text-ct-slate hover:bg-ct-cloud"
                  )}
                >
                  <item.icon className={cn("size-4 shrink-0", isActive && "text-ct-saffron")} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && (
                    <Badge
                      className={cn(
                        "h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full border-0 flex items-center justify-center",
                        item.badge.color
                      )}
                    >
                      {item.badge.count}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom org info */}
      <div className="px-5 py-4 border-t border-ct-border">
        <p className="text-xs text-ct-muted truncate">Acme Financial Services</p>
        <p className="text-[10px] text-ct-muted/60">Pvt. Ltd.</p>
      </div>
    </div>
  );
}

export function AppSidebar({ overdueCount = 0, docCount = 0 }: { overdueCount?: number; docCount?: number }) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-[220px] min-w-[220px] bg-ct-cream border-r border-ct-border h-full">
        <SidebarContent overdueCount={overdueCount} docCount={docCount} />
      </aside>

      {/* Mobile sidebar (Sheet) */}
      <div className="lg:hidden">
        <MobileSheetTrigger overdueCount={overdueCount} docCount={docCount} />
      </div>
    </>
  );
}

function MobileSheetTrigger({ overdueCount, docCount }: { overdueCount: number; docCount: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden text-white hover:bg-white/10"
        >
          <LayoutDashboard className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[260px] p-0 bg-ct-cream">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <SidebarContent overdueCount={overdueCount} docCount={docCount} />
      </SheetContent>
    </Sheet>
  );
}