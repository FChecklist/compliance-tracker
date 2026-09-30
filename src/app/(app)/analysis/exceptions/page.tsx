"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module
// "analysis": native port of PROJEXA's Exceptions report (FChecklist/
// projexa src/app/(app)/analysis/exceptions/page.tsx +
// src/components/ExceptionsClient.tsx). Sumeet requirement (new,
// 2026-09-18): 28 deterministic checks for real-world PM failure modes.
// GET /api/v1/projexa/exceptions?projectId= -> { checks } (route.ts:29-30,
// backed by construction-exceptions-service.ts's getProjectExceptions,
// already returns recordType/linkId per record -- confirmed directly in
// that service's source, same field names PROJEXA's own client expects).
//
// recordHref() below is PROJEXA's own drill-down mapping, corrected for
// what this repo actually has TODAY rather than ported byte-for-byte:
// checked every target directory PROJEXA's version links to
// (`git ls-tree -r` against each of change-orders/scope/work-progress/
// site-diary/materials/labour/punch-list/invoices). Two of PROJEXA's eight
// mapped record types have a real per-record [id] page here already
// (change_order -> /change-orders/[id], boq(_line_item) -> /scope/[id]) and
// keep their real links. The other five PROJEXA links to
// (work_progress_entry, site_diary, material_issue, labour_roster,
// punch_list_item) point at [id] sub-routes that do NOT exist in this repo
// yet -- only each module's list page.tsx has been ported so far, with no
// detail route -- so those five now render as plain non-clickable text
// instead of a fabricated dead link, same discipline PROJEXA's own file
// already applies to vendor_dispute/customer_complaint/invoice_item/date.
// interim_bill -> /invoices?highlight=<id> keeps its link (that route does
// exist), but invoices/page.tsx only reads ?tab=, not ?highlight= -- so it
// opens the real Invoices list, not a highlighted row; noted honestly in
// this module's PR description rather than silently claimed as full parity.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown, CheckCircle2, AlertTriangle, ExternalLink, ListChecks } from "lucide-react";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type ExceptionRecordType =
  | "change_order" | "boq" | "boq_line_item" | "work_progress_entry" | "site_diary"
  | "material_issue" | "labour_roster" | "punch_list_item" | "interim_bill"
  | "vendor_dispute" | "customer_complaint" | "invoice_item" | "date";
type ExceptionRecord = { id: string; detail: string; recordType?: ExceptionRecordType; linkId?: string };
type ExceptionCheck = { item: number; title: string; flagged: boolean; count: number; records: ExceptionRecord[]; formula: string };

/**
 * The real object-screen route for a flagged record in THIS repo today, or
 * null when no per-record screen exists here yet (see header comment for
 * which, and why -- this deliberately differs from PROJEXA's own version).
 */
function recordHref(r: ExceptionRecord): string | null {
  const linkId = r.linkId ?? r.id;
  if (!linkId) return null;
  switch (r.recordType) {
    case "change_order":
      return `/change-orders/${linkId}`;
    case "boq":
      return `/scope/${linkId}`;
    case "boq_line_item":
      return `/scope/${linkId}`; // no per-line screen -- lands on the parent BOQ (linkId), the real "scope" screen
    case "interim_bill":
      return `/invoices?highlight=${linkId}`; // real route, but invoices/page.tsx doesn't read ?highlight= yet -- opens the list, not a highlighted row
    default:
      // work_progress_entry / site_diary / material_issue / labour_roster /
      // punch_list_item: PROJEXA has a per-record screen for these, this
      // repo does not yet (list pages only, no [id] route). vendor_dispute /
      // customer_complaint / invoice_item / "date": no screen anywhere,
      // same as PROJEXA's own reference.
      return null;
  }
}

export default function ExceptionsPage() {
  const router = useRouter();

  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [checks, setChecks] = useState<ExceptionCheck[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: PickerProject[] = d.projects ?? [];
        setProjects(list);
        if (list.length > 0) setProjectId((prev) => prev || list[0].id);
      })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setLoadingProjects(false));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/v1/projexa/exceptions?projectId=${encodeURIComponent(projectId)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to generate the exceptions report");
        if (!cancelled) setChecks(data.checks ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error && err.message ? err.message : "Couldn't load the exceptions report";
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const flaggedCount = checks.filter((c) => c.flagged).length;
  const sorted = [...checks].sort((a, b) => a.item - b.item || a.title.localeCompare(b.title));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Exceptions</h1>
        <p className="text-sm text-ct-muted mt-1">28 deterministic checks for the real-world failure modes construction projects run into.</p>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={ListChecks} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <div className="grid h-32 place-items-center">
              <Loader2 className="size-5 animate-spin text-ct-muted" />
            </div>
          ) : error ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-8 text-center text-sm text-red-600">{error}</CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="flex items-center gap-3 p-4">
                  {flaggedCount === 0 ? (
                    <>
                      <CheckCircle2 className="size-5 text-emerald-600" />
                      <p className="text-sm text-ct-navy">No exceptions found -- all {checks.length} checks are clear.</p>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="size-5 text-red-600" />
                      <p className="text-sm text-ct-navy">
                        <span className="font-medium">{flaggedCount}</span> of {checks.length} checks are flagged on this project.
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="p-0">
                  <ul className="divide-y divide-ct-border">
                    {sorted.map((c) => {
                      const key = `${c.item}-${c.title}`;
                      const expanded = expandedKey === key;
                      return (
                        <li key={key} className="p-4">
                          <button
                            type="button"
                            className="flex w-full items-start justify-between gap-3 text-left"
                            onClick={() => setExpandedKey(expanded ? null : key)}
                            aria-expanded={expanded}
                          >
                            <div className="flex items-start gap-2">
                              {c.count > 0 ? (
                                <ChevronDown className={`mt-0.5 size-3.5 shrink-0 ${expanded ? "" : "-rotate-90"}`} />
                              ) : (
                                <span className="mt-0.5 size-3.5 shrink-0" />
                              )}
                              <div>
                                <p className="font-medium text-ct-navy">
                                  #{c.item} -- {c.title}
                                </p>
                                <p className="text-xs text-ct-muted">{c.formula}</p>
                              </div>
                            </div>
                            <Badge variant={c.flagged ? "destructive" : "outline"} className="shrink-0 text-[10px]">
                              {c.flagged ? `${c.count} flagged` : "Clear"}
                            </Badge>
                          </button>
                          {expanded && c.records.length > 0 && (
                            <ul className="mt-2 space-y-1 pl-6 text-xs text-ct-muted">
                              {c.records.map((r) => {
                                const href = recordHref(r);
                                if (!href) return <li key={r.id}>{r.detail}</li>;
                                return (
                                  <li key={r.id}>
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 text-left text-ct-navy underline decoration-dotted underline-offset-2 hover:decoration-solid"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        router.push(href);
                                      }}
                                      title="Open the real record this exception names"
                                    >
                                      {r.detail}
                                      <ExternalLink className="size-3 shrink-0" />
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
