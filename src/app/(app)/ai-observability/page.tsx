"use client";

// VERIDIAN Review Framework remediation (AI Orchestration observability gap,
// 2026-07-18): "no unified orchestration observability layer... extend
// orchestra-execution-logger.ts into a queryable trace view." kpi-hub's
// "AI Ops" card already surfaces the AGGREGATE numbers (orchestra-analytics-
// service.ts); this page is the missing individual-trace drill-down over
// the same orchestra_executions data, same list+detail pattern as the
// existing Audit Log page.
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { X, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type TraceListItem = {
  id: string;
  layerKey: string;
  eventType: string;
  status: string;
  model: string | null;
  provider: string | null;
  durationMs: number | null;
  costUsd: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: string;
};

type TraceDetail = TraceListItem & {
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  taskId: string | null;
  clientId: string | null;
  userId: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  denied: "bg-amber-100 text-amber-700",
  gated: "bg-purple-100 text-purple-700",
  pending: "bg-gray-100 text-gray-600",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className={cn("text-[10px] px-2 py-0.5 font-medium", STATUS_BADGE[status] ?? "bg-gray-100 text-gray-600")}>
      {status}
    </Badge>
  );
}

export default function AiObservabilityPage() {
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState("all");
  const [layerFilter, setLayerFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const limit = 20;
  const totalPages = Math.ceil(total / limit);

  const updateFilter = (updater: () => void) => {
    setLoading(true);
    updater();
    setPage(1);
  };

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("limit", limit.toString());
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (layerFilter) params.set("layerKey", layerFilter);
    if (modelFilter) params.set("model", modelFilter);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    fetch(`/api/orchestra/traces?${params}`)
      .then((r) => (r.ok ? r.json() : { traces: [], total: 0 }))
      .then((d) => {
        setTraces(d.traces ?? []);
        setTotal(d.total ?? 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, statusFilter, layerFilter, modelFilter, startDate, endDate]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    fetch(`/api/orchestra/traces/${selectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetail)
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const hasFilters = statusFilter !== "all" || layerFilter || modelFilter || startDate || endDate;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">AI Observability</h1>
        <p className="text-sm text-ct-muted mt-1">
          {total} orchestra executions — every real LLM call this org made, filterable and individually inspectable.
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white p-3">
        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
          <Select value={statusFilter} onValueChange={(v) => updateFilter(() => setStatusFilter(v))}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
              <SelectItem value="gated">Gated</SelectItem>
            </SelectContent>
          </Select>

          <Input
            value={layerFilter}
            onChange={(e) => updateFilter(() => setLayerFilter(e.target.value))}
            className="h-9 w-[170px]"
            placeholder="Layer key"
          />
          <Input
            value={modelFilter}
            onChange={(e) => updateFilter(() => setModelFilter(e.target.value))}
            className="h-9 w-[190px]"
            placeholder="Model"
          />
          <Input
            type="date"
            value={startDate}
            onChange={(e) => updateFilter(() => setStartDate(e.target.value))}
            className="h-9 w-[150px]"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => updateFilter(() => setEndDate(e.target.value))}
            className="h-9 w-[150px]"
          />

          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => {
              setStatusFilter("all");
              setLayerFilter("");
              setModelFilter("");
              setStartDate("");
              setEndDate("");
              setPage(1);
            }}>
              <X className="size-3.5 mr-1" /> Clear
            </Button>
          )}
        </div>
      </Card>

      <Card className="rounded-xl shadow-card bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold text-ct-navy">Timestamp</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">Layer</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">Status</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden sm:table-cell">Model</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden md:table-cell">Duration</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden lg:table-cell">Cost</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                    </TableRow>
                  ))
                : traces.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-ct-muted text-sm">
                      No orchestra executions found for these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  traces.map((t) => (
                    <TableRow key={t.id} className="hover:bg-ct-row-hover cursor-pointer" onClick={() => setSelectedId(t.id)}>
                      <TableCell className="text-xs text-ct-muted whitespace-nowrap">
                        {format(new Date(t.createdAt), "dd MMM yyyy, HH:mm:ss")}
                      </TableCell>
                      <TableCell className="text-sm font-medium text-ct-navy">
                        {t.layerKey}
                        <span className="block text-[10px] font-normal text-ct-muted">{t.eventType}</span>
                      </TableCell>
                      <TableCell><StatusBadge status={t.status} /></TableCell>
                      <TableCell className="text-xs text-ct-slate hidden sm:table-cell">
                        {t.model ?? "—"}
                        {t.provider ? <span className="block text-[10px] text-ct-muted">{t.provider}</span> : null}
                      </TableCell>
                      <TableCell className="text-xs text-ct-muted hidden md:table-cell">
                        {t.durationMs !== null ? `${t.durationMs}ms` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-ct-muted hidden lg:table-cell">
                        {t.costUsd !== null ? `$${t.costUsd.toFixed(5)}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="size-7" onClick={(e) => { e.stopPropagation(); setSelectedId(t.id); }}>
                          <Eye className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
            </TableBody>
          </Table>
        </div>

        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-ct-border">
            <p className="text-xs text-ct-muted">
              Page {page} of {totalPages} ({total} executions)
            </p>
            <div className="flex gap-1">
              <Button variant="outline" size="icon" className="size-8" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="icon" className="size-8" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Sheet open={!!selectedId} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Orchestra Trace</SheetTitle>
            <SheetDescription>Full request/response detail for a single AI orchestration call.</SheetDescription>
          </SheetHeader>
          {detailLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : detail ? (
            <div className="p-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-xs text-ct-muted block">Layer</span>{detail.layerKey}</div>
                <div><span className="text-xs text-ct-muted block">Event</span>{detail.eventType}</div>
                <div><span className="text-xs text-ct-muted block">Status</span><StatusBadge status={detail.status} /></div>
                <div><span className="text-xs text-ct-muted block">Model</span>{detail.model ?? "—"} <span className="text-ct-muted">({detail.provider ?? "—"})</span></div>
                <div><span className="text-xs text-ct-muted block">Duration</span>{detail.durationMs !== null ? `${detail.durationMs}ms` : "—"}</div>
                <div><span className="text-xs text-ct-muted block">Cost</span>{detail.costUsd !== null ? `$${detail.costUsd.toFixed(6)}` : "—"}</div>
                <div><span className="text-xs text-ct-muted block">Prompt tokens</span>{detail.promptTokens ?? "—"}</div>
                <div><span className="text-xs text-ct-muted block">Completion tokens</span>{detail.completionTokens ?? "—"}</div>
              </div>
              <div>
                <span className="text-xs text-ct-muted block mb-1">Input</span>
                <pre className="text-[11px] bg-ct-accent/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(detail.input, null, 2)}
                </pre>
              </div>
              <div>
                <span className="text-xs text-ct-muted block mb-1">Output</span>
                <pre className="text-[11px] bg-ct-accent/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
                  {detail.output ? JSON.stringify(detail.output, null, 2) : "(no output)"}
                </pre>
              </div>
            </div>
          ) : (
            <p className="p-4 text-sm text-ct-muted">Trace not found.</p>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
