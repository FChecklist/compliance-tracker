"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge, module 22/24 (moms): create screen. Ported from
// PROJEXA's own MoMCreateClient.tsx, rebuilt on this repo's own house
// convention for a "new" screen (Card + Input/Textarea/Select, see
// src/app/(app)/meetings/new/page.tsx and budgets/new/page.tsx) instead of
// PROJEXA's own CreateScreen archetype from @fchecklist/veridian-ui-kit.
//
// POSTs to /api/v1/projexa/veri-meetings (veri-meeting-service.ts's
// createVeriMeeting) -- NOT /api/v1/projexa/meetings, the separate basic-
// scheduling module. createVeriMeeting requires title + scheduledAt;
// meetingType/attendees/agenda/minutes are all optional. Minutes typed here
// travel with the create in one write (the DTO's own `minutes` field) --
// matching PROJEXA's real capability (a coordination meeting is minuted
// while it runs) rather than forcing an empty-shell save first.
//
// Attendees are a comma-separated free-text field, same convention this
// repo's own /meetings/new page already uses ("No org directory/picker yet
// -- paste known names") -- attendees on this table are plain strings
// (external attendees may not be app users), not a list of user ids.
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MEETING_TYPES = [
  { value: "team", label: "Team" },
  { value: "client", label: "Client" },
  { value: "vendor", label: "Vendor" },
  { value: "one_on_one", label: "One-on-one" },
  { value: "other", label: "Other" },
];

function nextQuarterHourLocalInput(): string {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NewMoMForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") ?? "";

  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => nextQuarterHourLocalInput());
  const [meetingType, setMeetingType] = useState("team");
  const [attendees, setAttendees] = useState("");
  const [agendaText, setAgendaText] = useState("");
  const [minutes, setMinutes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const backHref = projectId ? `/moms?projectId=${encodeURIComponent(projectId)}` : "/moms";
  const missing = [...(title.trim() ? [] : ["Title"]), ...(scheduledAt ? [] : ["Date & time"])];

  const createMeeting = async () => {
    if (!projectId) {
      toast.error("No project selected");
      return;
    }
    if (missing.length) {
      toast.error(`${missing.join(", ")} required`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/veri-meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: title.trim(),
          scheduledAt: new Date(scheduledAt).toISOString(),
          meetingType,
          attendees: attendees.split(",").map((s) => s.trim()).filter(Boolean),
          agenda: agendaText.split("\n").map((l) => l.trim()).filter(Boolean),
          minutes: minutes.trim() ? minutes : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create meeting");
      toast.success("Meeting created");
      router.push(`/moms/${data.id}`);
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
        <p className="text-sm text-ct-muted mt-1">Minutes of Meeting / New Meeting</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <CardTitle className="text-base text-ct-navy">Meeting details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly site review" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Date &amp; time</Label>
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Type</Label>
              <Select value={meetingType} onValueChange={setMeetingType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEETING_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Attendees (optional)</Label>
            <Input value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="e.g. Arjun Mehta, Priya Nair" />
            <p className="text-xs text-ct-muted">Separate names with a comma.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Agenda (one per line, optional)</Label>
            <Textarea
              value={agendaText}
              onChange={(e) => setAgendaText(e.target.value)}
              rows={3}
              placeholder={"Review open RFIs\nSite safety walkthrough"}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Minutes (optional)</Label>
            <Textarea
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              rows={4}
              placeholder="What was said. You can keep typing after the meeting is created."
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push(backHref)} disabled={submitting}>
          Cancel
        </Button>
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

export default function MoMNewPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ct-muted">Loading...</p>}>
      <NewMoMForm />
    </Suspense>
  );
}
