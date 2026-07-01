// Preview data for the VERIDIAN AI Orchestra dashboard (src/app/(app)/orchestra).
//
// This is the same worker-agent taxonomy captured in orchestra_changes.md as the
// canonical Wave 3 seed reference (33 global + firm/client/user tier examples).
// None of this is backed by a real table yet -- worker_agents, ai_assistants, and
// tasks land in Waves 2-4. This module exists so the preview page and the real
// implementation share one source of truth for the example content, rather than
// the mock data drifting from what actually gets seeded later.

export type AgentTier = "global" | "firm" | "client" | "user";

export type WorkerAgent = {
  id: string;
  name: string;
  tier: AgentTier;
  domain: string;
  usageCount: number;
  accuracy: number;
};

export const TIER_LABEL: Record<AgentTier, string> = {
  global: "Global",
  firm: "Firm",
  client: "Client",
  user: "User",
};

// Tailwind color family used per tier, following the same plain-palette + dark:
// variant convention already used in components/ui/status-badge.tsx.
export const TIER_COLOR: Record<AgentTier, { bg: string; text: string; border: string; dot: string }> = {
  global: {
    bg: "bg-teal-50 dark:bg-teal-900/30",
    text: "text-teal-700 dark:text-teal-300",
    border: "border-teal-200 dark:border-teal-800",
    dot: "bg-teal-500",
  },
  firm: {
    bg: "bg-indigo-50 dark:bg-indigo-900/30",
    text: "text-indigo-700 dark:text-indigo-300",
    border: "border-indigo-200 dark:border-indigo-800",
    dot: "bg-indigo-500",
  },
  client: {
    bg: "bg-amber-50 dark:bg-amber-900/30",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-200 dark:border-amber-800",
    dot: "bg-amber-500",
  },
  user: {
    bg: "bg-slate-100 dark:bg-slate-800/40",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-200 dark:border-slate-700",
    dot: "bg-slate-500",
  },
};

