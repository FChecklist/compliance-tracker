"use client";

// Wave 31 (Metabase/Superset-inspired saved queries, PLATFORM_STRATEGY.md
// §15). Rendered with the recharts dependency already used elsewhere on
// this page -- no new BI engine/dependency, no SQL editor (see
// custom-report-service.ts's whitelist for the security boundary).
import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, BarChart3, Trash2, CalendarClock, Check, ListPlus, Share2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ReportScheduleDialog } from "@/components/ReportScheduleDialog";

// AI Report Builder (2026-07-13, "Need a Report?" upload flow): aiGeneratedData
// is only ever present when sourceEntity === "ai_generated" -- see
// drizzle/0177_ai_report_builder.sql and ai-report-builder-service.ts for
// the shape's origin. Already included in every /api/reports/saved list
// response (listSavedReports() returns full rows), so it needs no separate
// /run fetch the way live-query reports do.
type AiGeneratedReportData = {
  title: string;
  summary: string;
  columns: string[];
  rows: Record<string, string | number>[];
  chartType: string;
  chartRows: { groupValue: string; count: number }[];
};
type SavedReport = {
  id: string; name: string; description: string | null; sourceEntity: string; groupByField: string | null
  chartType: string; visibility: string; aiGeneratedData?: AiGeneratedReportData | null; sourceFileName?: string | null
};
type ReportRow = { groupValue: string | null; count: number };
type OrgUser = { id: string; name: string; email: string };

const SOURCE_ENTITIES: Record<string, { label: string; groupByFields: { value: string; label: string }[] }> = {
  compliance_items: { label: "Compliance Items", groupByFields: [{ value: "status", label: "Status" }, { value: "priority", label: "Priority" }, { value: "departmentId", label: "Department" }] },
  notices: { label: "Notices", groupByFields: [{ value: "status", label: "Status" }, { value: "authority", label: "Authority" }] },
  risks: { label: "Risks", groupByFields: [{ value: "status", label: "Status" }, { value: "category", label: "Category" }] },
  pms_issues: { label: "PMS Issues", groupByFields: [{ value: "statusId", label: "Status" }, { value: "priority", label: "Priority" }] },
  incidents: { label: "Incidents", groupByFields: [{ value: "stage", label: "Stage" }, { value: "severity", label: "Severity" }] },
  ai_generated: { label: "AI-Generated", groupByFields: [] },
};

