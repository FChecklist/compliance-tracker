"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppSidebar as SharedAppSidebar, type NavItem as SharedNavItem, type NavSection as SharedNavSection } from "@fchecklist/veridian-ui-kit/shell";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  LayoutDashboard,
  Mic,
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
  Boxes,
  CalendarCheck,
  GraduationCap,
  Copy,
  Activity,
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
        // VERIDIAN Review Framework Wave B (2026-07-17): the new crm_accounts/
        // crm_contacts surface -- company-level account records with a
        // contacts roster underneath, sibling to the existing Leads/
        // Opportunities tabs on /crm.
        { label: t("sections.salesCrm.items.accounts"), href: "/crm/accounts", icon: Building2 },
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
        { label: t("sections.finance.items.paymentEntries"), href: "/erp/payment-entries", icon: Banknote },
        { label: t("sections.finance.items.fixedAssets"), href: "/erp/fixed-assets", icon: Boxes },
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
        { label: t("sections.peopleHr.items.attendance"), href: "/hr/attendance", icon: CalendarCheck },
        { label: t("sections.peopleHr.items.training"), href: "/training", icon: GraduationCap },
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
          label: t("sections.tools.items.aiObservability"),
          href: "/ai-observability",
          icon: Activity,
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
          label: t("sections.tools.items.taskDuplicates"),
          href: "/task-duplicates",
          icon: Copy,
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
          label: t("sections.tools.items.voiceTickets"),
          href: "/voice-tickets",
          icon: Mic,
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


// veridian-ui-kit migration (2026-07-19): the shared AppSidebar component
// owns only the generic nav-sections shell/style (logo row + scrollable
// section list, per its own README scope boundary) -- this repo's real nav
// DATA (top-pinned Home/Dashboard/Chat/Connectors/FDE links, all module
// sections, badges) is built here and passed in as plain props, converted
// to the shared component's NavItem/NavSection shape. The top-pinned links
// (previously their own distinctly-styled block above the module sections)
// are folded into an unlabeled first section -- the shared component's
// `.veri-nav-item.active` style (solid navy background, ported verbatim
// from the mockup) replaces the old bg-ct-accent/border-l-saffron treatment
// for every nav item; this is the same class of mockup-alignment correction
// as AppShellFrame's home-merge fix, not an accidental restyle.
//
// Disclosed, confirmed tradeoffs of this swap (none of them break
// navigation/data -- all are visual/convenience only):
// - Active-state highlighting: the shared component computes `active` via
//   `pathname === href || pathname.startsWith(href + "/")`, with no
//   query-string awareness. A few items route via query string (e.g.
//   "/compliance?status=overdue") -- those links still navigate correctly,
//   they just won't visually highlight as active while on that exact view.
// - The BYOB white-label logo row's border-bottom accent line has no
//   equivalent slot in the shared component's fixed logo-row template; the
//   logo image itself stays real-org-aware (falls back to the default mark)
//   and is wrapped in a Link to "/" for click-to-home, just without the
//   accent underline.
// - The org-name/language-switcher footer has no footer slot in the shared
//   component's template (a single overflow-y-auto region covers header+nav
//   together, no separate pinned-footer scroll region) -- kept as this
//   repo's own sibling below the shared component instead of inside it.
function toSharedItem(href: string, label: string, icon: React.ElementType, badge?: { count: number; color: string }): SharedNavItem {
  return {
    href,
    label,
    icon: <SidebarIcon icon={icon} />,
    badge: badge ? <CountBadge count={badge.count} color={badge.color} /> : undefined,
  };
}

function SidebarIcon({ icon: Icon }: { icon: React.ElementType }) {
  return <Icon className="size-3.5 shrink-0" />;
}

function CountBadge({ count, color = "bg-ct-saffron text-white" }: { count: number; color?: string }) {
  return (
    <Badge className={cn("h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full border-0 flex items-center justify-center", color)}>
      {count}
    </Badge>
  );
}

