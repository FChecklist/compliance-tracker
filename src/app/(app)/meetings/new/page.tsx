"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own MeetingCreateClient.tsx (src/app/(app)/meetings/new/page.tsx
// there), rebuilt on compliance-tracker's own shadcn Card/Input/Textarea
// instead of PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen -- same
// house convention as src/app/(app)/kpis/new/page.tsx. POSTs to the same
// POST /api/v1/projexa/meetings this app's backend already serves (a thin
// alias over pms-meeting-service.ts's createMeeting()).
//
// Participants are collected as comma-separated VERIDIAN user IDs, matching
// PROJEXA's own form verbatim -- that screen has no org-directory/user
// picker either ("No org directory/picker yet -- paste known VERIDIAN user
// IDs"), and no such picker exists anywhere in this repo's own UI yet, so
// none is invented here as part of a UI-only port.
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function NewMeetingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") ?? "";

  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [agendaText, setAgendaText] = useState("");
  const [participantIds, setParticipantIds] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const backHref = projectId ? `/meetings?projectId=${projectId}` : "/meetings";
  const missing = [...(title.trim() ? [] : ["Title"]), ...(scheduledAt ? [] : ["Date & time"])];

  const createMeeting = async () => {
    if (!projectId) { toast.error("No project selected"); return; }
    if (missing.length) { toast.error(`${missing.join(", ")} required`); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: title.trim(),
          scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
          agendaItems: agendaText.split("\n").map((l) => l.trim()).filter(Boolean),
          participantUserIds: participantIds.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create meeting");
      toast.success("Meeting created");
      router.push(`/meetings/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create meeting");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Meeting</h1>
        <p className="text-sm text-ct-muted mt-1">Meetings / New Meeting</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Meeting details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly site coordination" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Date &amp; time</Label>
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Duration (minutes)</Label>
              <Input type="number" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} placeholder="60" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Agenda items (one per line, optional)</Label>
            <Textarea
              value={agendaText}
              onChange={(e) => setAgendaText(e.target.value)}
              rows={3}
              placeholder={"Review open RFIs\nSite safety walkthrough"}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Participant user IDs (comma-separated, optional)</Label>
            <Input value={participantIds} onChange={(e) => setParticipantIds(e.target.value)} placeholder="usr_abc123, usr_def456" />
            <p className="text-xs text-ct-muted">No org directory/picker yet -- paste known VERIDIAN user IDs.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push(backHref)} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
          onClick={createMeeting}
          disabled={submitting || missing.length > 0}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}

export default function MeetingNewPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ct-muted">Loading...</p>}>
      <NewMeetingForm />
    </Suspense>
  );
}