export const WORKER_AGENTS: WorkerAgent[] = [
  // GLOBAL TIER -- immutable, owned by VERIDIAN, shared across every firm
  { id: "g-tds-calc", name: "TDS Calculation", tier: "global", domain: "India Tax > Direct Tax", usageCount: 14520, accuracy: 99.2 },
  { id: "g-tds-file", name: "TDS Return Filing", tier: "global", domain: "India Tax > Direct Tax", usageCount: 8930, accuracy: 98.7 },
  { id: "g-tds-form", name: "TDS Form Generation", tier: "global", domain: "India Tax > Direct Tax", usageCount: 7210, accuracy: 99.5 },
  { id: "g-adv-tax", name: "Advance Tax Scheduler", tier: "global", domain: "India Tax > Direct Tax", usageCount: 5430, accuracy: 97.8 },
  { id: "g-itc", name: "ITC Reconciliation", tier: "global", domain: "India Tax > Indirect Tax", usageCount: 12800, accuracy: 98.1 },
  { id: "g-gstr1", name: "GSTR-1 Filing", tier: "global", domain: "India Tax > Indirect Tax", usageCount: 11200, accuracy: 99.0 },
  { id: "g-gstr3b", name: "GSTR-3B Filing", tier: "global", domain: "India Tax > Indirect Tax", usageCount: 11800, accuracy: 99.3 },
  { id: "g-eway", name: "E-Way Bill Manager", tier: "global", domain: "India Tax > Indirect Tax", usageCount: 6500, accuracy: 97.5 },
  { id: "g-einv", name: "E-Invoice Compliance", tier: "global", domain: "India Tax > Indirect Tax", usageCount: 5800, accuracy: 98.9 },
  { id: "g-itr", name: "ITR Filing (1-7)", tier: "global", domain: "India Tax > Direct Tax", usageCount: 9200, accuracy: 97.2 },
  { id: "g-audit", name: "Tax Audit Report", tier: "global", domain: "India Tax > Direct Tax", usageCount: 4300, accuracy: 96.8 },
  { id: "g-roc-aoc", name: "AOC-4 Filing", tier: "global", domain: "India Compliance > ROC", usageCount: 6700, accuracy: 99.1 },
  { id: "g-roc-mgt", name: "MGT-7 Filing", tier: "global", domain: "India Compliance > ROC", usageCount: 5900, accuracy: 98.5 },
  { id: "g-din", name: "DIN/DSC Manager", tier: "global", domain: "India Compliance > ROC", usageCount: 3200, accuracy: 99.8 },
  { id: "g-pf-esi", name: "PF/ESI Filing", tier: "global", domain: "India Compliance > Labour", usageCount: 4800, accuracy: 98.0 },
  { id: "g-proftax", name: "Professional Tax", tier: "global", domain: "India Compliance > Labour", usageCount: 3900, accuracy: 99.6 },
  { id: "g-cal", name: "Compliance Calendar", tier: "global", domain: "India Compliance", usageCount: 18200, accuracy: 99.9 },
  { id: "g-penalty", name: "Penalty Calculator", tier: "global", domain: "India Compliance", usageCount: 4100, accuracy: 99.4 },
  { id: "g-journal", name: "Journal Entry Bot", tier: "global", domain: "Accounting", usageCount: 15600, accuracy: 98.3 },
  { id: "g-bankrec", name: "Bank Reconciliation", tier: "global", domain: "Accounting", usageCount: 13400, accuracy: 97.9 },
  { id: "g-interco", name: "Inter-company Rec", tier: "global", domain: "Accounting", usageCount: 5200, accuracy: 96.5 },
  { id: "g-fixed", name: "Fixed Asset Accounting", tier: "global", domain: "Accounting", usageCount: 4700, accuracy: 98.2 },
  { id: "g-finstmt", name: "Financial Statements", tier: "global", domain: "Accounting", usageCount: 8900, accuracy: 97.1 },
  { id: "g-internal-audit", name: "Internal Audit Plan", tier: "global", domain: "Audit", usageCount: 3100, accuracy: 95.8 },
  { id: "g-risk", name: "Risk Assessment", tier: "global", domain: "Audit", usageCount: 3800, accuracy: 94.5 },
  { id: "g-control", name: "Control Testing", tier: "global", domain: "Audit", usageCount: 3500, accuracy: 96.2 },
  { id: "g-sample", name: "Sample Selector", tier: "global", domain: "Audit", usageCount: 2900, accuracy: 97.7 },
  { id: "g-cash", name: "Cash Position Mgmt", tier: "global", domain: "Treasury", usageCount: 7200, accuracy: 98.6 },
  { id: "g-forecast", name: "Cash Flow Forecast", tier: "global", domain: "Treasury", usageCount: 5100, accuracy: 94.2 },
  { id: "g-fx", name: "FX Exposure Manager", tier: "global", domain: "Treasury", usageCount: 3400, accuracy: 93.8 },
  { id: "g-ocr", name: "Document Parser", tier: "global", domain: "Cross-Cutting", usageCount: 22100, accuracy: 96.5 },
  { id: "g-anomaly", name: "Anomaly Detector", tier: "global", domain: "Cross-Cutting", usageCount: 8400, accuracy: 93.1 },
  { id: "g-report", name: "Report Generator", tier: "global", domain: "Cross-Cutting", usageCount: 19300, accuracy: 97.8 },

  // FIRM TIER -- shared across every user in one customer account, auto-generated from patterns
  { id: "f-close-wf", name: "Month-End Close WF", tier: "firm", domain: "Shah & Co > Processes", usageCount: 340, accuracy: 97.5 },
  { id: "f-tds-review", name: "TDS Review Checklist", tier: "firm", domain: "Shah & Co > Processes", usageCount: 280, accuracy: 98.2 },
  { id: "f-onboard", name: "Client Onboarding", tier: "firm", domain: "Shah & Co > Processes", usageCount: 45, accuracy: 96.0 },
  { id: "f-templates", name: "Communication Templates", tier: "firm", domain: "Shah & Co > Standards", usageCount: 1200, accuracy: 99.1 },
  { id: "f-approval", name: "Approval Chain Config", tier: "firm", domain: "Shah & Co > Policies", usageCount: 890, accuracy: 99.8 },
  { id: "f-manufact-itc", name: "Manufacturing ITC Rules", tier: "firm", domain: "Shah & Co > Domain", usageCount: 210, accuracy: 97.3 },

  // CLIENT TIER -- specific to one client entity the firm services
  { id: "c-abc-gst", name: "ABC Corp GST Pattern", tier: "client", domain: "ABC Corp > GST", usageCount: 78, accuracy: 99.5 },
  { id: "c-abc-tds", name: "ABC Corp TDS Exceptions", tier: "client", domain: "ABC Corp > TDS", usageCount: 52, accuracy: 100 },
  { id: "c-abc-approvals", name: "ABC Corp Approval Chain", tier: "client", domain: "ABC Corp > Policy", usageCount: 34, accuracy: 100 },
  { id: "c-def-bank", name: "DEF Inc Bank Pattern", tier: "client", domain: "DEF Inc > Banking", usageCount: 41, accuracy: 98.0 },
  { id: "c-ghi-risk", name: "GHI Holdings Risk Profile", tier: "client", domain: "GHI Holdings > Risk", usageCount: 28, accuracy: 95.5 },

  // USER TIER -- personal to one person, most private layer
  { id: "u-rahul-priority", name: "Task Priority", tier: "user", domain: "Personal > Behavior", usageCount: 245, accuracy: 92.0 },
  { id: "u-rahul-style", name: "Review Style", tier: "user", domain: "Personal > Preference", usageCount: 198, accuracy: 94.5 },
  { id: "u-rahul-hours", name: "Active Hours", tier: "user", domain: "Personal > Pattern", usageCount: 312, accuracy: 99.0 },
];

