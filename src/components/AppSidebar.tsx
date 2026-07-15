"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
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
  RefreshCw,
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
  AlertOctagon,
  ServerCrash,
  UserCheck,
  FileWarning,
  Radio,
  FileSignature,
  CheckCircle2,
  Layers,
  BookText,
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
  Fingerprint,
  FlaskConical,
  Gem,
  Wrench,
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

// PLATFORM-01 Wave 2 (Workstream 5, next-intl reference pattern): every
// label below now resolves through `t()` (namespaced to "Nav", messages/
// {locale}.json) instead of a hardcoded English string -- `t` is threaded
// in as a parameter rather than called via a hook here because this is a
// plain function, not a component. Section titles stay keyed to their
// natural-case translated string (e.g. "Overview", not "OVERVIEW") -- the
// visual all-caps look is a CSS `uppercase` transform already applied at
// the render site below, not baked into the string, so translated
// (non-Latin-cased) locales like Hindi aren't force-uppercased.
function getNavSections(t: ReturnType<typeof useTranslations>, overdueCount: number, docCount: number, noticeCount: number, accountType: string, pmsEnabled: boolean, firmEnabled: boolean): NavSection[] {
  return [
    {
      title: t("sections.overview.title"),
      items: [
        {
          label: t("sections.overview.items.pendencyView"),
          href: "/compliance?status=overdue",
          icon: AlertTriangle,
          badge: overdueCount > 0 ? { count: overdueCount, color: "bg-red-500 text-white" } : undefined,
        },
        // Clients view is only meaningful for accounts that serve more than
        // one client (CA firm / legal firm / consultant); a plain 'company'
        // account has one auto-backfilled "Self" client.
        ...(accountType !== "company"
          ? [{ label: t("sections.overview.items.veriCustomersAi"), href: "/clients", icon: Building2 }]
          : []),
      ],
    },
    // Priority 11 (Owner directive 2026-07-13, Reports & Analysis Engine):
    // "add Reports & Analysis as one of the top 5 items" -- promoted from
    // the TOOLS section (was "VERI REPORTS AI", buried well down the
    // sidebar) to its own top-level section, second only to OVERVIEW, so
    // it's genuinely one of the first items a user sees. Renamed to plain
    // "Reports & Analysis" per the Owner's own "user end nomenclature
    // should be the one that user can understand" instruction. Same /reports
    // route and icon as before -- no duplicate nav entry (removed from
    // TOOLS below).
    {
      title: t("sections.reportsAnalysis.title"),
      items: [
        { label: t("sections.reportsAnalysis.items.reportsAnalysis"), href: "/reports", icon: BarChart3 },
      ],
    },
    // VERI Treasure (Wave 113): the 'veri_reward' product branch, free and
    // on-by-default for every org (points/achievements/streaks/referrals)
    // -- shown unconditionally for everyone, same posture as 'office'/'erp'
    // below rather than gated behind an opt-in enablement flag, since this
    // branch has no disable-toggle UI built and defaults to enabled for
    // every org (existing + new) at signup time.
    {
      title: t("sections.rewards.title"),
      items: [
        { label: t("sections.rewards.items.veriTreasure"), href: "/rewards", icon: Gem },
      ],
    },
    // Wave 105 (demo UX feedback #12): CRM was previously hidden for plain
    // 'company' accounts, so a company user never saw it. VERIDIAN AI is a
    // full business system, not a client-firm tool -- every company runs
    // sales/CRM. Now surfaced for everyone as its own department.
    {
      title: t("sections.salesCrm.title"),
      items: [
        { label: t("sections.salesCrm.items.veriCrmAi"), href: "/crm", icon: TrendingUp },
      ],
    },
    // Only shown once an org enables the separate, opt-in VERIDIAN AI PMS
    // product branch (Wave 25) -- absent by default for existing GRC orgs.
    ...(pmsEnabled
      ? [{ title: t("sections.projects.title"), items: [{ label: t("sections.projects.items.veriProjectsAi"), href: "/pms", icon: Rocket }] }]
      : []),
    // THE FIRM AI OS practice-management layer (Wave 108 build, wired to
    // real routes/UI this wave) -- gated behind its own 'the_firm' product
    // branch, same reversible-without-redeploy posture as PMS above.
    ...(firmEnabled
      ? [{
          title: t("sections.theFirm.title"),
          items: [
            { label: t("sections.theFirm.items.practiceCockpit"), href: "/the-firm-practice", icon: Briefcase },
          ],
        }]
      : []),
    // Wave 50 (VERI ERP gap-fill): shown unconditionally for now, matching
    // the GRC modules' own always-visible pattern -- the 'erp' branch has
    // no enablement-toggle UI built yet (that's PMS-only so far), so
    // gating this behind a still-unbuilt erpEnabled flag would just hide
    // real, working pages behind a switch nobody can flip.
    {
      title: t("sections.finance.title"),
      items: [
        { label: t("sections.finance.items.journalEntries"), href: "/erp/journal-entries", icon: FileText },
        { label: t("sections.finance.items.budgeting"), href: "/erp/budgets", icon: Wallet },
        { label: t("sections.finance.items.financialReports"), href: "/erp/reports", icon: TrendingUp },
        { label: t("sections.finance.items.cashManagement"), href: "/erp/cash-management", icon: Banknote },
        { label: t("sections.finance.items.creditNotes"), href: "/erp/credit-notes", icon: FileMinus },
        { label: t("sections.finance.items.inventory"), href: "/erp/inventory", icon: Database },
        { label: t("sections.finance.items.bankReconciliation"), href: "/erp/bank-reconciliation", icon: ArrowRightLeft },
        { label: t("sections.finance.items.gstReconciliation"), href: "/gst-reconciliation", icon: FileCheck },
        { label: t("sections.finance.items.tdsReturns"), href: "/tds-returns", icon: FileCheck },
        { label: t("sections.finance.items.procurementWorkflow"), href: "/erp/procurement", icon: ClipboardList },
        { label: t("sections.finance.items.goodsReceipt"), href: "/erp/goods-receipt", icon: Database },
        { label: t("sections.finance.items.inventoryPlanning"), href: "/erp/inventory-planning", icon: RefreshCw },
        { label: t("sections.finance.items.statutoryPayroll"), href: "/erp/payroll", icon: IndianRupee },
        { label: t("sections.finance.items.invoicing"), href: "/erp/invoicing", icon: Receipt },
        { label: t("sections.finance.items.returnsRma"), href: "/erp/returns", icon: Undo2 },
        { label: t("sections.finance.items.contracts"), href: "/erp/contracts", icon: FileSignature },
        { label: t("sections.finance.items.clauseLibrary"), href: "/erp/clm-library", icon: BookText },
        { label: t("sections.finance.items.customers"), href: "/erp/customers", icon: Users },
        { label: t("sections.finance.items.suppliers"), href: "/erp/suppliers", icon: Building2 },
        { label: t("sections.finance.items.masterDataQuality"), href: "/mdm-quality", icon: Fingerprint },
      ],
    },
    {
      title: t("sections.compliance.title"),
      items: [
        {
          label: t("sections.compliance.items.register"),
          href: "/compliance",
          icon: ClipboardList,
        },
        {
          label: t("sections.compliance.items.notices"),
          href: "/notices",
          icon: Bell,
          badge: noticeCount > 0 ? { count: noticeCount, color: "bg-amber-500 text-white" } : undefined,
        },
        {
          label: t("sections.compliance.items.auditPoints"),
          href: "/compliance?status=in_progress",
          icon: FileCheck,
        },
        {
          label: t("sections.compliance.items.documents"),
          href: "/compliance",
          icon: FileText,
          badge: docCount > 0 ? { count: docCount, color: "bg-amber-500 text-white" } : undefined,
        },
        {
          label: t("sections.compliance.items.bulkImport"),
          href: "/compliance",
          icon: Upload,
        },
      ],
    },
    {
      title: t("sections.governance.title"),
      items: [
        { label: t("sections.governance.items.boardGovernance"), href: "/board", icon: Gavel },
        { label: t("sections.governance.items.committees"), href: "/committees", icon: Users },
        { label: t("sections.governance.items.relatedPartyTransactions"), href: "/rpt", icon: ShieldAlert },
        { label: t("sections.governance.items.delegationOfAuthority"), href: "/doa", icon: Layers },
        { label: t("sections.governance.items.directorKmpRegister"), href: "/directors", icon: BookOpen },
        { label: t("sections.governance.items.boardDirectorEvaluation"), href: "/board-evaluation", icon: CheckCircle2 },
        { label: t("sections.governance.items.policyManagement"), href: "/policies", icon: FileText },
      ],
    },
    {
      title: t("sections.companySecretarial.title"),
      items: [
        { label: t("sections.companySecretarial.items.statutoryRegisters"), href: "/statutory-registers", icon: BookOpen },
        { label: t("sections.companySecretarial.items.shareCapitalCapTable"), href: "/cap-table", icon: Wallet },
        { label: t("sections.companySecretarial.items.chargesRoc"), href: "/charges", icon: Link2 },
        { label: t("sections.companySecretarial.items.secretarialAudit"), href: "/secretarial-audit", icon: ShieldCheck },
        { label: t("sections.companySecretarial.items.mcaEFiling"), href: "/mca-filings", icon: FileSignature },
      ],
    },
    {
      title: t("sections.legal.title"),
      items: [
        { label: t("sections.legal.items.legalMatters"), href: "/legal-matters", icon: Scale },
        { label: t("sections.legal.items.externalCounselVendors"), href: "/legal-vendors", icon: Scale },
        { label: t("sections.legal.items.litigationDisputes"), href: "/litigation", icon: Gavel },
        { label: t("sections.legal.items.ipPortfolio"), href: "/ip-portfolio", icon: BookOpen },
        { label: t("sections.legal.items.legalOpinions"), href: "/legal-opinions", icon: FileText },
      ],
    },
    {
      title: t("sections.peopleHr.title"),
      items: [
        { label: t("sections.peopleHr.items.payrollHrCompliance"), href: "/hr-compliance", icon: Briefcase },
        { label: t("sections.peopleHr.items.leaveHolidayCompliance"), href: "/leave-holiday", icon: CheckSquare },
        { label: t("sections.peopleHr.items.poshCompliance"), href: "/posh", icon: UserCheck },
        { label: t("sections.peopleHr.items.veriHrAi"), href: "/hr", icon: Users },
        { label: t("sections.peopleHr.items.recruitment"), href: "/recruitment", icon: UserPlus },
        { label: t("sections.peopleHr.items.performanceReviews"), href: "/performance-reviews", icon: ClipboardCheck },
      ],
    },
    {
      title: t("sections.risk.title"),
      items: [{ label: t("sections.risk.items.riskRegister"), href: "/risks", icon: ShieldAlert }],
    },
    {
      title: t("sections.sectorRegulators.title"),
      items: [
        { label: t("sections.sectorRegulators.items.sebi"), href: "/sebi", icon: Landmark },
        { label: t("sections.sectorRegulators.items.rbi"), href: "/rbi", icon: Landmark },
        { label: t("sections.sectorRegulators.items.irdai"), href: "/irdai", icon: Landmark },
      ],
    },
    {
      title: t("sections.audit.title"),
      items: [
        { label: t("sections.audit.items.controlsFrameworkLibrary"), href: "/frameworks", icon: ShieldCheck },
        { label: t("sections.audit.items.auditManagement"), href: "/audit-engagements", icon: ClipboardList },
        { label: t("sections.audit.items.auditTrail"), href: "/audit", icon: History },
      ],
    },
    {
      title: t("sections.thirdPartyEsg.title"),
      items: [
        { label: t("sections.thirdPartyEsg.items.vendorThirdPartyRisk"), href: "/vendor-risk", icon: ShieldAlert },
        { label: t("sections.thirdPartyEsg.items.esgSustainability"), href: "/esg", icon: Leaf },
      ],
    },
    {
      title: t("sections.integrity.title"),
      items: [
        { label: t("sections.integrity.items.whistleblowerEthics"), href: "/whistleblower", icon: FileWarning },
        { label: t("sections.integrity.items.businessContinuity"), href: "/bcm", icon: Radio },
        { label: t("sections.integrity.items.itDisasterRecovery"), href: "/it-dr", icon: ServerCrash },
        { label: t("sections.integrity.items.fraudCaseManagement"), href: "/fraud-cases", icon: AlertOctagon },
        { label: t("sections.integrity.items.contractCompliance"), href: "/contract-compliance", icon: FileSignature },
      ],
    },
    {
      title: t("sections.incidentsEvents.title"),
      items: [{ label: t("sections.incidentsEvents.items.incidentManagement"), href: "/incidents", icon: Siren }],
    },
    {
      title: t("sections.accessApprovals.title"),
      items: [{ label: t("sections.accessApprovals.items.approvalQueue"), href: "/approvals", icon: CheckCircle2 }],
    },
    {
      title: t("sections.admin.title"),
      items: [
        {
          label: t("sections.admin.items.users"),
          href: "/users",
          icon: Users,
        },
        {
          label: t("sections.admin.items.departments"),
          href: "/departments",
          icon: Building2,
        },
        {
          label: t("sections.admin.items.accessReview"),
          href: "/access-review",
          icon: ClipboardCheck,
        },
        {
          label: t("sections.admin.items.settings"),
          href: "/settings",
          icon: Settings,
        },
        {
          label: t("sections.admin.items.auditLog"),
          href: "/audit",
          icon: History,
        },
      ],
    },
    {
      title: t("sections.tools.title"),
      items: [
        {
          label: t("sections.tools.items.veriOperationsAi"),
          href: "/orchestra",
          icon: Bot,
        },
        {
          label: t("sections.tools.items.promptEvalLab"),
          href: "/prompt-eval",
          icon: FlaskConical,
        },
        {
          label: t("sections.tools.items.salesHq"),
          href: "/sales-hq",
          icon: Users,
        },
        {
          label: t("sections.tools.items.capabilityImprovements"),
          href: "/capability-improvements",
          icon: Wrench,
        },
        {
          label: t("sections.tools.items.checklists"),
          href: "/checklists",
          icon: CheckSquare,
        },
        {
          label: t("sections.tools.items.tasks"),
          href: "/tasks",
          icon: ListTodo,
        },
        {
          label: t("sections.tools.items.documents"),
          href: "/documents",
          icon: FolderOpen,
        },
        // "VERI REPORTS AI" -> /reports moved to its own top-level
        // "REPORTS & ANALYSIS" section (Priority 11) -- removed here to
        // avoid a duplicate nav entry pointing at the same route.
        {
          label: t("sections.tools.items.enterpriseKpiHub"),
          href: "/kpi-hub",
          icon: LayoutDashboard,
        },
        {
          label: t("sections.tools.items.knowledgeBase"),
          href: "/knowledge-base",
          icon: BookOpen,
        },
        {
          label: t("sections.tools.items.automation"),
          href: "/automation",
          icon: Zap,
        },
        {
          label: t("sections.tools.items.metricAlerts"),
          href: "/metric-alerts",
          icon: Bell,
        },
        {
          label: t("sections.tools.items.ticketing"),
          href: "/tickets",
          icon: Ticket,
        },
        {
          label: t("sections.tools.items.capabilityRegistry"),
          href: "/capability-registry",
          icon: Database,
        },
        {
          label: t("sections.tools.items.veriTodoAi"),
          href: "/veri-todo",
          icon: CheckSquare,
        },
        {
          label: t("sections.tools.items.veriMomAi"),
          href: "/veri-meetings",
          icon: ClipboardList,
        },
        {
          label: t("sections.tools.items.penaltyTracker"),
          href: "/penalties",
          icon: AlertCircle,
        },
        {
          label: t("sections.tools.items.helpCentre"),
          href: "/help",
          icon: HelpCircle,
        },
        {
          label: t("sections.tools.items.team"),
          href: "/team",
          icon: Users,
        },
      ],
    },
  ];
}

