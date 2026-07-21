"use client";

// audit198 RULE-053 gap closure (wave 6): the public rendering half of
// createReportShareLink/getReportByShareToken (report-share-service.ts).
// Mirrors /shared/meeting/[token]/page.tsx's exact shape/rationale (the
// established public-page pattern in this codebase, outside (app)/ and
// outside middleware's protected-route allowlist -- never move this under
// (app)/), same as that file mirrors /shared/conversation/[token].
//
// Also closes real interactivity into what's shared, addressing RULE-039
// ("every report...shall provide an interactive user experience"): columns
// are sortable client-side and a text filter narrows visible rows -- this
// is genuinely interactive read-only viewing, not a static screenshot-like
// dump of the snapshot.
import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";

type SharedReportResult = {
  columns: string[];
  rows: Record<string, string | number>[];
  narrative?: string;
  note?: string;
};
type SharedReport = {
  name: string;
  description: string | null;
  generatedAt: string;
  result: SharedReportResult;
};

export default function SharedReportPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<SharedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterText, setFilterText] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports/share/${params.token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "This share link is invalid or has expired");
      } else {
        setData(await res.json());
      }
    } catch {
      setError("This share link is invalid or has expired");
    } finally {
      setLoading(false);
    }
  }, [params.token]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleRows = useMemo(() => {
    if (!data) return [];
    let rows = data.result.rows;
    if (filterText.trim()) {
      const needle = filterText.trim().toLowerCase();
      rows = rows.filter((row) => data.result.columns.some((col) => String(row[col] ?? "").toLowerCase().includes(needle)));
    }
    if (sortColumn) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortColumn];
        const bv = b[sortColumn];
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
        return sortAsc ? cmp : -cmp;
      });
    }
    return rows;
  }, [data, filterText, sortColumn, sortAsc]);

  function toggleSort(col: string) {
    if (sortColumn === col) {
      setSortAsc((asc) => !asc);
    } else {
      setSortColumn(col);
      setSortAsc(true);
    }
  }

  return (
    <div className="min-h-screen bg-ct-cream flex items-center justify-center p-6">
      <div className="w-full max-w-3xl rounded-xl border border-ct-border bg-white shadow-card overflow-hidden">
        <div className="bg-gradient-navy px-5 py-4 flex items-center gap-3">
          <Image src="/logo-mark.svg" alt="VERIDIAN AI" width={28} height={28} unoptimized />
          <div>
            <p className="text-white text-sm font-semibold">{data?.name || "Shared Report"}</p>
            <p className="text-white/60 text-[11px]">
              {data ? `Generated ${new Date(data.generatedAt).toLocaleString()} · ` : ""}Read-only, shared from VERIDIAN AI OS Reports
            </p>
          </div>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : error ? (
            <p className="text-sm text-ct-error">{error}</p>
          ) : (
            <>
              {data!.description && <p className="text-sm text-ct-slate">{data!.description}</p>}
              {data!.result.narrative && <p className="text-sm text-ct-slate whitespace-pre-wrap">{data!.result.narrative}</p>}

              {data!.result.rows.length > 0 && (
                <>
                  <input
                    type="text"
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder="Filter rows..."
                    className="w-full rounded-md border border-ct-border px-3 py-1.5 text-sm text-ct-navy placeholder:text-ct-muted focus:outline-none focus:ring-1 focus:ring-ct-saffron"
                  />
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-ct-border">
                          {data!.result.columns.map((col) => (
                            <th
                              key={col}
                              onClick={() => toggleSort(col)}
                              className="text-left px-2 py-1.5 font-semibold text-ct-navy cursor-pointer select-none hover:bg-ct-cloud"
                              title="Click to sort"
                            >
                              {col}
                              {sortColumn === col ? (sortAsc ? " ▲" : " ▼") : ""}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((row, i) => (
                          <tr key={i} className="border-b border-ct-border/50 last:border-0">
                            {data!.result.columns.map((col) => (
                              <td key={col} className="px-2 py-1.5 text-ct-slate">{row[col]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-ct-muted">{visibleRows.length} of {data!.result.rows.length} rows shown</p>
                </>
              )}
              {data!.result.note && <p className="text-xs text-ct-muted italic">{data!.result.note}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
