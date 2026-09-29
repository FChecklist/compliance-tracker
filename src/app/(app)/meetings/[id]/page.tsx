"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own MeetingObjectClient.tsx -- the meeting detail/Object Page
// (agenda items, participants, minutes/outcomes), plus the Edit flow
// PROJEXA's "real-screen conversion" (2026-08-30) added on top of it.
// Reads/writes the SAME GET/PATCH /api/v1/projexa/meetings/{id} and
// POST /api/v1/projexa/meetings/{id}/outcomes this app's backend already
// serves (thin aliases over pms-meeting-service.ts's getMeeting()/
// updateMeeting()/addMeetingOutcome()) -- zero new backend route.
//
// Rebuilt on this repo's own Card/Table/Badge, not PROJEXA's forked
// ObjectScreen (@fchecklist/veridian-ui-kit) -- see
// src/app/(app)/meetings/page.tsx's header comment for the house convention
// this follows. Agenda items and participants stay read-only here, matching
// PROJEXA's own screen -- no update-agenda/add-participant endpoint exists
// on the backend (pms-meeting-service.ts has none), so none is faked. There
// is also no Delete/Cancel action: no status/isCancelled column exists on
// pms_meetings (see updateMeeting()'s own comment in that service file).
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type AgendaItem = { id: string; position: number; title: string; issueId: string | null; durationMinutes: number | null };
type Outcome = { id: string; notes: string | null; createdAt: string };
type Participant = { id: string; userId: string; responseStatus: string | null };
type MeetingDetail = {
  id: string; projectId: string; title: string; scheduledAt: string; durationMinutes: number | null;
  agendaItems: AgendaItem[]; outcomes: Outcome[]; participants: Participant[];
};

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in local time, not an ISO
// string with a Z/offset -- same conversion PROJEXA's own MeetingObjectClient
// used (toLocalInputValue).
function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MeetingDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const meetingId = params.id;

  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ title: "", scheduledAt: "", durationMinutes: "" });
  const [saving, setSaving] = useState(false);
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [addingOutcome, setAddingOutcome] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/meetings/${encodeURIComponent(meetingId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load this meeting");
      setDetail(data as MeetingDetail);
      setLoadError(null);
    } catch (err) {
      setDetail(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this meeting");
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => { void load(); }, [load]);

  const startEdit = () => {
    if (!detail) return;
    setDraft({
      title: detail.title,
      scheduledAt: toLocalInputValue(detail.scheduledAt),
      durationMinutes: detail.durationMinutes ? String(detail.durationMinutes) : "",
    });
    setMode("edit");
  };

  const saveEdit = async () => {
    if (!draft.title.trim() || !draft.scheduledAt) { toast.error("Title and date/time are required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projexa/meetings/${encodeURIComponent(meetingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          scheduledAt: new Date(draft.scheduledAt).toISOString(),
          durationMinutes: draft.durationMinutes ? Number(draft.durationMinutes) : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't save this meeting");
      toast.success("Meeting saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save this meeting");
    } finally {
      setSaving(false);
    }
  };

  const addOutcome = async () => {
    if (!outcomeNotes.trim()) return;
    setAddingOutcome(true);
    try {
      const res = await fetch(`/api/v1/projexa/meetings/${encodeURIComponent(meetingId)}/outcomes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: outcomeNotes }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't add this outcome");
      toast.success("Outcome recorded");
      setOutcomeNotes("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add this outcome");
    } finally {
      setAddingOutcome(false);
    }
  };

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  if (loadError) return (
    <div className="space-y-3">
      <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">Could not load this meeting: {loadError}</CardContent></Card>
      <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
    </div>
  );
  if (!detail) return <p className="py-10 text-center text-sm text-ct-muted">Meeting not found.</p>;

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push(`/meetings?projectId=${detail.projectId}`)}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Meetings
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-heading text-ct-navy">{mode === "edit" ? "Edit Meeting" : detail.title}</h1>
          {mode === "display" && (
            <Button variant="outline" size="sm" onClick={startEdit}>Edit</Button>
          )}
        </div>
        {mode === "display" && (
          <p className="text-sm text-ct-muted mt-1">
            {new Date(detail.scheduledAt).toLocaleString()} &middot; {detail.durationMinutes ? `${detail.durationMinutes} min` : "No duration set"}
          </p>
        )}
      </div>

      {mode === "edit" ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Meeting details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
              <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Date &amp; time</Label>
                <Input type="datetime-local" value={draft.scheduledAt} onChange={(e) => setDraft((d) => ({ ...d, scheduledAt: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Duration (minutes)</Label>
                <Input type="number" value={draft.durationMinutes} onChange={(e) => setDraft((d) => ({ ...d, durationMinutes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setMode("display")} disabled={saving}>Cancel</Button>
              <Button
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
                onClick={saveEdit}
                disabled={saving || !draft.title.trim() || !draft.scheduledAt}
              >
                {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Save
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Agenda ({detail.agendaItems.length})</CardTitle></CardHeader>
            <CardContent>
              {detail.agendaItems.length === 0 ? (
                <p className="text-sm text-ct-muted">No agenda items.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm text-ct-navy">
                  {detail.agendaItems.map((a) => <li key={a.id}>{a.title}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy flex items-center gap-1.5"><Users className="size-4" /> Participants ({detail.participants.length})</CardTitle></CardHeader>
            <CardContent>
              {detail.participants.length === 0 ? (
                <p className="text-sm text-ct-muted">No participants added.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {detail.participants.map((p) => (
                    <Badge key={p.id} variant="outline">{p.userId} &middot; {p.responseStatus ?? "pending"}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Minutes / Outcomes ({detail.outcomes.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {detail.outcomes.length === 0 ? (
                <p className="text-sm text-ct-muted">No outcomes recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Notes</TableHead><TableHead>Recorded</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {detail.outcomes.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>{o.notes}</TableCell>
                        <TableCell className="text-ct-muted">{new Date(o.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="space-y-2 pt-2">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Add an outcome</Label>
                <Textarea
                  value={outcomeNotes}
                  onChange={(e) => setOutcomeNotes(e.target.value)}
                  rows={2}
                  placeholder="Record a decision, action item, or minutes note..."
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={addOutcome} disabled={addingOutcome || !outcomeNotes.trim()}>
                    {addingOutcome ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null} Add Outcome
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
