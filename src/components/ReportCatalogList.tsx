"use client";

// Reads REPORT_CATALOG (report-catalog-service.ts) -- the unified registry
// of every report/analysis type that actually exists today across the 4
// report-producing services (custom, ERP financial, construction/PROJEXA,
// AI-ops cadence reports). Purely a listing/navigation surface: it does not
// run or re-implement any report, it links to each entry's own real route.
// A cron-only route (the 4 AI-ops reports) or a param-requiring API route
// with no dedicated UI page (the 17 construction reports) is shown as
// plain text with its routeNote instead of a clickable Link -- clicking
// through to those would just produce a 401/400 in the browser, so this
// stays honest about what's actually clickable today rather than offering
// a link that's guaranteed to error.
import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { REPORT_CATALOG, listReportCatalogByDomain, type ReportDomain } from "@/lib/services/report-catalog-service";

const DOMAIN_LABELS: Record<ReportDomain, string> = {
  compliance: "Compliance",
  ERP: "ERP / Finance",
  construction: "Construction (PROJEXA)",
  "AI-ops": "AI Ops",
  custom: "Custom Reports",
};

const DOMAIN_ORDER: ReportDomain[] = ["compliance", "ERP", "construction", "AI-ops", "custom"];

export default function ReportCatalogList() {
  const byDomain = listReportCatalogByDomain();

  return (
    <Card id="report-catalog" className="rounded-xl shadow-card bg-white scroll-mt-24">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
          <FileBarChart className="size-4 text-ct-teal" />
          Report &amp; Analysis Catalog
        </CardTitle>
        <p className="text-xs text-ct-muted">
          Every report type across the platform ({REPORT_CATALOG.length} total) — grouped by domain, linking to where each one actually runs today.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {DOMAIN_ORDER.filter((domain) => byDomain[domain].length > 0).map((domain) => (
          <div key={domain}>
            <p className="text-xs font-semibold text-ct-muted uppercase tracking-wide mb-2">
              {DOMAIN_LABELS[domain]}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {byDomain[domain].map((entry) => (
                <div key={entry.id} className="rounded-lg border border-ct-border p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    {entry.directlyNavigable ? (
                      <Link
                        href={entry.route}
                        className="text-sm font-medium text-ct-navy hover:text-ct-saffron transition-colors"
                      >
                        {entry.name}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-ct-navy">{entry.name}</span>
                    )}
                    {!entry.directlyNavigable && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">API only</Badge>
                    )}
                  </div>
                  <p className="text-xs text-ct-muted mb-1.5">{entry.description}</p>
                  <p className="text-[10.5px] text-ct-muted/80 font-mono break-all">{entry.route}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
