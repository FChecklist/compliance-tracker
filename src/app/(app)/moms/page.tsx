"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module 22/24:
// Minutes of Meeting (moms) list. Ported from PROJEXA's own
// src/app/(app)/moms/page.tsx + MoMsClient.tsx, rebuilt on this repo's own
// established house pattern (single "use client" page + ProjectPicker,
// see change-orders/page.tsx and billing-milestones/page.tsx) rather than
// PROJEXA's own multi-lane server/Suspense/registry-column/shell-chain
// architecture -- @fchecklist/veridian-ui-kit and the shell "door"/composer
// system that architecture depends on do not exist in this repo.
//
// CONFIRMED BACKEND CONTRACT (read directly from the real route/service
// files, not assumed from PROJEXA's client): PROJEXA's /api/moms maps here
// to /api/v1/projexa/veri-meetings, backed by veri-meeting-service.ts -- the
// real live-meeting-notes engine (AI summary, publish/lock, minutes
// amend-history). NOT /api/v1/projexa/meetings, which is a separate, older,
// basic-scheduling-only module (pms-meeting-service.ts, already used by this
// repo's own /meetings pages) with no AI/publish/minutes workflow at all.
//
// listVeriMeetings() (GET .../veri-meetings?projectId=) already returns two
// aggregates the list needs with no extra round trip: attendeesCount and
// openActionItems (open = a linked task not completed/cancelled).
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, NotebookText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type MeetingRow = {
  id: string;
  title: string;
  scheduledAt: string;
  status: string;
  attendeesCount: number;
  openActionItems: number;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-ct-cloud text-ct-muted",
  published: "bg-green-100 text-green-700",
};

export default function MoMsPage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
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
      const res = await fetch(`/api/v1/projexa/veri-meetings?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      const data = await res.json();
      setMeetings(data.meetings ?? []);
    } catch {
      toast.error("Failed to load minutes of meeting");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Minutes of Meeting</h1>
          <p className="text-sm text-ct-muted mt-1">
            Live meeting notes with AI summary, key decisions and action items -- published minutes are locked.
          </p>
        </div>
        <Button asChild className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
          <Link href={projectId ? `/moms/new?projectId=${encodeURIComponent(projectId)}` : "#"}>
            <Plus className="size-4 mr-1" /> New Meeting
          </Link>
        </Button>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={NotebookText} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : meetings.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No minutes of meeting yet for this project.</CardContent>
            </Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Meeting</TableHead>
                      <TableHead>Date &amp; time</TableHead>
                      <TableHead className="text-right">Attendees</TableHead>
                      <TableHead className="text-right">Open actions</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {meetings.map((m) => (
                      <TableRow key={m.id} className="cursor-pointer hover:bg-ct-cloud/40">
                        <TableCell className="font-medium text-ct-navy">
                          <Link href={`/moms/${m.id}`} className="flex items-center gap-2">
                            <NotebookText className="size-4 text-ct-muted" />
                            {m.title}
                          </Link>
                        </TableCell>
                        <TableCell className="text-ct-muted">
                          <Link href={`/moms/${m.id}`} className="block">
                            {new Date(m.scheduledAt).toLocaleString()}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-ct-muted">{m.attendeesCount}</TableCell>
                        <TableCell className="text-right tabular-nums text-ct-muted">{m.openActionItems}</TableCell>
                        <TableCell>
                          <Badge className={`text-xs border-0 ${STATUS_COLORS[m.status] ?? "bg-ct-cloud text-ct-muted"}`}>
                            {m.status}
                          </Badge>
                        </TableCell>
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