// Full multi-column table for an AI-generated report -- ReportChart's
// existing "table" branch below is a fixed 2-column name/value view (built
// for groupValue/count rows) and can't represent an arbitrary-column
// AI proposal, so this is a small, separate renderer rather than forcing
// AI output through that shape.
function AiReportTable({ data }: { data: AiGeneratedReportData }) {
  if (data.columns.length === 0 || data.rows.length === 0) {
    return <p className="text-xs text-ct-muted">No data in this report.</p>;
  }
  return (
    <div className="space-y-2">
      {data.summary && <p className="text-xs text-ct-muted">{data.summary}</p>}
      <div className="overflow-x-auto max-h-[220px] overflow-y-auto rounded border border-ct-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-ct-navy text-white">
            <tr>
              {data.columns.map((col) => (
                <th key={col} className="py-1.5 px-2 text-left font-medium whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ct-border">
            {data.rows.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? "bg-ct-cloud/40" : ""}>
                {data.columns.map((col) => (
                  <td key={col} className="py-1.5 px-2 whitespace-nowrap">{String(row[col] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PIE_COLORS = ["#0E7C6E", "#F5820A", "#1C2B3A", "#EF4444", "#3B82F6", "#F59E0B"];

function ReportChart({ chartType, rows }: { chartType: string; rows: ReportRow[] }) {
  const data = rows.map((r) => ({ name: r.groupValue ?? "None", value: r.count }));
  if (chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="value" fill="#0E7C6E" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "pie") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={80}>
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#0E7C6E" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return (
    <table className="w-full text-xs">
      <tbody className="divide-y divide-ct-border">
        {data.map((row, i) => (
          <tr key={i}><td className="py-1.5">{row.name}</td><td className="py-1.5 text-right font-medium">{row.value}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

// Owner directive 2026-07-13: a real accept/send-to-todo/delegate action
// flow on each report result row.
//   - Accept: POST /api/reports/item-actions {action:"accept"} only --
//     never touches the underlying domain entity's own status (it has
//     none here; a report row is a groupValue+count, not a compliance
//     item/notice/risk row).
//   - Send to To-Do: POST /api/tasks (task-service.ts's real createTask(),
//     the same call VeriComposer.tsx uses) -- the created task is what
//     shows up in "My To Do" via veri-todo-service.ts's listVeriTodos()
//     task branch. Honors the same Wave 146 high-impact-action confirmation
//     gate createTask() already enforces for every other caller -- a
//     needsConfirmation response surfaces a toast with an explicit
//     "Confirm" action instead of silently resubmitting confirmed:true.
//   - Delegate: POST /api/delegations (delegation-service.ts's real
//     createDelegation()), scopeType "task" (the closest of its 6 fixed
//     scope types to "hand off this report finding"), scopeId set to this
//     row's own reportId:rowId pair so the delegation is traceable back to
//     the exact row that created it.
// Every successful delegate/todo call is followed by a POST to
// /api/reports/item-actions recording the real id it just created as
// targetId -- the audit trail always points at a real row, never a stub.
function ReportRowActions({
  reportId, reportName, row, orgUsers,
}: { reportId: string; reportName: string; row: ReportRow; orgUsers: OrgUser[] }) {
  const rowId = String(row.groupValue ?? "None");
  const [busy, setBusy] = useState<string | null>(null);
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [delegateUserId, setDelegateUserId] = useState("");
  const pendingCategoryRef = useRef<string | undefined>(undefined);

  const recordAction = (action: "accept" | "delegate" | "todo", targetId?: string) =>
    fetch("/api/reports/item-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId, rowId, action, targetId: targetId ?? null }),
    });

  const accept = async () => {
    setBusy("accept");
    try {
      const res = await recordAction("accept");
      if (!res.ok) throw new Error();
      toast.success("Marked acknowledged");
    } catch {
      toast.error("Failed to record acknowledgement");
    } finally {
      setBusy(null);
    }
  };

  const sendToTodo = async (confirmed = false) => {
    setBusy("todo");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${reportName}: ${rowId} (${row.count})`,
          description: `Follow up on report row "${rowId}" = ${row.count} from the "${reportName}" custom report.`,
          ...(confirmed ? { confirmed: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      if (data.needsConfirmation) {
        pendingCategoryRef.current = data.category;
        toast(`This looks like a sensitive action (${data.categoryLabel ?? data.category}). Send to To-Do anyway?`, {
          action: { label: "Confirm", onClick: () => sendToTodo(true) },
        });
        return;
      }
      await recordAction("todo", data.id);
      toast.success("Added to your To-Do");
    } catch {
      toast.error("Failed to add to To-Do");
    } finally {
      setBusy(null);
    }
  };

  const delegate = async () => {
    if (!delegateUserId) {
      toast.error("Pick someone to delegate to");
      return;
    }
    setBusy("delegate");
    try {
      const res = await fetch("/api/delegations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delegateUserId, scopeType: "task", scopeId: `${reportId}:${rowId}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delegate");
      await recordAction("delegate", data.id);
      toast.success("Delegated");
      setDelegateOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delegate");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Accept" onClick={accept} disabled={busy !== null}>
        {busy === "accept" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3 text-ct-teal" />}
      </Button>
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Send to To-Do" onClick={() => sendToTodo(false)} disabled={busy !== null}>
        {busy === "todo" ? <Loader2 className="size-3 animate-spin" /> : <ListPlus className="size-3 text-ct-navy" />}
      </Button>
      <Popover open={delegateOpen} onOpenChange={setDelegateOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Delegate" disabled={busy !== null}>
            <Share2 className="size-3 text-ct-saffron" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2 p-3">
          <p className="text-xs font-semibold text-ct-muted uppercase">Delegate to</p>
          <Select value={delegateUserId} onValueChange={setDelegateUserId}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick a user" /></SelectTrigger>
            <SelectContent>
              {orgUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="w-full bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={delegate} disabled={busy !== null}>
            {busy === "delegate" ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null}
            Delegate
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function CustomReportsSection() {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState<Record<string, ReportRow[]>>({});

  const [name, setName] = useState("");
  const [sourceEntity, setSourceEntity] = useState("compliance_items");
  const [groupByField, setGroupByField] = useState("status");
  const [chartType, setChartType] = useState("bar");

  // Owner directive 2026-07-13: org users for the Delegate popover's picker
  // and ReportScheduleDialog's recipient checklist -- fetched once, shared
  // by every report card rather than re-fetched per row/dialog open.
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  // Which report is currently being scheduled (null = dialog closed).
  const [schedulingReport, setSchedulingReport] = useState<SavedReport | null>(null);

  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setOrgUsers(d.users ?? [])).catch(() => {});
  }, []);

  // Wave 173 (chain-integration for reports, "reports-page deep-linking"):
  // a capability-tree report_link leaf (capability-tree-service.ts's
  // buildReportLinkNodes) navigates to /reports?report=<id>#custom-reports
  // -- this is what makes that id param actually do something once the
  // page loads, instead of being silently ignored. Scrolls to and briefly
  // highlights the matching card; a report id with no match (deleted,
  // wrong org) just falls through with no effect, never an error.
  const searchParams = useSearchParams();
  const highlightedReportId = searchParams.get("report");
  const [scrolledToHighlight, setScrolledToHighlight] = useState(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/reports/saved");
    const data = await res.json();
    const list: SavedReport[] = data.reports ?? [];
    setReports(list);
    setLoading(false);
    for (const r of list) {
      // AI-generated reports carry their full data inline (aiGeneratedData,
      // above) -- no live query to run, so skip the /run round-trip
      // entirely for them (also avoids logging a spurious
      // "report_generated" audit event just for viewing a static report).
      if (r.sourceEntity === "ai_generated") continue;
      fetch(`/api/reports/saved/${r.id}/run`).then((res) => res.json()).then((d) => {
        setResults((prev) => ({ ...prev, [r.id]: d.rows ?? [] }));
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!highlightedReportId || scrolledToHighlight || reports.length === 0) return;
    const el = cardRefs.current[highlightedReportId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setScrolledToHighlight(true);
    }
  }, [highlightedReportId, scrolledToHighlight, reports]);

  const createReport = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/reports/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sourceEntity, groupByField, chartType }),
      });
      if (!res.ok) throw new Error();
      toast.success("Report saved");
      setOpen(false);
      setName("");
      load();
    } catch {
      toast.error("Failed to save report");
    } finally {
      setCreating(false);
    }
  };

  const removeReport = async (id: string) => {
    try {
      const res = await fetch(`/api/reports/saved/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Report deleted");
      load();
    } catch {
      toast.error("Failed to delete report");
    }
  };

  return (
    <Card id="custom-reports" className="rounded-xl shadow-card bg-white scroll-mt-24">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
          <BarChart3 className="size-4 text-ct-teal" />
          Custom Reports
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              <Plus className="size-3.5 mr-1.5" />
              New Report
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Custom Report</DialogTitle>
              <DialogDescription>Build a saved query over your org data -- no SQL required.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Notices by status" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Data source</Label>
                <Select value={sourceEntity} onValueChange={(v) => { setSourceEntity(v); setGroupByField(SOURCE_ENTITIES[v].groupByFields[0].value); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* "ai_generated" is intentionally excluded here -- it has
                        no groupByFields (the line above would throw) and is
                        only ever created via the "Need a Report?" upload
                        flow, never this manual live-query builder. */}
                    {Object.entries(SOURCE_ENTITIES).filter(([value]) => value !== "ai_generated").map(([value, e]) => <SelectItem key={value} value={value}>{e.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Group by</Label>
                <Select value={groupByField} onValueChange={setGroupByField}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCE_ENTITIES[sourceEntity].groupByFields.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Chart type</Label>
                <Select value={chartType} onValueChange={setChartType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="table">Table</SelectItem>
                    <SelectItem value="bar">Bar chart</SelectItem>
                    <SelectItem value="pie">Pie chart</SelectItem>
                    <SelectItem value="line">Line chart</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createReport} disabled={creating || !name.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Save Report
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-ct-muted">Loading...</p>
        ) : reports.length === 0 ? (
          <p className="text-sm text-ct-muted">No custom reports yet. Save one to see it here.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reports.map((report) => (
              <div
                key={report.id}
                id={`report-${report.id}`}
                ref={(el) => { cardRefs.current[report.id] = el; }}
                className={`rounded-lg border p-3 transition-colors ${
                  highlightedReportId === report.id ? "border-ct-saffron ring-2 ring-ct-saffron/40" : "border-ct-border"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-ct-navy">{report.name}</p>
                    <Badge variant="secondary" className="text-[10px] mt-0.5">{SOURCE_ENTITIES[report.sourceEntity]?.label ?? report.sourceEntity}</Badge>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Button variant="ghost" size="sm" title="Schedule this report" onClick={() => setSchedulingReport(report)}>
                      <CalendarClock className="size-3.5 text-ct-teal" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeReport(report.id)}>
                      <Trash2 className="size-3.5 text-ct-error" />
                    </Button>
                  </div>
                </div>
                {report.sourceEntity === "ai_generated" && report.aiGeneratedData ? (
                  <AiReportTable data={report.aiGeneratedData} />
                ) : results[report.id] ? (
                  <ReportChart chartType={report.chartType} rows={results[report.id]} />
                ) : (
                  <p className="text-xs text-ct-muted">Loading data...</p>
                )}
                {report.sourceEntity !== "ai_generated" && results[report.id] && results[report.id].length > 0 && (
                  <div className="mt-3 pt-2 border-t border-ct-border space-y-1">
                    {results[report.id].map((row, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-ct-muted truncate">{row.groupValue ?? "None"} <span className="font-medium text-ct-navy">({row.count})</span></span>
                        <ReportRowActions reportId={report.id} reportName={report.name} row={row} orgUsers={orgUsers} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {schedulingReport && (
        <ReportScheduleDialog
          reportId={schedulingReport.id}
          reportName={schedulingReport.name}
          open={schedulingReport !== null}
          onOpenChange={(next) => { if (!next) setSchedulingReport(null); }}
        />
      )}
    </Card>
  );
}
