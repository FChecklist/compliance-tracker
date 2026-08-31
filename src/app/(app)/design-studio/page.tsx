"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// R66 (Sumeet's requirement, PROJEXA-AI.COM): unified "Design Studio" hub.
// Sumeet's 10 required PROJEXA modules (Permits, Drawings & 3D, Documents,
// MoMs, Manpower, Material, Budget, Schedule, Reports, Design Studio) all
// had real nav-wired pages except this one -- the 4 real constituent design
// modules (/floor-plans, /mood-boards, /ffe, /drawings, all built in
// earlier waves -- see each page's own header comment) never had a single
// entry point tying them together. This does NOT duplicate any of their
// editors and does NOT add a 3D/BIM viewer (memory, R63 2026-08-29: "a real
// 3D/BIM viewer and proper design-studio UI need actual design work, not a
// rushed placeholder") -- it is a real, project-scoped dashboard built the
// same list/ProjectPicker shell as its siblings, pulling real counts from
// each of the 4 modules' own existing GET endpoints (each dataset is small
// and already project-scoped, so counting client-side here mirrors how
// ffe/page.tsx already derives its own numbers -- no new aggregate backend
// endpoint needed) and linking into each page with ?projectId= so the
// target page opens pre-selected to the same project (a small, real,
// additive change to those 4 pages' own project-loading effect -- see each
// page's own header comment for that half of this change).
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  LayoutGrid, LayoutPanelLeft, Image as ImageIcon, Sofa, Box, ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type FloorPlan = { id: string };
type MoodBoardItem = { id: string };
type MoodBoard = { id: string; items: MoodBoardItem[] };
type FfeItem = { id: string; status: string };
type Drawing = { id: string; kind: "dwg" | "3d_walkthrough" };
type MarginSummary = { totalCost: number; totalPrice: number; totalMargin: number; marginPercent: number };

const FFE_STATUSES = ["specified", "ordered", "received", "installed"] as const;

