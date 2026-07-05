"use client";

import Image from "next/image";
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
  HelpCircle,
  Bell,
  Upload,
  Gavel,
  Scale,
  Briefcase,
  ShieldAlert,
  Landmark,
  ShieldCheck,
  Leaf,
  Siren,
  UserCheck,
  FileWarning,
  Radio,
  FileSignature,
  CheckCircle2,
  Layers,
  Wallet,
  Link2,
  BookOpen,
  MessageSquare,
  Rocket,
  Zap,
  Ticket,
  TrendingUp,
  Sparkles,
  Database,
  Banknote,
  FileMinus,
  ArrowRightLeft,
  IndianRupee,
  Receipt,
  FolderOpen,
  UserPlus,
  ClipboardCheck,
  Undo2,
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

function getNavSections(overdueCount: number, docCount: number, noticeCount: number, accountType: string, pmsEnabled: boolean): NavSection[] {
  return [
    {
      title: "OVERVIEW",
      items: [
        {
          label: "Pendency View",
          href: "/compliance?status=overdue",
          icon: AlertTriangle,
          badge: overdueCount > 0 ? { count: overdueCount, color: "bg-red-500 text-white" } : undefined,
        },
        // Only shown for accounts that serve more than one client (CA firm /
        // legal firm / consultant) -- a plain 'company' account has exactly
        // one, auto-backfilled "Self" client and no reason to see this.
        ...(accountType !== "company"
          ? [
              { label: "VERI CUSTOMERS AI", href: "/clients", icon: Building2 },
              // Wave 41 (CRM, PLATFORM_STRATEGY.md §20): a lead-to-client
              // pipeline, gated identically to Clients -- a plain 'company'
              // account has no clients to prospect for.
              { label: "VERI CRM AI", href: "/crm", icon: TrendingUp },
            ]
          : []),
      ],
    },
    // Only shown once an org enables the separate, opt-in VERIDIAN AI PMS
    // product branch (Wave 25) -- absent by default for existing GRC orgs.
    ...(pmsEnabled
      ? [{ title: "PROJECTS", items: [{ label: "VERI PROJECTS AI", href: "/pms", icon: Rocket }] }]
      : []),
    // Wave 50 (VERI ERP gap-fill): shown unconditionally for now, matching
    // the GRC modules' own always-visible pattern -- the 'erp' branch has
    // no enablement-toggle UI built yet (that's PMS-only so far), so
    // gating this behind a still-unbuilt erpEnabled flag would just hide
    // real, working pages behind a switch nobody can flip.
    {
      title: "FINANCE",
      items: [
        { label: "Journal Entries", href: "/erp/journal-entries", icon: FileText },
        { label: "Budgeting", href: "/erp/budgets", icon: Wallet },
        { label: "Financial Reports", href: "/erp/reports", icon: TrendingUp },
        { label: "Cash Management", href: "/erp/cash-management", icon: Banknote },
        { label: "Credit Notes", href: "/erp/credit-notes", icon: FileMinus },
        { label: "Inventory", href: "/erp/inventory", icon: Database },
        { label: "Bank Reconciliation", href: "/erp/bank-reconciliation", icon: ArrowRightLeft },
        { label: "Procurement Workflow", href: "/erp/procurement", icon: ClipboardList },
        { label: "Statutory Payroll", href: "/erp/payroll", icon: IndianRupee },
        { label: "Invoicing", href: "/erp/invoicing", icon: Receipt },
        { label: "Returns (RMA)", href: "/erp/returns", icon: Undo2 },
        { label: "Contracts", href: "/erp/contracts", icon: FileSignature },
        { label: "Customers", href: "/erp/customers", icon: Users },
        { label: "Suppliers", href: "/erp/suppliers", icon: Building2 },
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
          label: "Notices",
          href: "/notices",
          icon: Bell,
          badge: noticeCount > 0 ? { count: noticeCount, color: "bg-amber-500 text-white" } : undefined,
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
        {
          label: "Bulk Import",
          href: "/compliance",
          icon: Upload,
        },
      ],
    },
    {
      title: "GOVERNANCE",
      items: [
        { label: "Board & Governance", href: "/board", icon: Gavel },
        { label: "Committees", href: "/committees", icon: Users },
        { label: "Related Party Transactions", href: "/rpt", icon: ShieldAlert },
        { label: "Delegation of Authority", href: "/doa", icon: Layers },
        { label: "Director & KMP Register", href: "/directors", icon: BookOpen },
        { label: "Board & Director Evaluation", href: "/board-evaluation", icon: CheckCircle2 },
        { label: "Policy Management", href: "/policies", icon: FileText },
      ],
    },
    {
      title: "COMPANY SECRETARIAL",
      items: [
        { label: "Statutory Registers", href: "/statutory-registers", icon: BookOpen },
        { label: "Share Capital & Cap Table", href: "/cap-table", icon: Wallet },
        { label: "Charges (ROC)", href: "/charges", icon: Link2 },
        { label: "Secretarial Audit", href: "/secretarial-audit", icon: ShieldCheck },
        { label: "MCA e-Filing", href: "/mca-filings", icon: FileSignature },
      ],
    },
    {
      title: "LEGAL",
      items: [
        { label: "External Counsel & Vendors", href: "/legal-vendors", icon: Scale },
        { label: "Litigation & Disputes", href: "/litigation", icon: Gavel },
        { label: "IP Portfolio", href: "/ip-portfolio", icon: BookOpen },
        { label: "Legal Opinions", href: "/legal-opinions", icon: FileText },
      ],
    },
    {
      title: "PEOPLE & HR",
      items: [
        { label: "Payroll & HR Statutory Compliance", href: "/hr-compliance", icon: Briefcase },
        { label: "Leave & Holiday Compliance", href: "/leave-holiday", icon: CheckSquare },
        { label: "POSH Compliance", href: "/posh", icon: UserCheck },
        { label: "VERI HR AI", href: "/hr", icon: Users },
        { label: "Recruitment", href: "/recruitment", icon: UserPlus },
        { label: "Performance Reviews", href: "/performance-reviews", icon: ClipboardCheck },
      ],
    },
    {
      title: "RISK",
      items: [{ label: "Risk Register", href: "/risks", icon: ShieldAlert }],
    },
    {
      title: "SECTOR REGULATORS",
      items: [
        { label: "SEBI (Listed Company)", href: "/sebi", icon: Landmark },
        { label: "RBI (Bank / NBFC)", href: "/rbi", icon: Landmark },
        { label: "IRDAI (Insurer)", href: "/irdai", icon: Landmark },
      ],
    },
    {
      title: "AUDIT",
      items: [
        { label: "Controls & Framework Library", href: "/frameworks", icon: ShieldCheck },
        { label: "Audit Management", href: "/audit-engagements", icon: ClipboardList },
        { label: "Audit Trail", href: "/audit", icon: History },
      ],
    },
    {
      title: "THIRD-PARTY & ESG",
      items: [
        { label: "Vendor & Third-Party Risk", href: "/vendor-risk", icon: ShieldAlert },
        { label: "ESG & Sustainability (BRSR)", href: "/esg", icon: Leaf },
      ],
    },
    {
      title: "INTEGRITY",
      items: [
        { label: "Whistleblower & Ethics", href: "/whistleblower", icon: FileWarning },
        { label: "Business Continuity", href: "/bcm", icon: Radio },
        { label: "Contract Compliance", href: "/contract-compliance", icon: FileSignature },
      ],
    },
    {
      title: "INCIDENTS & EVENTS",
      items: [{ label: "Incident Management", href: "/incidents", icon: Siren }],
    },
    {
      title: "ACCESS & APPROVALS",
      items: [{ label: "Approval Queue", href: "/approvals", icon: CheckCircle2 }],
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
          label: "VERI OPERATIONS AI",
          href: "/orchestra",
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
          label: "Documents",
          href: "/documents",
          icon: FolderOpen,
        },
        {
          label: "VERI REPORTS AI",
          href: "/reports",
          icon: BarChart3,
        },
        {
          label: "Knowledge Base",
          href: "/knowledge-base",
          icon: BookOpen,
        },
        {
          label: "Automation",
          href: "/automation",
          icon: Zap,
        },
        {
          label: "Metric Alerts",
          href: "/metric-alerts",
          icon: Bell,
        },
        {
          label: "Ticketing",
          href: "/tickets",
          icon: Ticket,
        },
        {
          label: "VERI FDE",
          href: "/fde",
          icon: Sparkles,
        },
        {
          label: "Capability Registry",
          href: "/capability-registry",
          icon: Database,
        },
        {
          label: "VERI TO DO AI",
          href: "/veri-todo",
          icon: CheckSquare,
        },
        {
          label: "VERI MOM AI",
          href: "/veri-meetings",
          icon: ClipboardList,
        },
        {
          label: "Penalty Tracker",
          href: "/penalties",
          icon: AlertCircle,
        },
        {
          label: "Help Centre",
          href: "/help",
          icon: HelpCircle,
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

function SidebarContent({ overdueCount, docCount, noticeCount, accountType, unreadChatCount, unreadAiCount, pmsEnabled }: { overdueCount: number; docCount: number; noticeCount: number; accountType: string; unreadChatCount: number; unreadAiCount: number; pmsEnabled: boolean }) {
  const pathname = usePathname();
  const sections = getNavSections(overdueCount, docCount, noticeCount, accountType, pmsEnabled);

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 px-5 py-5">
        <Image src="/logo-mark.svg" alt="VERIDIAN AI" width={34} height={34} className="size-[34px]" unoptimized />
        <span className="font-heading text-lg text-ct-navy tracking-tight">
          VERIDIAN AI
        </span>
      </Link>

      {/* Home + VERI Chat Intelligence Engine -- promoted top-level, above
          the collapsible module sections (Wave 13 added Chat; Wave 15
          promotes Home alongside it; Wave 37 splits the single "VERI Chat"
          link into its two sub-modules -- VERI AI (user <-> system) and
          VERI Chat (user <-> people, enterprise Slack/WhatsApp-style) --
          which used to be conflated as one link with the AI thread just
          pinned inside the same list. See PLATFORM_STRATEGY.md §18. */}
      <div className="px-3 mb-2 space-y-0.5">
        <Link
          href="/home"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-colors relative",
            pathname.startsWith("/home")
              ? "bg-ct-accent text-ct-saffron border-l-[3px] border-ct-saffron"
              : "text-ct-navy hover:bg-ct-cloud"
          )}
        >
          <LayoutDashboard className={cn("size-4 shrink-0", pathname.startsWith("/home") && "text-ct-saffron")} />
          <span className="flex-1">Home</span>
        </Link>
        <Link
          href="/veri-ai"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-colors relative",
            pathname.startsWith("/veri-ai")
              ? "bg-ct-accent text-ct-saffron border-l-[3px] border-ct-saffron"
              : "text-ct-navy hover:bg-ct-cloud"
          )}
        >
          <Bot className={cn("size-4 shrink-0", pathname.startsWith("/veri-ai") && "text-ct-saffron")} />
          <span className="flex-1">VERI AI</span>
          {unreadAiCount > 0 && (
            <Badge className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full border-0 bg-ct-saffron text-white flex items-center justify-center">
              {unreadAiCount}
            </Badge>
          )}
        </Link>
        <Link
          href="/chat"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-colors relative",
            pathname.startsWith("/chat")
              ? "bg-ct-accent text-ct-saffron border-l-[3px] border-ct-saffron"
              : "text-ct-navy hover:bg-ct-cloud"
          )}
        >
          <MessageSquare className={cn("size-4 shrink-0", pathname.startsWith("/chat") && "text-ct-saffron")} />
          <span className="flex-1">VERI Chat</span>
          {unreadChatCount > 0 && (
            <Badge className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full border-0 bg-ct-saffron text-white flex items-center justify-center">
              {unreadChatCount}
            </Badge>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {sections.map((section) => (
          <div key={section.title} className="mb-4">
            <p className="px-3 mb-1.5 text-[10px] font-bold tracking-widest text-ct-muted uppercase">
              {section.title}
            </p>
            {section.items.map((item) => {
              const isActive = pathname.startsWith(item.href.split("?")[0]);

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

export function AppSidebar({ overdueCount = 0, docCount = 0, noticeCount = 0, accountType = "company", unreadChatCount = 0, unreadAiCount = 0, pmsEnabled = false }: { overdueCount?: number; docCount?: number; noticeCount?: number; accountType?: string; unreadChatCount?: number; unreadAiCount?: number; pmsEnabled?: boolean }) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-[220px] min-w-[220px] bg-ct-cream border-r border-ct-border h-full">
        <SidebarContent overdueCount={overdueCount} docCount={docCount} noticeCount={noticeCount} accountType={accountType} unreadChatCount={unreadChatCount} unreadAiCount={unreadAiCount} pmsEnabled={pmsEnabled} />
      </aside>

      {/* Mobile sidebar (Sheet) */}
      <div className="lg:hidden">
        <MobileSheetTrigger overdueCount={overdueCount} docCount={docCount} noticeCount={noticeCount} accountType={accountType} unreadChatCount={unreadChatCount} unreadAiCount={unreadAiCount} pmsEnabled={pmsEnabled} />
      </div>
    </>
  );
}

function MobileSheetTrigger({ overdueCount, docCount, noticeCount, accountType, unreadChatCount, unreadAiCount, pmsEnabled }: { overdueCount: number; docCount: number; noticeCount: number; accountType: string; unreadChatCount: number; unreadAiCount: number; pmsEnabled: boolean }) {
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
        <SidebarContent overdueCount={overdueCount} docCount={docCount} noticeCount={noticeCount} accountType={accountType} unreadChatCount={unreadChatCount} unreadAiCount={unreadAiCount} pmsEnabled={pmsEnabled} />
      </SheetContent>
    </Sheet>
  );
}