function buildSharedSections(
  t: ReturnType<typeof useTranslations>,
  overdueCount: number, docCount: number, noticeCount: number, accountType: string,
  unreadChatCount: number, unreadAiCount: number, connectedConnectorsCount: number,
  pmsEnabled: boolean, firmEnabled: boolean
): SharedNavSection[] {
  const topPinned: SharedNavSection = {
    items: [
      toSharedItem("/home", t("top.home"), Sparkles, unreadAiCount > 0 ? { count: unreadAiCount, color: "bg-ct-saffron text-white" } : undefined),
      toSharedItem("/dashboard", t("top.dashboard"), LayoutDashboard),
      toSharedItem("/chat", t("top.chat"), MessageSquare, unreadChatCount > 0 ? { count: unreadChatCount, color: "bg-ct-saffron text-white" } : undefined),
      toSharedItem("/connectors", t("top.connectors"), Link2, connectedConnectorsCount > 0 ? { count: connectedConnectorsCount, color: "bg-ct-saffron text-white" } : undefined),
      toSharedItem("/fde", t("top.agents"), Rocket),
    ],
  };

  const moduleSections = getNavSections(t, overdueCount, docCount, noticeCount, accountType, pmsEnabled, firmEnabled).map(
    (section): SharedNavSection => ({
      label: section.title,
      items: section.items.map((item) => toSharedItem(item.href, item.label, item.icon, item.badge)),
    })
  );

  return [topPinned, ...moduleSections];
}

function AppSidebarFooter({ orgName }: { orgName: string }) {
  const t = useTranslations("Nav");
  return (
    <div className="px-5 py-3 border-t border-ct-border flex items-center justify-between gap-2 shrink-0">
      <div className="min-w-0">
        <p className="text-xs text-ct-muted truncate">{orgName || " "}</p>
        <p className="text-[10px] text-ct-muted/60">{t("poweredBy")}</p>
      </div>
      <LanguageSwitcher />
    </div>
  );
}

function SidebarInner({ overdueCount, docCount, noticeCount, accountType, unreadChatCount, unreadAiCount, connectedConnectorsCount, pmsEnabled, firmEnabled, orgName, orgLogoUrl, brandName }: { overdueCount: number; docCount: number; noticeCount: number; accountType: string; unreadChatCount: number; unreadAiCount: number; connectedConnectorsCount: number; pmsEnabled: boolean; firmEnabled: boolean; orgName: string; orgLogoUrl?: string | null; brandName?: string }) {
  const t = useTranslations("Nav");
  const sections = buildSharedSections(t, overdueCount, docCount, noticeCount, accountType, unreadChatCount, unreadAiCount, connectedConnectorsCount, pmsEnabled, firmEnabled);

  const logo = (
    <Link href="/" title="VERIDIAN AI" className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-sm">
      <Image
        src={orgLogoUrl || "/logo-mark.svg"}
        alt={orgLogoUrl ? `${orgName || "Organisation"} logo` : "VERIDIAN AI"}
        width={28}
        height={28}
        className="size-7 rounded-sm object-contain"
        unoptimized
      />
    </Link>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 flex">
        <SharedAppSidebar
          sections={sections}
          logo={logo}
          productName={orgLogoUrl && orgName ? orgName : (brandName || "VERIDIAN AI")}
          collapsed={false}
        />
      </div>
      <AppSidebarFooter orgName={orgName} />
    </div>
  );
}

export function AppSidebar({ overdueCount = 0, docCount = 0, noticeCount = 0, accountType = "company", unreadChatCount = 0, unreadAiCount = 0, connectedConnectorsCount = 0, pmsEnabled = false, firmEnabled = false, orgName = "", orgLogoUrl = null, brandName = "" }: { overdueCount?: number; docCount?: number; noticeCount?: number; accountType?: string; unreadChatCount?: number; unreadAiCount?: number; connectedConnectorsCount?: number; pmsEnabled?: boolean; firmEnabled?: boolean; orgName?: string; orgLogoUrl?: string | null; brandName?: string }) {
  const props = { overdueCount, docCount, noticeCount, accountType, unreadChatCount, unreadAiCount, connectedConnectorsCount, pmsEnabled, firmEnabled, orgName, orgLogoUrl, brandName };
  return (
    <>
      {/* Desktop sidebar -- wrapping the shared component (rather than
          giving it its own `hidden lg:flex` internally, which it doesn't
          expose) lets it stay a plain, non-responsive component reusable by
          any consumer, while this repo's own responsive behavior stays
          here. */}
      <div className="hidden lg:flex lg:h-full">
        <SidebarInner {...props} />
      </div>

      {/* Mobile sidebar (Sheet) */}
      <div className="lg:hidden">
        <MobileSheetTrigger {...props} />
      </div>
    </>
  );
}

function MobileSheetTrigger(props: { overdueCount: number; docCount: number; noticeCount: number; accountType: string; unreadChatCount: number; unreadAiCount: number; connectedConnectorsCount: number; pmsEnabled: boolean; firmEnabled: boolean; orgName: string; orgLogoUrl?: string | null; brandName?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-ct-slate hover:bg-ct-cloud hover:text-ct-navy"
        >
          <LayoutDashboard className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[260px] p-0 bg-ct-cream">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <div className="h-full flex">
          <SidebarInner {...props} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