export default function DesignStudioPage() {
  const currencies = useCurrencies();
  const money = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([]);
  const [moodBoards, setMoodBoards] = useState<MoodBoard[]>([]);
  const [ffeItems, setFfeItems] = useState<FfeItem[]>([]);
  const [ffeMargin, setFfeMargin] = useState<MarginSummary | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading] = useState(false);

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

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const qs = `projectId=${encodeURIComponent(projectId)}`;
      const [fpRes, mbRes, ffeRes, marginRes, drRes] = await Promise.all([
        fetch(`/api/v1/projexa/floor-plans?${qs}`),
        fetch(`/api/v1/projexa/mood-boards?${qs}`),
        fetch(`/api/v1/projexa/ffe?${qs}`),
        fetch(`/api/v1/projexa/ffe/margin-summary?${qs}`),
        fetch(`/api/v1/projexa/drawings?${qs}`),
      ]);
      const [fpData, mbData, ffeData, marginData, drData] = await Promise.all([
        fpRes.json(), mbRes.json(), ffeRes.json(), marginRes.json(), drRes.json(),
      ]);
      setFloorPlans(fpData.floorPlans ?? []);
      setMoodBoards(mbData.boards ?? []);
      setFfeItems(ffeData.items ?? []);
      setFfeMargin(marginRes.ok ? marginData : null);
      setDrawings(drData.drawings ?? []);
    } catch {
      toast.error("Failed to load Design Studio summary");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const ffeByStatus = FFE_STATUSES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = ffeItems.filter((i) => i.status === s).length;
    return acc;
  }, {});
  const moodBoardItemCount = moodBoards.reduce((sum, b) => sum + b.items.length, 0);
  const dwgCount = drawings.filter((d) => d.kind === "dwg").length;
  const walkthroughCount = drawings.filter((d) => d.kind === "3d_walkthrough").length;

  const linkHref = (path: string) => `${path}?projectId=${encodeURIComponent(projectId)}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy flex items-center gap-2">
          <LayoutGrid className="size-6 text-ct-saffron-text" /> Design Studio
        </h1>
        <p className="text-sm text-ct-muted mt-1">
          One place to see interior-design progress for a project -- floor plans, mood boards, FF&amp;E and drawings/3D, each linking through to its own editor.
        </p>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={LayoutGrid} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card className="rounded-xl shadow-card bg-white">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base text-ct-navy flex items-center gap-2">
                    <LayoutPanelLeft className="size-4 text-ct-saffron-text" /> Floor Plans
                  </CardTitle>
                  <Badge className="text-xs border-0 bg-ct-cloud text-ct-muted">{floorPlans.length}</Badge>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3">
                  <p className="text-sm text-ct-muted">
                    {floorPlans.length === 0 ? "No floor plans yet." : `${floorPlans.length} floor plan${floorPlans.length === 1 ? "" : "s"}.`}
                  </p>
                  <Link href={linkHref("/floor-plans")}>
                    <Button variant="outline" size="sm">Open <ArrowRight className="size-3.5 ml-1" /></Button>
                  </Link>
                </CardContent>
              </Card>

              <Card className="rounded-xl shadow-card bg-white">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base text-ct-navy flex items-center gap-2">
                    <ImageIcon className="size-4 text-ct-saffron-text" /> Mood Boards
                  </CardTitle>
                  <Badge className="text-xs border-0 bg-ct-cloud text-ct-muted">{moodBoards.length}</Badge>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3">
                  <p className="text-sm text-ct-muted">
                    {moodBoards.length === 0
                      ? "No mood boards yet."
                      : `${moodBoards.length} board${moodBoards.length === 1 ? "" : "s"}, ${moodBoardItemCount} item${moodBoardItemCount === 1 ? "" : "s"}.`}
                  </p>
                  <Link href={linkHref("/mood-boards")}>
                    <Button variant="outline" size="sm">Open <ArrowRight className="size-3.5 ml-1" /></Button>
                  </Link>
                </CardContent>
              </Card>

              <Card className="rounded-xl shadow-card bg-white">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base text-ct-navy flex items-center gap-2">
                    <Sofa className="size-4 text-ct-saffron-text" /> FF&amp;E
                  </CardTitle>
                  <Badge className="text-xs border-0 bg-ct-cloud text-ct-muted">{ffeItems.length}</Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  {ffeItems.length === 0 ? (
                    <p className="text-sm text-ct-muted">No FF&amp;E items yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {FFE_STATUSES.filter((s) => ffeByStatus[s] > 0).map((s) => (
                        <Badge key={s} className="text-xs border-0 bg-ct-cloud text-ct-muted capitalize">{ffeByStatus[s]} {s}</Badge>
                      ))}
                    </div>
                  )}
                  {ffeMargin && ffeItems.length > 0 && (
                    <p className="text-xs text-ct-muted">Margin: {money(ffeMargin.totalMargin)} ({ffeMargin.marginPercent.toFixed(1)}%)</p>
                  )}
                  <div className="flex justify-end">
                    <Link href={linkHref("/ffe")}>
                      <Button variant="outline" size="sm">Open <ArrowRight className="size-3.5 ml-1" /></Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-xl shadow-card bg-white">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base text-ct-navy flex items-center gap-2">
                    <Box className="size-4 text-ct-saffron-text" /> Drawings &amp; 3D
                  </CardTitle>
                  <Badge className="text-xs border-0 bg-ct-cloud text-ct-muted">{drawings.length}</Badge>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3">
                  <p className="text-sm text-ct-muted">
                    {drawings.length === 0
                      ? "None added yet."
                      : `${dwgCount} drawing${dwgCount === 1 ? "" : "s"}, ${walkthroughCount} 3D walkthrough${walkthroughCount === 1 ? "" : "s"}.`}
                  </p>
                  <Link href={linkHref("/drawings")}>
                    <Button variant="outline" size="sm">Open <ArrowRight className="size-3.5 ml-1" /></Button>
                  </Link>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
