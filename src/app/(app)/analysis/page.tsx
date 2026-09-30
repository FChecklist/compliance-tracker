"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module
// "analysis": native port of PROJEXA's own /analysis hub (FChecklist/projexa
// src/app/(app)/analysis/page.tsx + src/lib/analysis-screens.ts). PROJEXA's
// reference is a server component that resolves the selected project via
// resolveSelectedProject/getServerOrganizationId -- neither helper exists in
// this repo yet (grepped for both, zero matches), so this page instead
// follows the SAME "use client" + ProjectPicker + /api/projects convention
// every other already-ported PROJEXA module in this repo already uses (see
// change-orders/page.tsx, work-progress/page.tsx, scope/page.tsx) rather
// than introducing a one-off server-side project-resolution helper for a
// single hub page.
//
// The 6-entry list below is ported directly from analysis-screens.ts's
// ENTRIES array (read verbatim, not re-derived) -- 4 entries link to OTHER
// modules already in this repo, 2 link to the new project-360/exceptions
// sub-pages built alongside this page. See this module's PR description for
// an honest per-link check of whether each of the 4 "other module" targets
// actually exists and actually honors the tab/report query param PROJEXA's
// own href construction sends it -- none of that logic lives here, this
// page only builds the same hrefs PROJEXA's analysisScreens() would.
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type AnalysisScreen = {
  key: string;
  label: string;
  description: string;
  path: string;
  query: Record<string, string>;
};

// Verbatim from PROJEXA's analysis-screens.ts ENTRIES (path + query only --
// label/description/needsProject reproduced faithfully).
const ENTRIES: AnalysisScreen[] = [
  {
    key: "work-progress-analytics",
    label: "Work Progress Analytics",
    description: "Logged % and earned % per scope category, with the entries behind each bar.",
    path: "/work-progress",
    query: { tab: "analytics" },
  },
  {
    key: "cost-variance",
    label: "Cost Variance",
    description: "Budget against vendor amount for every BOQ line, worst overrun first.",
    path: "/scope",
    query: { tab: "variance" },
  },
  {
    key: "category-distribution",
    label: "Category distribution",
    description: "Each trade's share of the BOQ and how much of it is complete.",
    path: "/dashboard/project",
    query: {},
  },
  {
    key: "designer-cost",
    label: "Designer cost analysis",
    description: "Hours and cost per designer against their budget line.",
    path: "/reports",
    query: { report: "designer-timesheet" },
  },
  {
    key: "project-360",
    label: "Project 360 Analysis",
    description: "Did we make the margin we quoted, and where did it go -- combined with scope changes, billing milestones and schedule slippage in one place.",
    path: "/analysis/project-360",
    query: {},
  },
  {
    key: "exceptions",
    label: "Exceptions",
    description: "28 deterministic checks -- extra work never billed, stuck approvals, missed daily reports, disputes, retention held, and more.",
    path: "/analysis/exceptions",
    query: {},
  },
];

function screenHref(entry: AnalysisScreen, projectId: string): string {
  const params = new URLSearchParams(entry.query);
  if (projectId) params.set("projectId", projectId);
  const qs = params.toString();
  return qs ? `${entry.path}?${qs}` : entry.path;
}

export default function AnalysisPage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Analysis</h1>
        <p className="text-sm text-ct-muted mt-1">
          {projectId
            ? "Every screen below is scoped to the selected project."
            : "No project is selected, so these screens will open unscoped -- pick a project first."}
        </p>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={BarChart3} />
      ) : (
        <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
      )}

      <div className="max-w-2xl">
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <ul className="divide-y divide-ct-border">
              {ENTRIES.map((entry) => (
                <li key={entry.key}>
                  <Link href={screenHref(entry, projectId)} className="block p-4 hover:bg-ct-cloud/40">
                    <p className="font-medium text-ct-navy">{entry.label}</p>
                    <p className="text-xs text-ct-muted mt-0.5">{entry.description}</p>
                    {!projectId && (
                      <p className="text-xs text-ct-muted mt-1 italic">Opens without a project until one is selected.</p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
