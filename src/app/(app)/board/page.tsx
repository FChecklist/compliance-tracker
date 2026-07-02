"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/SimpleModulePage";

type Meeting = {
  id: string; title: string; meetingType: string; meetingDate: string; status: string;
  agenda: string[]; classification: string; restricted?: boolean;
  minutes?: string | null; attendees?: string[]; minutesHistory?: { date: string; amendedBy: string; text: string }[];
};
type ActionItem = { id: string; boardMeetingId: string; item: string; dueDate: string | null; status: string };

export default function BoardPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [holdingId, setHoldingId] = useState<string | null>(null);
  const [minutesDraft, setMinutesDraft] = useState("");

  const load = () => {
    fetch("/api/board").then((r) => r.json()).then((d) => {
      setMeetings(d.meetings ?? []);
      setActionItems(d.actionItems ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const schedule = async () => {
    if (!title.trim() || !meetingDate) return;
    await fetch("/api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, meetingDate, agenda: [] }) });
    setTitle(""); setMeetingDate(""); setShowForm(false);
    load();
  };

  const hold = async (id: string) => {
    await fetch(`/api/board/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "hold", minutes: minutesDraft }) });
    setHoldingId(null); setMinutesDraft("");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Board & Governance</h1>
          <p className="text-sm text-ct-muted mt-1">Schedule meetings, record real minutes, track follow-up actions</p>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Schedule Meeting"}
        </Button>
      </div>

      {showForm && (
        <Card className="rounded-xl shadow-card bg-white p-4 space-y-3">
          <Input placeholder="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} className="h-9" />
          <Input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} className="h-9" />
          <Button size="sm" onClick={schedule} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Schedule</Button>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-ct-muted">Loading…</p>
      ) : meetings.length === 0 ? (
        <Card className="rounded-xl bg-white p-8 text-center text-sm text-ct-muted">No board meetings scheduled yet.</Card>
      ) : (
        <div className="space-y-3">
          {meetings.map((m) => (
            <Card key={m.id} className="rounded-xl shadow-card bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-ct-navy">{m.title} <span className="text-[10px] text-ct-muted font-normal">({m.meetingType})</span></p>
                  <p className="text-[11px] text-ct-muted">{new Date(m.meetingDate).toLocaleDateString("en-IN")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill value={m.status} />
                  {m.status === "scheduled" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setHoldingId(holdingId === m.id ? null : m.id)}>
                      Record as Held →
                    </Button>
                  )}
                </div>
              </div>
              {m.agenda?.length > 0 && <p className="mt-2 text-[11px] text-ct-slate"><strong>Agenda:</strong> {m.agenda.join(" · ")}</p>}

              {holdingId === m.id && (
                <div className="mt-2 space-y-2">
                  <Textarea placeholder="Minutes of meeting" value={minutesDraft} onChange={(e) => setMinutesDraft(e.target.value)} className="text-xs" />
                  <Button size="sm" onClick={() => hold(m.id)} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Save Minutes</Button>
                </div>
              )}

              {m.restricted && <p className="mt-2 text-[11px] text-ct-muted italic">Minutes restricted — Board-only classification</p>}
              {!m.restricted && m.minutes && (
                <div className="mt-2 text-[11px] text-ct-navy bg-ct-cloud/50 rounded-lg p-2">
                  <p><strong>Minutes:</strong> {m.minutes}</p>
                  {m.attendees && m.attendees.length > 0 && <p className="text-ct-muted mt-1">Attendees: {m.attendees.join(", ")}</p>}
                  {m.minutesHistory && m.minutesHistory.length > 0 && (
                    <details className="mt-1.5">
                      <summary className="text-ct-teal cursor-pointer">Prior versions ({m.minutesHistory.length})</summary>
                      <div className="mt-1 space-y-1 pl-2 border-l-2 border-ct-border">
                        {m.minutesHistory.map((h, i) => <div key={i}><span className="text-ct-muted">{new Date(h.date).toLocaleDateString("en-IN")} — amended by {h.amendedBy}:</span><br />{h.text}</div>)}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card className="rounded-xl shadow-card bg-white p-4">
        <h3 className="text-sm font-semibold mb-3">Action Items From Board Meetings</h3>
        {actionItems.length === 0 ? (
          <p className="text-xs text-ct-muted">No open action items.</p>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="pb-2 font-medium">Item</th><th className="pb-2 font-medium">Due</th><th className="pb-2 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-ct-border">
              {actionItems.map((a) => <tr key={a.id}><td className="py-2">{a.item}</td><td className="py-2">{a.dueDate ? new Date(a.dueDate).toLocaleDateString("en-IN") : "—"}</td><td className="py-2"><StatusPill value={a.status} /></td></tr>)}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
