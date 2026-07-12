"use client";

// Wave 31 (Metabase/Superset-inspired saved queries, PLATFORM_STRATEGY.md
// §15). Rendered with the recharts dependency already used elsewhere on
// this page -- no new BI engine/dependency, no SQL editor (see
// custom-report-service.ts's whitelist for the security boundary).
import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, BarChart3, Trash2 } from "lucide-react";
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
import { BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

type SavedReport = { id: string; name: string; description: string | null; sourceEntity: string; groupByField: string | null; chartType: string; visibility: string };
type ReportRow = { groupValue: string | null; count: number };

const SOURCE_ENTITIES: Record<string, { label: string; groupByFields: { value: string; label: string }[] }> = {
  compliance_items: { label: "Compliance Items", groupByFields: [{ value: "status", label: "Status" }, { value: "priority", label: "Priority" }, { value: "departmentId", label: "Department" }] },
  notices: { label: "Notices", groupByFields: [{ value: "status", label: "Status" }, { value: "authority", label: "Authority" }] },
  risks: { label: "Risks", groupByFields: [{ value: "status", label: "Status" }, { value: "category", label: "Category" }] },
  pms_issues: { label: "PMS Issues", groupByFields: [{ value: "statusId", label: "Status" }, { value: "priority", label: "Priority" }] },
  incidents: { label: "Incidents", groupByFields: [{ value: "stage", label: "Stage" }, { value: "severity", label: "Severity" }] },
};

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
                    {Object.entries(SOURCE_ENTITIES).map(([value, e]) => <SelectItem key={value} value={value}>{e.label}</SelectItem>)}
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
                  <Button variant="ghost" size="sm" onClick={() => removeReport(report.id)}>
                    <Trash2 className="size-3.5 text-ct-error" />
                  </Button>
                </div>
                {results[report.id] ? <ReportChart chartType={report.chartType} rows={results[report.id]} /> : <p className="text-xs text-ct-muted">Loading data...</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
