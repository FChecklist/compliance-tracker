"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own KPIs list (src/app/(app)/kpis/page.tsx + KpisClient.tsx
// there). Reads the SAME /api/v1/construction/kpi-definitions this app's
// backend already exposes (re-exported verbatim under
// /api/v1/projexa/kpis -- see that route's own one-line re-export) --
// zero new backend route, zero HTTP hop to a separate origin.
//
// UI is compliance-tracker's own shadcn Table/Card/Select (matching the
// house convention every already-ported construction-* page uses -- see
// permits/page.tsx and projects/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ScreenFrame/ListScreen -- porting the DATA
// and BEHAVIOUR, not the exact component tree.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type KpiDefinition = { id: string; metricName: string; targetValue: string | null; unit: string | null; period: string };

export default function KpisPage() {
  const router = useRouter();

  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [definitions, setDefinitions] = useState<KpiDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const loadDefinitions = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/v1/construction/kpi-definitions?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Couldn't load KPIs (HTTP ${res.status})`);
      setDefinitions(data?.definitions ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't load KPIs";
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadDefinitions(); }, [loadDefinitions]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">KPIs</h1>
          <p className="text-sm text-ct-muted mt-1">Key performance indicators tracked per project -- target vs. actual, submitted and approved per period.</p>
        </div>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          disabled={!projectId}
          onClick={() => router.push(`/kpis/new?projectId=${projectId}`)}
        >
          <Plus className="size-4 mr-1" /> New KPI
        </Button>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={Target} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
          ) : loadError ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-10 pb-10 text-center space-y-3">
                <p className="text-sm text-red-600">{loadError}</p>
                <Button variant="outline" size="sm" onClick={() => loadDefinitions()}>Retry</Button>
              </CardContent>
            </Card>
          ) : definitions.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No KPIs defined for this project yet.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Metric</TableHead><TableHead>Target</TableHead><TableHead>Period</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {definitions.map((d) => (
                      <TableRow key={d.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/kpis/${d.id}`)}>
                        <TableCell className="flex items-center gap-2 font-medium text-ct-navy">
                          <Target className="size-4 text-ct-muted" />{d.metricName}
                        </TableCell>
                        <TableCell className="text-ct-muted">{d.targetValue ? `${d.targetValue}${d.unit ? ` ${d.unit}` : ""}` : "--"}</TableCell>
                        <TableCell><Badge variant="outline">{d.period}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
