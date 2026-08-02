"use client";

// Priority 17 remaining gap (Reports & Analysis consuming UI, 2026-07-16):
// this is the real "run it and see the result" panel for one
// report_definitions-backed catalog entry. It calls the PRE-EXISTING
// POST /api/reports/definitions/[id]/run route (executeReportDefinition()
// in report-engine-service.ts) -- no execution logic lives here, this is a
// pure consumer.
//
// Honesty note baked into the design, not worked around: executeReportDefinition
// returns the SAME ReportDefinitionResult shape ({columns,rows,narrative?,note?})
// for every execution_type (deterministic_aggregation/deterministic_formula/
// ai_recipe/external_service) AND for a non-"built" definition (it returns a
// clean {columns:["Note"],rows:[{Note:"not yet built"}]} rather than erroring)
// -- so this component does not need to special-case execution type or status
// at all; it renders whatever real shape comes back, honestly, including the
// "not built yet" case. The one thing it cannot know ahead of time is which
// deterministic_formula definitions require a projectId (report_definitions
// has no formal per-row required-params schema) -- rather than silently
// guessing, a 400 error naming the missing param is shown verbatim and an
// optional "Project ID" field is offered so the user can retry.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { CompanySelector, useCompanies } from "@/components/CompanySelector";
import { PlayCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

type ReportDefinitionResult = {
  columns: string[];
  rows: Record<string, string | number>[];
  narrative?: string;
  note?: string;
};

export function ReportDefinitionRunner({
  definitionId,
  supportsCompanyScope,
}: {
  definitionId: string;
  supportsCompanyScope: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReportDefinitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const companies = useCompanies(supportsCompanyScope);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {};
      if (projectId.trim()) params.projectId = projectId.trim();
      if (supportsCompanyScope && companyId) params.companyId = companyId;
      const res = await fetch(`/api/reports/definitions/${definitionId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to run this report/analysis.");
        toast.error(data.error ?? "Failed to run this report/analysis.");
        return;
      }
      setResult(data as ReportDefinitionResult);
    } catch {
      setError("Network error while running this report/analysis.");
    } finally {
      setRunning(false);
    }
  };

  const columns: ColumnDef<Record<string, string | number>, string | number>[] = (result?.columns ?? []).map((c) => ({
    accessorKey: c,
    header: c,
  }));

  return (
    <div className="mt-2 space-y-2 rounded-md border border-dashed border-ct-border p-2.5 bg-muted/20">
      <div className="flex flex-wrap items-end gap-2">
        {supportsCompanyScope && (
          <CompanySelector companies={companies} companyId={companyId} onChange={setCompanyId} />
        )}
        {showAdvanced ? (
          <div className="space-y-1">
            <Label className="text-xs">Project ID (only needed for some project-scoped reports)</Label>
            <Input
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="optional"
              className="h-8 w-52 text-xs"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdvanced(true)}
            className="text-[11px] text-ct-muted underline underline-offset-2 hover:text-ct-navy pb-1.5"
          >
            + Add Project ID (if this report needs one)
          </button>
        )}
        <Button size="sm" onClick={run} disabled={running} className="gap-1.5">
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />}
          {running ? "Running..." : result ? "Run Again" : "Run"}
        </Button>
      </div>

      {running && (
        <div className="space-y-1.5 pt-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}

      {!running && error && (
        <p className="text-xs text-ct-error bg-red-50 border border-red-200 rounded p-2">{error}</p>
      )}

      {!running && result && (
        <div className="space-y-2 pt-1">
          {result.narrative && (
            <p className="text-xs text-ct-navy italic bg-white rounded p-2 border border-ct-border">{result.narrative}</p>
          )}
          {result.rows.length > 0 ? (
            <div className="bg-white rounded border border-ct-border">
              <DataTable columns={columns} data={result.rows} />
            </div>
          ) : (
            <p className="text-xs text-ct-muted">No rows returned.</p>
          )}
          {result.note && <p className="text-[11px] text-ct-muted">{result.note}</p>}
        </div>
      )}
    </div>
  );
}
