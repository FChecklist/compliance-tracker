"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own Meetings/MOM (Minutes of Meeting) list
// (src/app/(app)/meetings/page.tsx + MeetingsClient.tsx there, Wave 141).
// Reads the SAME /api/v1/projexa/meetings this app's backend already serves
// (a thin alias over pms-meeting-service.ts's listMeetings()) -- zero new
// backend route, zero HTTP hop to a separate origin. Manual CRUD only -- the
// AI voice-to-MOM capture flow (GAP-MOM-VOICE-TICKETS) is a separate,
// still-pending item, out of scope for this port.
//
// UI is compliance-tracker's own shadcn Table/Card/ProjectPicker (matching
// the house convention every already-ported construction-* page uses -- see
// permits/page.tsx and kpis/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ScreenFrame/ListScreen -- porting the DATA and
// BEHAVIOUR, not the exact component tree.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type Meeting = {
  id: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number | null;
};

export default function MeetingsPage() {
  const router = useRouter();

  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [meetings, setMeetings] = useState<Meeting[]>([]);
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

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/v1/projexa/meetings?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Couldn't load meetings (HTTP ${res.status})`);
      setMeetings(data?.meetings ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't load meetings";
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Meetings</h1>
          <p className="text-sm text-ct-muted mt-1">Project meetings, agenda items, participants and minutes -- scheduled per project.</p>
        </div>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          disabled={!projectId}
          onClick={() => router.push(`/meetings/new?projectId=${projectId}`)}
        >
          <Plus className="size-4 mr-1" /> New Meeting
        </Button>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={CalendarClock} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
          ) : loadError ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-10 pb-10 text-center space-y-3">
                <p className="text-sm text-red-600">{loadError}</p>
                <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
              </CardContent>
            </Card>
          ) : meetings.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No meetings scheduled yet.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Title</TableHead><TableHead>When</TableHead><TableHead>Duration</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {meetings.map((m) => (
                      <TableRow key={m.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/meetings/${m.id}`)}>
                        <TableCell className="font-medium text-ct-navy">{m.title}</TableCell>
                        <TableCell className="text-ct-muted">{new Date(m.scheduledAt).toLocaleString()}</TableCell>
                        <TableCell className="text-ct-muted">{m.durationMinutes ? `${m.durationMinutes} min` : "—"}</TableCell>
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
