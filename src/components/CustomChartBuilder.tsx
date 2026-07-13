"use client";

// Priority 13 (Self-Serve Ad-Hoc BI / Chart-Builder, MVP scope). Distinct
// from CustomReportsSection.tsx (Wave 31's savedReports/GROUP_BY_FIELDS,
// count-only over 5 tables) -- this reuses the newer, larger TABLE_REGISTRY
// (report-engine-service.ts, 28+ tables) with count/sum/avg aggregation,
// through the exact same runAggregationFromConfig() executor a
// report_definitions row uses. Rendered with recharts, already a dependency
// on this page -- no new charting library.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Loader2, LineChart as LineChartIcon, Trash2, Play } from "lucide-react";
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

type DatasetMeta = Record<string, { columns: string[] }>;
type ChartResult = { columns: string[]; rows: Record<string, string | number>[]; note?: string };
type CustomChart = {
  id: string;
  name: string;
  chartType: "bar" | "line" | "pie" | "table";
  aggregationConfig: {
    kind: "aggregation";
    tableKey: string;
    groupByColumn?: string;
    aggregation: "count" | "sum" | "avg";
    aggregationColumnKey?: string;
  };
};

const PIE_COLORS = ["#0E7C6E", "#F5820A", "#1C2B3A", "#EF4444", "#3B82F6", "#F59E0B"];

function ChartView({ chartType, result }: { chartType: string; result: ChartResult }) {
  if (!result.rows || result.rows.length === 0) {
    return <p className="text-xs text-ct-muted">{result.note ?? "No data for this chart yet."}</p>;
  }
  const groupKey = result.columns[0] ?? "Group";
  const data = result.rows.map((r) => ({ name: String(r[groupKey] ?? "None"), value: Number(r.Value ?? 0) }));

  if (chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="value" fill="#0E7C6E" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#0E7C6E" strokeWidth={2} />
        </LineChart>
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

export default function CustomChartBuilder() {
  const [charts, setCharts] = useState<CustomChart[]>([]);
  const [datasets, setDatasets] = useState<DatasetMeta>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState<Record<string, ChartResult>>({});

  const [name, setName] = useState("");
  const [tableKey, setTableKey] = useState("");
  const [groupByColumn, setGroupByColumn] = useState<string>("none");
  const [aggregation, setAggregation] = useState<"count" | "sum" | "avg">("count");
  const [aggregationColumnKey, setAggregationColumnKey] = useState<string>("none");
  const [chartType, setChartType] = useState<CustomChart["chartType"]>("bar");

  const load = useCallback(async () => {
    const [chartsRes, metaRes] = await Promise.all([
      fetch("/api/custom-charts"),
      fetch("/api/custom-charts?meta=1"),
    ]);
    const chartsData = await chartsRes.json();
    const metaData = await metaRes.json();
    const list: CustomChart[] = chartsData.charts ?? [];
    setCharts(list);
    setDatasets(metaData.datasets ?? {});
    if (!tableKey) {
      const firstKey = Object.keys(metaData.datasets ?? {})[0];
      if (firstKey) setTableKey(firstKey);
    }
    setLoading(false);
    for (const chart of list) {
      fetch(`/api/custom-charts/${chart.id}/run`, { method: "POST" }).then((r) => r.json()).then((d) => {
        setResults((prev) => ({ ...prev, [chart.id]: d }));
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columnsForTable = tableKey ? (datasets[tableKey]?.columns ?? []) : [];

  const createChart = async () => {
    if (!name.trim() || !tableKey) return;
    setCreating(true);
    try {
      const res = await fetch("/api/custom-charts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, chartType,
          aggregationConfig: {
            kind: "aggregation",
            tableKey,
            groupByColumn: groupByColumn === "none" ? undefined : groupByColumn,
            aggregation,
            aggregationColumnKey: aggregationColumnKey === "none" ? undefined : aggregationColumnKey,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save chart");
      toast.success("Chart saved");
      setOpen(false);
      setName("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save chart");
    } finally {
      setCreating(false);
    }
  };

  const removeChart = async (id: string) => {
    try {
      const res = await fetch(`/api/custom-charts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Chart deleted");
      load();
    } catch {
      toast.error("Failed to delete chart");
    }
  };

  const rerunChart = async (id: string) => {
    const res = await fetch(`/api/custom-charts/${id}/run`, { method: "POST" });
    const data = await res.json();
    setResults((prev) => ({ ...prev, [id]: data }));
  };

  return (
    <Card id="custom-charts" className="rounded-xl shadow-card bg-white scroll-mt-24">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
          <LineChartIcon className="size-4 text-ct-saffron" />
          Custom Charts (Ad-Hoc BI)
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              <Plus className="size-3.5 mr-1.5" />
              New Chart
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New Custom Chart</DialogTitle>
              <DialogDescription>Pick a dataset, an aggregation, and a chart type -- no report definition or developer needed.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Overdue POs by supplier" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Dataset</Label>
                <Select value={tableKey} onValueChange={(v) => { setTableKey(v); setGroupByColumn("none"); setAggregationColumnKey("none"); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {Object.keys(datasets).map((key) => <SelectItem key={key} value={key}>{key}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Group by (optional)</Label>
                  <Select value={groupByColumn} onValueChange={setGroupByColumn}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No grouping (single total)</SelectItem>
                      {columnsForTable.map((col) => <SelectItem key={col} value={col}>{col}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Aggregation</Label>
                  <Select value={aggregation} onValueChange={(v) => setAggregation(v as "count" | "sum" | "avg")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="count">Count</SelectItem>
                      <SelectItem value="sum">Sum</SelectItem>
                      <SelectItem value="avg">Average</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(aggregation === "sum" || aggregation === "avg") && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Column to {aggregation}</Label>
                  <Select value={aggregationColumnKey} onValueChange={setAggregationColumnKey}>
                    <SelectTrigger><SelectValue placeholder="Pick a numeric column" /></SelectTrigger>
                    <SelectContent>
                      {columnsForTable.map((col) => <SelectItem key={col} value={col}>{col}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Chart type</Label>
                <Select value={chartType} onValueChange={(v) => setChartType(v as CustomChart["chartType"])}>
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
              <Button onClick={createChart} disabled={creating || !name.trim() || !tableKey || ((aggregation === "sum" || aggregation === "avg") && aggregationColumnKey === "none")} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Save Chart
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-ct-muted">Loading...</p>
        ) : charts.length === 0 ? (
          <p className="text-sm text-ct-muted">No custom charts yet. Build one from any of the {Object.keys(datasets).length} registered datasets.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {charts.map((chart) => (
              <div key={chart.id} className="rounded-lg border border-ct-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-ct-navy">{chart.name}</p>
                    <Badge variant="secondary" className="text-[10px] mt-0.5">{chart.aggregationConfig.tableKey} -- {chart.aggregationConfig.aggregation}</Badge>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Button variant="ghost" size="sm" onClick={() => rerunChart(chart.id)} title="Re-run">
                      <Play className="size-3.5 text-ct-teal" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeChart(chart.id)}>
                      <Trash2 className="size-3.5 text-ct-error" />
                    </Button>
                  </div>
                </div>
                {results[chart.id] ? (
                  <ChartView chartType={chart.chartType} result={results[chart.id]} />
                ) : (
                  <p className="text-xs text-ct-muted">Loading data...</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