function SidebarContent({ overdueCount, docCount, noticeCount, accountType, unreadChatCount, unreadAiCount, connectedConnectorsCount, pmsEnabled, firmEnabled, orgName }: { overdueCount: number; docCount: number; noticeCount: number; accountType: string; unreadChatCount: number; unreadAiCount: number; connectedConnectorsCount: number; pmsEnabled: boolean; firmEnabled: boolean; orgName: string }) {
  const pathname = usePathname();
  const t = useTranslations("Nav");
  const sections = getNavSections(t, overdueCount, docCount, noticeCount, accountType, pmsEnabled, firmEnabled);

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
      {/* Wave 105 (demo feedback): Home is now the assistant-first screen
          (formerly "Home 2"); the old tabbed workspace became Dashboard
          (opens on Analytics). VERI AI's standalone page is retired for
          users -- the assistant lives on Home -- so its unread count now
          badges Home. VERI FDE, renamed "Do It For Me" in plain language,
          is promoted here. Order: Home, Dashboard, VERI Chat, Do It For Me. */}
      <div className="px-3 mb-2 space-y-0.5">
        <Link
          href="/home"
          className={cn(
            "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors relative",
            pathname === "/home"
              ? "bg-ct-accent text-ct-saffron border-l-[3px] border-ct-saffron"
              : "text-ct-navy hover:bg-ct-cloud"
          )}
        >
          <Sparkles className={cn("size-3.5 shrink-0", pathname === "/home" ? "text-ct-saffron" : "text-ct-saffron/70")} />
          <span className="flex-1">{t("top.home")}</span>
          {unreadAiCount > 0 && (
            <Badge className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full border-0 bg-ct-saffron text-white flex items-center justify-center">
              {unreadAiCount}
            </Badge>
          )}
        </Link>
        <Link
          href="/dashboard"
          className={cn(
            "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors relative",
            pathname.startsWith("/dashboard")
              ? "bg-ct-accent text-ct-saffron border-l-[3px] border-ct-saffron"
              : "text-ct-navy hover:bg-ct-cloud"
          )}
        >
          <LayoutDashboard className={cn("size-3.5 shrink-0", pathname.startsWith("/dashboard") && "text-ct-saffron")} />
          <span className="flex-1">{t("top.dashboard")}</span>
        </Link>
        <Link
          href="/chat"
          className={cn(
            "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors relative",
            pathname.startsWith("/chat")
              ? "bg-ct-accent text-ct-saffron border-l-[3px] border-ct-saffron"
              : "text-ct-navy hover:bg-ct-cloud"
          )}
        >
          <MessageSquare className={cn("size-3.5 shrink-0", pathname.startsWith("/chat") && "text-ct-saffron")} />
          <span className="flex-1">{t("top.chat")}</span>
          {unreadChatCount > 0 && (
            <Badge className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full border-0 bg-ct-saffron text-white flex items-center justify-center">
              {unreadChatCount}
            </Badge>
          )}
        </Link>
        {/* Connectors (Connectors.docx wave, 2026-07-10): promoted from a
            buried ADMIN-section link ("VERI CONNECT") to a top-level entry so
            users can actually discover VERI Connect exists -- mirrors why
            Home/Dashboard/VERI Chat are promoted here instead of living in a
            collapsible section. */}
        <Link
          href="/connectors"
          className={cn(
            "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors relative",
            pathname.startsWith("/connectors")
              ? "bg-ct-accent text-ct-saffron border-l-[3px] border-ct-saffron"
              : "text-ct-navy hover:bg-ct-cloud"
          )}
        >
          <Link2 className={cn("size-3.5 shrink-0", pathname.startsWith("/connectors") && "text-ct-saffron")} />
          <span className="flex-1">{t("top.connectors")}</span>
          {connectedConnectorsCount > 0 && (
            <Badge className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full border-0 bg-ct-saffron text-white flex items-center justify-center">
              {connectedConnectorsCount}
            </Badge>
          )}
        </Link>
        <Link
          href="/fde"
          className={cn(
            "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors relative",
            pathname.startsWith("/fde")
              ? "bg-ct-accent text-ct-saffron border-l-[3px] border-ct-saffron"
              : "text-ct-navy hover:bg-ct-cloud"
          )}
        >
          <Rocket className={cn("size-3.5 shrink-0", pathname.startsWith("/fde") && "text-ct-saffron")} />
          <span className="flex-1">{t("top.agents")}</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {sections.map((section) => (
          <div key={section.title} className="mb-3">
            <p className="px-3 mb-1 text-[9px] font-bold tracking-widest text-ct-muted uppercase">
              {section.title}
            </p>
            {section.items.map((item) => {
              const isActive = pathname.startsWith(item.href.split("?")[0]);

              return (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors mb-0.5 relative",
                    isActive
                      ? "bg-ct-accent text-ct-saffron font-semibold border-l-[3px] border-ct-saffron"
                      : "text-ct-slate hover:bg-ct-cloud"
                  )}
                >
                  <item.icon className={cn("size-3.5 shrink-0", isActive && "text-ct-saffron")} />
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

      {/* Bottom org info -- the signed-in organisation's real name (was a
          hardcoded "Acme Financial Services" placeholder every tenant saw). */}
      <div className="px-5 py-4 border-t border-ct-border flex items-center justify-between gap-2"><div className="min-w-0">
        <p className="text-xs text-ct-muted truncate">{orgName || " "}</p>
        <p className="text-[10px] text-ct-muted/60">{t("poweredBy")}</p></div><LanguageSwitcher />
      </div>
    </div>
  );
}

export function AppSidebar({ overdueCount = 0, docCount = 0, noticeCount = 0, accountType = "company", unreadChatCount = 0, unreadAiCount = 0, connectedConnectorsCount = 0, pmsEnabled = false, firmEnabled = false, orgName = "" }: { overdueCount?: number; docCount?: number; noticeCount?: number; accountType?: string; unreadChatCount?: number; unreadAiCount?: number; connectedConnectorsCount?: number; pmsEnabled?: boolean; firmEnabled?: boolean; orgName?: string }) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-[220px] min-w-[220px] bg-ct-cream border-r border-ct-border h-full">
        <SidebarContent overdueCount={overdueCount} docCount={docCount} noticeCount={noticeCount} accountType={accountType} unreadChatCount={unreadChatCount} unreadAiCount={unreadAiCount} connectedConnectorsCount={connectedConnectorsCount} pmsEnabled={pmsEnabled} firmEnabled={firmEnabled} orgName={orgName} />
      </aside>

      {/* Mobile sidebar (Sheet) */}
      <div className="lg:hidden">
        <MobileSheetTrigger overdueCount={overdueCount} docCount={docCount} noticeCount={noticeCount} accountType={accountType} unreadChatCount={unreadChatCount} unreadAiCount={unreadAiCount} connectedConnectorsCount={connectedConnectorsCount} pmsEnabled={pmsEnabled} firmEnabled={firmEnabled} orgName={orgName} />
      </div>
    </>
  );
}

function MobileSheetTrigger({ overdueCount, docCount, noticeCount, accountType, unreadChatCount, unreadAiCount, connectedConnectorsCount, pmsEnabled, firmEnabled, orgName }: { overdueCount: number; docCount: number; noticeCount: number; accountType: string; unreadChatCount: number; unreadAiCount: number; connectedConnectorsCount: number; pmsEnabled: boolean; firmEnabled: boolean; orgName: string }) {
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
        <SidebarContent overdueCount={overdueCount} docCount={docCount} noticeCount={noticeCount} accountType={accountType} unreadChatCount={unreadChatCount} unreadAiCount={unreadAiCount} connectedConnectorsCount={connectedConnectorsCount} pmsEnabled={pmsEnabled} firmEnabled={firmEnabled} orgName={orgName} />
      </SheetContent>
    </Sheet>
  );
}