export const agentById = (id: string): WorkerAgent | undefined =>
  WORKER_AGENTS.find((a) => a.id === id);

export type TaskStatus = "pending" | "in_progress" | "completed" | "submitted";

export type OrchestraTask = {
  id: string;
  title: string;
  client: string;
  status: TaskStatus;
};

export type ChatMessage = {
  id: string;
  from: "assistant" | "system" | "learning";
  text: string;
};

export type OrchestraAssistant = {
  id: string;
  label: string;
  color: "teal" | "amber" | "rose" | "cyan" | "lime";
  status: "working" | "idle";
  agentIds: string[];
  metrics: { label: string; value: string; trend: "up" | "down" | "neutral" }[];
  tasks: OrchestraTask[];
  chat: ChatMessage[];
};

export const ASSISTANTS: OrchestraAssistant[] = [
  {
    id: "a1",
    label: "Assistant 1",
    color: "teal",
    status: "working",
    agentIds: ["g-tds-calc", "g-tds-file", "f-tds-review", "c-abc-tds", "u-rahul-priority"],
    metrics: [
      { label: "Deadlines", value: "3 upcoming", trend: "neutral" },
      { label: "Tax Liability", value: "₹2.4Cr", trend: "neutral" },
    ],
    tasks: [
      { id: "t1", title: "File Q3 GST returns for ABC Corp", client: "ABC Corp", status: "completed" },
      { id: "t2", title: "Review TDS deductions — XYZ Ltd", client: "XYZ Ltd", status: "in_progress" },
      { id: "t3", title: "Advance tax computation — MNO", client: "MNO Pvt Ltd", status: "pending" },
      { id: "t4", title: "E-way bill audit — PQR Industries", client: "PQR Industries", status: "pending" },
    ],
    chat: [
      { id: "m1", from: "assistant", text: "Orchestrated: TDS Calculation + TDS Filing agents for XYZ Ltd review. Running now." },
    ],
  },
  {
    id: "a2",
    label: "Assistant 2",
    color: "amber",
    status: "working",
    agentIds: ["g-journal", "g-bankrec", "f-close-wf", "c-def-bank", "u-rahul-style"],
    metrics: [
      { label: "Close Progress", value: "67%", trend: "up" },
      { label: "Journal Entries", value: "12 pending", trend: "neutral" },
    ],
    tasks: [
      { id: "t5", title: "Month-end close entries — ABC Corp", client: "ABC Corp", status: "completed" },
      { id: "t6", title: "Bank reconciliation — DEF Inc", client: "DEF Inc", status: "in_progress" },
      { id: "t7", title: "P&L variance analysis — ABC Corp", client: "ABC Corp", status: "pending" },
      { id: "t8", title: "Inter-company eliminations — DEF", client: "DEF Inc", status: "pending" },
    ],
    chat: [
      { id: "m2", from: "assistant", text: "Bank Rec agent found 2 mismatches for DEF Inc. Reconciling with Client Agent pattern." },
    ],
  },
  {
    id: "a3",
    label: "Assistant 3",
    color: "rose",
    status: "idle",
    agentIds: ["g-internal-audit", "g-control", "g-risk", "c-ghi-risk", "u-rahul-hours"],
    metrics: [
      { label: "High Risks", value: "4 found", trend: "neutral" },
      { label: "Controls", value: "23/30", trend: "up" },
    ],
    tasks: [
      { id: "t9", title: "Internal audit plan — ABC Corp", client: "ABC Corp", status: "completed" },
      { id: "t10", title: "Control testing — GHI Holdings", client: "GHI Holdings", status: "in_progress" },
      { id: "t11", title: "Risk assessment update — ABC Corp", client: "ABC Corp", status: "pending" },
      { id: "t12", title: "Findings report — GHI Holdings", client: "GHI Holdings", status: "pending" },
    ],
    chat: [
      { id: "m3", from: "assistant", text: "Ready. Control Testing agent queued for GHI Holdings. Risk Profile agent loaded." },
    ],
  },
  {
    id: "a4",
    label: "Assistant 4",
    color: "cyan",
    status: "working",
    agentIds: ["g-roc-aoc", "g-roc-mgt", "g-cal", "f-approval", "c-abc-approvals"],
    metrics: [
      { label: "Filings Due", value: "5 this week", trend: "neutral" },
      { label: "Penalties", value: "₹0", trend: "up" },
    ],
    tasks: [
      { id: "t13", title: "Annual return filing — XYZ Ltd", client: "XYZ Ltd", status: "in_progress" },
      { id: "t14", title: "DIN KYC update — JKL Associates", client: "JKL Associates", status: "pending" },
      { id: "t15", title: "Form MGT-7 filing — MNO Pvt Ltd", client: "MNO Pvt Ltd", status: "pending" },
      { id: "t16", title: "Compliance calendar sync — all", client: "All Clients", status: "pending" },
    ],
    chat: [
      { id: "m4", from: "assistant", text: "AOC-4 + MGT-7 agents working for XYZ Ltd. Compliance Calendar agent syncing deadlines." },
    ],
  },
  {
    id: "a5",
    label: "Assistant 5",
    color: "lime",
    status: "working",
    agentIds: ["g-cash", "g-forecast", "g-fx", "c-abc-gst", "u-rahul-priority"],
    metrics: [
      { label: "Cash Position", value: "₹8.2Cr", trend: "up" },
      { label: "FX Positions", value: "3 open", trend: "neutral" },
    ],
    tasks: [
      { id: "t17", title: "Daily cash position — ABC Corp", client: "ABC Corp", status: "completed" },
      { id: "t18", title: "Bank rec completion — DEF Inc", client: "DEF Inc", status: "in_progress" },
      { id: "t19", title: "FX exposure report — ABC Corp", client: "ABC Corp", status: "pending" },
      { id: "t20", title: "Investment maturity alert — DEF", client: "DEF Inc", status: "pending" },
    ],
    chat: [
      { id: "m5", from: "assistant", text: "Cash Position agent: ABC Corp ₹5.1Cr across 3 banks. Forecast agent running projections." },
    ],
  },
];

export const ASSISTANT_COLOR: Record<OrchestraAssistant["color"], { bg: string; text: string; dot: string; border: string }> = {
  teal: { bg: "bg-teal-50 dark:bg-teal-900/30", text: "text-teal-700 dark:text-teal-300", dot: "bg-teal-500", border: "border-teal-200 dark:border-teal-800" },
  amber: { bg: "bg-amber-50 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500", border: "border-amber-200 dark:border-amber-800" },
  rose: { bg: "bg-rose-50 dark:bg-rose-900/30", text: "text-rose-700 dark:text-rose-300", dot: "bg-rose-500", border: "border-rose-200 dark:border-rose-800" },
  cyan: { bg: "bg-cyan-50 dark:bg-cyan-900/30", text: "text-cyan-700 dark:text-cyan-300", dot: "bg-cyan-500", border: "border-cyan-200 dark:border-cyan-800" },
  lime: { bg: "bg-lime-50 dark:bg-lime-900/30", text: "text-lime-700 dark:text-lime-300", dot: "bg-lime-500", border: "border-lime-200 dark:border-lime-800" },
};
