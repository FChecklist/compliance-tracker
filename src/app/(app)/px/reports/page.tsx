"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module
// "reports": native port of PROJEXA's own Reports screen
// (FChecklist/projexa src/app/(app)/reports/page.tsx +
// src/components/ReportsClient.tsx), reading this repo's own
// GET /api/v1/projexa/reports/** routes directly -- no new backend logic.
// Lives at /px/reports, not /reports, because compliance-tracker's own
// /reports is a different, pre-existing concept (the native Reports &
// Analysis Engine catalog for THIS app's own org) -- src/proxy.ts (already
// merged) rewrites projexa-ai.com/reports to this path.
//
// OVERLAP CHECK (done before writing this file, per this task's own
// instruction): grepped src/app/(app) for any existing page calling
// src/app/api/v1/projexa/reports/** -- none exists. construction-dashboard/
// page.tsx (the page a sibling session found already covered a slice of
// px/dashboard's data) does not call the reports API at all. This is a real
// gap, not a duplicate of already-ported work.
//
// SCOPE -- ports 2 of PROJEXA's real Reports-page surfaces faithfully:
//   1. "Project Reports" tab: all 24 REPORT_REGISTRY names (construction-
//      reports-service.ts) via GET /api/v1/projexa/reports/[reportName],
//      rendered with the SAME generic {columns,rows,totals,currency} table
//      shape that route already returns by default (R67 E-32) -- one
//      renderer for every report, matching the real API contract instead of
//      24 bespoke ones.
//   2. "Full Catalog" tab: GET /api/v1/projexa/reports/catalog
//      (getFullReportCatalog -- the SAME catalog compliance-tracker's own
//      native /reports page reads) with a Run action for every executable
//      report_definitions row, via POST
//      /api/v1/projexa/reports/definitions/[id]/run.
//   Also wires the real PDF/CSV/XLSX export buttons for the 3 reports that
//   have a document schema (budget-variance, project-status,
//   designer-timesheet), via GET /api/v1/projexa/reports/[reportName]/export.
//
// DELIBERATELY NOT PORTED, and why:
//   - Share-link creation (ReportsClient's ExportShareActions "Share" half).
//     Creating a link is a real POST (/api/v1/projexa/reports/share) but
//     resolving it back into a page is a SEPARATE, intentionally-public route
//     (/api/reports/share/[token]) this port does not add -- a share button
//     with nothing to open on the other end would be worse than no button.
//   - Per-report advanced filters beyond the one truly REQUIRED parameter
//     (weekStart, for weekly-project/certified-payroll): budget-variance's
//     category/vendor/groupBy, work-progress's category filter,
//     manpower-cost's date/trade, category-boq-amounts' boqId, and
//     designer-timesheet's from/to are all real query params the underlying
//     route accepts, but every one of them is explicitly documented as
//     OPTIONAL in that route's own comments ("omitted, behaviour is
//     unchanged" / "keeps the previous whole-BOQ, scope-wise behaviour").
//     Running any report with just projectId (+ weekStart where required)
//     is therefore a real, correct, complete call -- just not a
//     parameterised one. A follow-up pass can add these as extra optional
//     inputs without changing this page's data contract.
//   - The bespoke ProjectStatusCard KPI layout (money/percent bands,
//     narrative ordering) -- project-status runs through the same generic
//     table as every other report here, which is a real simplification
//     versus PROJEXA's hand-tuned card, not a missing feature (the same
//     numbers, same labels, plainer layout).
//   - PROJEXA's separate `/analysis` module (Project 360 margin analysis --
//     GET /api/v1/projexa/reports/boq-analysis -- and the portfolio
//     budget-vs-actual chart at GET
//     /api/v1/projexa/reports/portfolio/budget-vs-actual). Verified directly
//     against PROJEXA's own source: both are consumed by
//     src/app/(app)/analysis/** (Project360Client.tsx), a DIFFERENT
//     top-level route from src/app/(app)/reports/**, with its own page. They
//     belong to a future px/analysis port, not this one.
//
// UI is compliance-tracker's own shadcn Card/Table/Tabs/Select (matching the
// house convention every already-ported px/ page uses -- see
// px/settings/page.tsx, px/dashboard) -- not PROJEXA's
// @fchecklist/veridian-ui-kit ScreenFrame/ListScreen.
import { Fragment, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type Project = { id: string; name: string; status: string };

type ReportColumnUnit = "currency" | "percent" | "number" | "date" | "text";
type ReportColumn = { key: string; label: string; unit: ReportColumnUnit; align: "left" | "right" };
type ReportCell = string | number | null;
// Mirrors construction-reports-service.ts's ReportTable exactly -- the
// generic shape GET /api/v1/projexa/reports/[reportName] returns by default.
type ReportTable = {
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals?: Record<string, number>;
  currency: string | null;
  note?: string;
};

// Mirrors report-catalog-service.ts's FullCatalogEntry -- only the fields
// this page reads.
type CatalogEntry = {
  id: string;
  name: string;
  description: string;
  domain: string;
  routeNote: string;
  category: string;
  source: "static" | "definition";
  definitionId?: string;
  status?: "built" | "data_gap" | "planned";
};

// Mirrors report-engine-service.ts's ReportDefinitionResult.
type DefinitionResult = { columns: string[]; rows: Record<string, string | number>[]; narrative?: string; note?: string };
type DefinitionOutcome = DefinitionResult | { error: string };

// All 24 REPORT_REGISTRY keys (construction-reports-service.ts), with a
// friendly label -- the VALUES are the real API path segments and must
// match that registry exactly; the labels are display text only.
const REPORT_OPTIONS: { value: string; label: string }[] = [
  { value: "project-status", label: "Project Status" },
  { value: "project-completion", label: "Project Completion" },
  { value: "work-progress", label: "Work Progress" },
  { value: "category-progress", label: "Category Progress" },
  { value: "weekly-project", label: "Weekly Project (needs a week start)" },
  { value: "attendance", label: "Attendance" },
  { value: "manpower-cost", label: "Manpower Cost" },
  { value: "manpower-daily-summary", label: "Manpower Daily Summary" },
  { value: "site-picture", label: "Site Picture Log" },
  { value: "scope", label: "Scope (BOQ)" },
  { value: "budget-summary", label: "Budget Summary" },
  { value: "budget-vs-actual", label: "Budget vs Actual (manager role or higher)" },
  { value: "budget-variance", label: "Budget Variance (Cost Variance)" },
  { value: "material-consumption", label: "Material Consumption" },
  { value: "vendor-cost", label: "Vendor Cost" },
  { value: "designer-timesheet", label: "Designer Timesheet" },
  { value: "designer-approval-status", label: "Designer Approval Status" },
  { value: "work-analysis", label: "Work Analysis" },
  { value: "kpi", label: "KPI" },
  { value: "revenue", label: "Revenue" },
  { value: "expense", label: "Expense" },
  { value: "category-boq-amounts", label: "Category BOQ Amounts" },
  { value: "certified-payroll", label: "Certified Payroll (needs a week start)" },
  { value: "earned-value", label: "Earned Value" },
];

// The one truly required extra parameter across the registry -- see this
// file's header comment for why every other optional filter is left out.
const REQUIRES_WEEK_START = new Set(["weekly-project", "certified-payroll"]);

// Matches src/app/api/v1/projexa/reports/[reportName]/export/route.ts's own
// EXPORTABLE list exactly.
const EXPORTABLE = new Set(["budget-variance", "project-status", "designer-timesheet"]);

function formatCell(cell: ReportCell, unit: ReportColumnUnit, currency: string | null): string {
  if (cell === null || cell === undefined || cell === "") return "—";
  if (unit === "currency" && typeof cell === "number") {
    return `${currency ? `${currency} ` : ""}${cell.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  if (unit === "percent" && typeof cell === "number") return `${cell}%`;
  if (unit === "number" && typeof cell === "number") return cell.toLocaleString();
  return String(cell);
}

function ReportTableView({ table }: { table: ReportTable }) {
  if (table.rows.length === 0) {
    return <p className="text-sm text-ct-muted">{table.note ?? "No data for this report yet."}</p>;
  }
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {table.columns.map((c) => (
                <TableHead key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row, i) => (
              <TableRow key={i}>
                {table.columns.map((c) => (
                  <TableCell key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                    {formatCell(row[c.key], c.unit, table.currency)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {table.totals && (
              <TableRow className="font-semibold border-t-2 border-ct-navy/20">
                {table.columns.map((c, i) => {
                  const total = table.totals?.[c.key];
                  return (
                    <TableCell key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                      {i === 0 ? "Total" : total !== undefined ? formatCell(total, c.unit, table.currency) : ""}
                    </TableCell>
                  );
                })}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {table.note && <p className="text-xs text-ct-muted">{table.note}</p>}
    </div>
  );
}

function DefinitionResultView({ result }: { result: DefinitionOutcome }) {
  if ("error" in result) return <p role="alert" className="text-[13px] text-red-600">{result.error}</p>;
  if (result.narrative) return <p className="text-sm text-ct-navy">{result.narrative}</p>;
  if (result.rows.length === 0) return <p className="text-sm text-ct-muted">{result.note ?? "No rows."}</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {result.columns.map((c) => <TableHead key={c}>{c}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row, i) => (
            <TableRow key={i}>
              {result.columns.map((c) => <TableCell key={c}>{row[c] === null || row[c] === undefined ? "—" : String(row[c])}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {result.note && <p className="text-xs text-ct-muted mt-1">{result.note}</p>}
    </div>
  );
}

export default function PxReportsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectId, setProjectId] = useState<string>("");

  const [reportName, setReportName] = useState<string>("project-status");
  const [weekStart, setWeekStart] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [table, setTable] = useState<ReportTable | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [runningDefinitionId, setRunningDefinitionId] = useState<string | null>(null);
  const [definitionResults, setDefinitionResults] = useState<Record<string, DefinitionOutcome>>({});

  useEffect(() => {
    fetch("/api/v1/projexa/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: Project[] = d.projects ?? [];
        setProjects(list);
        setProjectId((cur) => cur || list[0]?.id || "");
      })
      .catch(() => {})
      .finally(() => setProjectsLoading(false));
  }, []);

  const runReport = useCallback(async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    if (REQUIRES_WEEK_START.has(reportName) && !weekStart) {
      toast.error("This report needs a week start date");
      return;
    }
    setRunning(true);
    setRunError(null);
    try {
      const params = new URLSearchParams({ projectId });
      if (REQUIRES_WEEK_START.has(reportName)) params.set("weekStart", weekStart);
      const res = await fetch(`/api/v1/projexa/reports/${reportName}?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed to run the ${reportName} report`);
      setTable(data as ReportTable);
    } catch (err) {
      setTable(null);
      setRunError(err instanceof Error ? err.message : "Failed to run report");
    } finally {
      setRunning(false);
    }
  }, [projectId, reportName, weekStart]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await fetch("/api/v1/projexa/reports/catalog");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load the report catalog");
      setCatalog((data.catalog ?? []) as CatalogEntry[]);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "Couldn't load the report catalog");
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  async function runDefinition(entry: CatalogEntry) {
    if (!entry.definitionId) return;
    const definitionId = entry.definitionId;
    setRunningDefinitionId(definitionId);
    try {
      const res = await fetch(`/api/v1/projexa/reports/definitions/${definitionId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: {} }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to run this report");
      setDefinitionResults((m) => ({ ...m, [definitionId]: data as DefinitionResult }));
    } catch (err) {
      setDefinitionResults((m) => ({
        ...m,
        [definitionId]: { error: err instanceof Error ? err.message : "Failed to run this report" },
      }));
    } finally {
      setRunningDefinitionId(null);
    }
  }

  function exportHref(format: "pdf" | "csv" | "xlsx") {
    const params = new URLSearchParams({ projectId, format });
    return `/api/v1/projexa/reports/${reportName}/export?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Reports</h1>
        <p className="text-sm text-ct-muted mt-1">
          Construction project reports, and the full Reports &amp; Analysis catalog.
        </p>
      </div>

      <Tabs
        defaultValue="project"
        onValueChange={(v) => {
          if (v === "catalog" && catalog === null && !catalogLoading) void loadCatalog();
        }}
      >
        <TabsList>
          <TabsTrigger value="project">Project Reports</TabsTrigger>
          <TabsTrigger value="catalog">Full Catalog</TabsTrigger>
        </TabsList>

        <TabsContent value="project" className="space-y-4">
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="pt-6 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label>Project</Label>
                  {projectsLoading ? (
                    <p className="text-sm text-ct-muted h-9 flex items-center" aria-busy="true">Loading…</p>
                  ) : projects.length === 0 ? (
                    <p className="text-sm text-ct-muted h-9 flex items-center">No projects yet</p>
                  ) : (
                    <Select value={projectId} onValueChange={setProjectId}>
                      <SelectTrigger size="sm" className="w-56"><SelectValue placeholder="Select a project" /></SelectTrigger>
                      <SelectContent>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Report</Label>
                  <Select value={reportName} onValueChange={setReportName}>
                    <SelectTrigger size="sm" className="w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REPORT_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {REQUIRES_WEEK_START.has(reportName) && (
                  <div className="space-y-1">
                    <Label>Week start</Label>
                    <Input
                      type="date"
                      className="h-8 w-40"
                      value={weekStart}
                      onChange={(e) => setWeekStart(e.target.value)}
                    />
                  </div>
                )}

                <Button size="sm" onClick={runReport} disabled={running || !projectId}>
                  {running ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Play className="size-4 mr-1" />}
                  Run
                </Button>

                {table && EXPORTABLE.has(reportName) && (
                  <div className="flex items-center gap-3 pb-1.5">
                    <span className="text-xs text-ct-muted">Export:</span>
                    <a href={exportHref("pdf")} className="text-xs underline text-ct-navy hover:text-ct-navy/70">PDF</a>
                    <a href={exportHref("csv")} className="text-xs underline text-ct-navy hover:text-ct-navy/70">CSV</a>
                    <a href={exportHref("xlsx")} className="text-xs underline text-ct-navy hover:text-ct-navy/70">XLSX</a>
                  </div>
                )}
              </div>

              {runError && <p role="alert" className="text-[13px] text-red-600">{runError}</p>}

              {table && <ReportTableView table={table} />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="catalog" className="space-y-4">
          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-ct-navy">Reports &amp; Analysis Catalog</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {catalogError && <p role="alert" className="text-[13px] text-red-600">{catalogError}</p>}
              {catalogLoading ? (
                <p className="text-sm text-ct-muted" aria-busy="true">Loading…</p>
              ) : catalog !== null && catalog.length === 0 ? (
                <p className="text-sm text-ct-muted">No reports in the catalog for this organisation.</p>
              ) : catalog !== null ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Domain</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {catalog.map((entry) => {
                        const canRun = entry.source === "definition" && entry.status === "built" && !!entry.definitionId;
                        const result = entry.definitionId ? definitionResults[entry.definitionId] : undefined;
                        return (
                          <Fragment key={entry.id}>
                            <TableRow>
                              <TableCell>
                                <div className="font-medium text-ct-navy">{entry.name}</div>
                                <div className="text-xs text-ct-muted">{entry.description}</div>
                              </TableCell>
                              <TableCell className="text-sm">{entry.domain}</TableCell>
                              <TableCell>
                                {entry.source === "definition" ? (
                                  <Badge variant={entry.status === "built" ? "default" : "secondary"}>
                                    {entry.status ?? "built"}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline">catalog only</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {canRun ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={runningDefinitionId === entry.definitionId}
                                    onClick={() => runDefinition(entry)}
                                  >
                                    {runningDefinitionId === entry.definitionId ? (
                                      <Loader2 className="size-4 animate-spin" />
                                    ) : (
                                      "Run"
                                    )}
                                  </Button>
                                ) : (
                                  <span className="text-xs text-ct-muted">{entry.routeNote}</span>
                                )}
                              </TableCell>
                            </TableRow>
                            {result && (
                              <TableRow>
                                <TableCell colSpan={4} className="bg-muted/30">
                                  <DefinitionResultView result={result} />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
