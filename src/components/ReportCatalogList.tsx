"use client";

// Priority 17 remaining gap (Reports and Analysis consuming UI, 2026-07-16):
// this was previously a pure, static, non-executing nav list over
// REPORT_CATALOG (26 hand-catalogued entries across the 4 pre-Priority-11
// report services). Extended, not replaced: it now fetches the real MERGED
// catalog (GET /api/reports/catalog -> getFullReportCatalog(), report-engine-
// service.ts) -- REPORT_CATALOG's 26 entries PLUS the roughly 200 live
// report_definitions rows the Reports and Analysis Engine (Priority 11) can
// already execute end-to-end but that, until now, no page anywhere rendered.
//
// Two distinct behaviors, by entry.source:
//  - static     -- unchanged from before: a Link if directlyNavigable,
//                  otherwise plain text plus an "API only" badge. These are
//                  the 4 pre-existing hand-written report services --
//                  this component still does not re-implement or re-run
//                  them, only links to where they already run.
//  - definition -- NEW: an inline "Run" toggle backed by
//                  ReportDefinitionRunner.tsx, which calls the pre-existing
//                  POST /api/reports/definitions/[id]/run
//                  (executeReportDefinition dispatcher) and renders the
//                  real result. No second execution engine here.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileBarChart, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReportCatalogEntry, ReportDomain } from "@/lib/services/report-catalog-service";
import { ReportDefinitionRunner } from "@/components/ReportDefinitionRunner";

// Local mirror of report-engine-service.ts's FullCatalogEntry -- deliberately
// NOT imported from there (that file is server-only: it imports db and LLM
// clients). report-catalog-service.ts's own header explains why a db-touching
// import once broke this exact client component's production build (pulled
// the postgres driver into the browser bundle) -- this type-only mirror
// avoids reintroducing that risk while staying structurally identical to the
// real server type.
type FullCatalogEntry = ReportCatalogEntry & {
  source: "static" | "definition";
  definitionId?: string;
  status?: "built" | "data_gap" | "planned";
  supportsCompanyScope?: boolean;
};

const DOMAIN_LABELS: Record<ReportDomain, string> = {
  compliance: "Compliance",
  ERP: "ERP / Finance",
  construction: "Construction (PROJEXA)",
  "AI-ops": "AI Ops",
  custom: "Custom Reports",
};

const DOMAIN_ORDER: ReportDomain[] = ["compliance", "ERP", "construction", "AI-ops", "custom"];

const STATUS_FILTERS = ["all", "built", "data_gap", "planned"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  built: "Built",
  data_gap: "Data Gap",
  planned: "Planned",
};

function StatusBadge({ status }: { status?: "built" | "data_gap" | "planned" }) {
  if (!status || status === "built") return null;
  return (
    <Badge variant="outline" className={`text-[10px] shrink-0 ${status === "data_gap" ? "border-amber-400 text-amber-700" : "border-slate-400 text-slate-600"}`}>
      {status === "data_gap" ? "Data Gap" : "Planned"}
    </Badge>
  );
}

function CatalogCard({ entry }: { entry: FullCatalogEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-ct-border p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        {entry.source === "static" && entry.directlyNavigable ? (
          <Link href={entry.route} className="text-sm font-medium text-ct-navy hover:text-ct-saffron transition-colors">
            {entry.name}
          </Link>
        ) : (
          <span className="text-sm font-medium text-ct-navy">{entry.name}</span>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={entry.status} />
          {entry.source === "static" && !entry.directlyNavigable && (
            <Badge variant="secondary" className="text-[10px]">API only</Badge>
          )}
          {entry.source === "definition" && (
            <Badge variant="secondary" className="text-[10px] bg-ct-teal/10 text-ct-teal border-ct-teal/30">Engine</Badge>
          )}
        </div>
      </div>
      <p className="text-xs text-ct-muted mb-1.5">{entry.description}</p>

      {entry.source === "static" ? (
        <p className="text-[10.5px] text-ct-muted/80 font-mono break-all">{entry.route}</p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-ct-teal hover:text-ct-navy transition-colors"
          >
            {expanded ? "Hide" : "Run this report"}
          </button>
          {expanded && entry.definitionId && (
            <ReportDefinitionRunner definitionId={entry.definitionId} supportsCompanyScope={Boolean(entry.supportsCompanyScope)} />
          )}
        </>
      )}
    </div>
  );
}

export default function ReportCatalogList() {
  const [catalog, setCatalog] = useState<FullCatalogEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    fetch("/api/reports/catalog")
      .then((r) => r.json())
      .then((d) => setCatalog(Array.isArray(d.catalog) ? d.catalog : []))
      .catch(() => setCatalog([]));
  }, []);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    return catalog.filter((e) => {
      if (statusFilter !== "all" && (e.status ?? "built") !== statusFilter) return false;
      if (q && !e.name.toLowerCase().includes(q) && !e.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [catalog, search, statusFilter]);

  const byDomain = useMemo(() => {
    const grouped: Record<ReportDomain, FullCatalogEntry[]> = { compliance: [], ERP: [], construction: [], "AI-ops": [], custom: [] };
    for (const entry of filtered) grouped[entry.domain].push(entry);
    return grouped;
  }, [filtered]);

  const definitionCount = catalog?.filter((e) => e.source === "definition").length ?? 0;
  const builtCount = catalog?.filter((e) => e.source === "definition" && (e.status ?? "built") === "built").length ?? 0;

  return (
    <Card id="report-catalog" className="rounded-xl shadow-card bg-white scroll-mt-24">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
          <FileBarChart className="size-4 text-ct-teal" />
          Report and Analysis Catalog
        </CardTitle>
        <p className="text-xs text-ct-muted">
          {catalog === null
            ? "Loading the full catalog..."
            : `${catalog.length} total across the platform -- ${definitionCount} run live through the Reports and Analysis Engine (${builtCount} built, ${definitionCount - builtCount} still a real, honestly-flagged data gap or planned), plus the ${catalog.length - definitionCount} pre-existing report services below, grouped by domain.`}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <div className="relative w-64">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-ct-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports and analyses..."
              className="h-8 pl-7 text-xs"
            />
          </div>
          <div className="flex gap-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                  statusFilter === s ? "bg-ct-navy text-white border-ct-navy" : "border-ct-border text-ct-muted hover:bg-muted/50"
                }`}
              >
                {STATUS_FILTER_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {catalog === null && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {catalog !== null && filtered.length === 0 && (
          <p className="text-sm text-ct-muted py-6 text-center">No reports or analyses match this search and filter.</p>
        )}
        {DOMAIN_ORDER.filter((domain) => byDomain[domain].length > 0).map((domain) => (
          <div key={domain}>
            <p className="text-xs font-semibold text-ct-muted uppercase tracking-wide mb-2">
              {DOMAIN_LABELS[domain]} ({byDomain[domain].length})
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {byDomain[domain].map((entry) => (
                <CatalogCard key={`${entry.source}-${entry.id}`} entry={entry} />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
