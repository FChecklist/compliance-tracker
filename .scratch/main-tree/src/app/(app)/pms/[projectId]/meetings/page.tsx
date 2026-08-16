"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import ProjectNav from "@/components/pms/ProjectNav";

type Meeting = { id: string; title: string; scheduledAt: string; durationMinutes: number | null };
type MeetingDetail = Meeting & {
  agendaItems: Array<{ id: string; title: string }>;
  outcomes: Array<{ id: string; notes: string | null; createdAt: string }>;
};

export default function MeetingsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [projectName, setProjectName] = useState("");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [details, setDetails] = useState<Record<string, MeetingDetail>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [agendaText, setAgendaText] = useState("");
  const [creating, setCreating] = useState(false);
  const [outcomeMeetingId, setOutcomeMeetingId] = useState<string | null>(null);
  const [outcomeNotes, setOutcomeNotes] = useState("");

  const load = useCallback(async () => {
    const [projectRes, meetingsRes] = await Promise.all([
      fetch(`/api/projects/${projectId}`),
      fetch(`/api/pms/meetings?projectId=${projectId}`),
    ]);
    const [project, meetingsData] = await Promise.all([projectRes.json(), meetingsRes.json()]);
    setProjectName(project.name ?? "Project");
    const meetingList: Meeting[] = meetingsData.meetings ?? [];
    setMeetings(meetingList);

    const entries = await Promise.all(
      meetingList.map(async (m) => {
        const r = await fetch(`/api/pms/meetings/${m.id}`);
        const d = await r.json();
        return [m.id, d] as const;
      })
    );
    setDetails(Object.fromEntries(entries));
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const createMeeting = async () => {
    if (!title.trim() || !scheduledAt) return;
    setCreating(true);
    try {
      const agendaItems = agendaText.split("\n").map((s) => s.trim()).filter(Boolean);
      const res = await fetch("/api/pms/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title, scheduledAt: new Date(scheduledAt).toISOString(), agendaItems }),
      });
      if (!res.ok) throw new Error();
      toast.success("Meeting created");
      setOpen(false);
      setTitle("");
      setScheduledAt("");
      setAgendaText("");
      load();
    } catch {
      toast.error("Failed to create meeting");
    } finally {
      setCreating(false);
    }
  };

  const addOutcome = async (meetingId: string) => {
    if (!outcomeNotes.trim()) return;
    try {
      const res = await fetch(`/api/pms/meetings/${meetingId}/outcomes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: outcomeNotes }),
      });
      if (!res.ok) throw new Error();
      setOutcomeMeetingId(null);
      setOutcomeNotes("");
      load();
    } catch {
      toast.error("Failed to add outcome");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ProjectNav projectId={projectId} projectName={projectName} />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              <Plus className="size-4 mr-2" />
              New Meeting
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Meeting</DialogTitle>
              <DialogDescription>Schedule a new project meeting.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sprint Planning" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Date & Time</Label>
                <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Agenda (one item per line)</Label>
                <Textarea value={agendaText} onChange={(e) => setAgendaText(e.target.value)} placeholder={"Review last sprint\nPlan next sprint"} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createMeeting} disabled={creating || !title.trim() || !scheduledAt} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Meeting
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : meetings.length === 0 ? (
        <p className="text-sm text-ct-muted py-10 text-center">No meetings yet. Schedule the first one.</p>
      ) : (
        <div className="space-y-4">
          {meetings.map((meeting) => {
            const detail = details[meeting.id];
            return (
              <Card key={meeting.id} className="rounded-xl shadow-card bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                    <Calendar className="size-4 text-ct-teal" />
                    {meeting.title}
                  </CardTitle>
                  <p className="text-xs text-ct-muted">{new Date(meeting.scheduledAt).toLocaleString()}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail?.agendaItems?.length ? (
                    <div>
                      <p className="text-xs text-ct-muted uppercase mb-1">Agenda</p>
                      <ul className="list-disc list-inside text-sm text-ct-navy space-y-0.5">
                        {detail.agendaItems.map((a) => <li key={a.id}>{a.title}</li>)}
                      </ul>
                    </div>
                  ) : null}

                  {detail?.outcomes?.length ? (
                    <div>
                      <p className="text-xs text-ct-muted uppercase mb-1">Outcomes / Minutes</p>
                      {detail.outcomes.map((o) => (
                        <p key={o.id} className="text-sm text-ct-slate">{o.notes}</p>
                      ))}
                    </div>
                  ) : null}

                  {outcomeMeetingId === meeting.id ? (
                    <div className="flex items-center gap-2 pt-2">
                      <Input placeholder="Meeting notes / outcome" value={outcomeNotes} onChange={(e) => setOutcomeNotes(e.target.value)} className="h-8" />
                      <Button size="sm" onClick={() => addOutcome(meeting.id)}>Add</Button>
                      <Button size="sm" variant="ghost" onClick={() => setOutcomeMeetingId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setOutcomeMeetingId(meeting.id)}>
                      <Plus className="size-3.5 mr-1.5" />
                      Add Outcome
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
