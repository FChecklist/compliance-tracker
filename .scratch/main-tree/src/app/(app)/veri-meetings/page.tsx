"use client";

// force-dynamic: see veri-todo/page.tsx for why this is required.
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type Meeting = { id: string; title: string; meetingType: string; scheduledAt: string; status: "draft" | "published"; systemId: string | null };

const MEETING_TYPES = [
  { value: "team", label: "Team" },
  { value: "client", label: "Client" },
  { value: "vendor", label: "Vendor" },
  { value: "one_on_one", label: "One-on-One" },
  { value: "other", label: "Other" },
];

export default function VeriMeetingsPage() {
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState("");
  const [meetingType, setMeetingType] = useState("team");
  const [scheduledAt, setScheduledAt] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/veri-meetings");
    const data = await res.json();
    setMeetings(data.meetings ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createMeeting = async () => {
    if (!title.trim() || !scheduledAt) return;
    setCreating(true);
    try {
      const res = await fetch("/api/veri-meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, meetingType, scheduledAt }),
      });
      if (!res.ok) throw new Error();
      const meeting = await res.json();
      toast.success("Meeting created");
      setOpen(false);
      setTitle(""); setScheduledAt("");
      router.push(`/veri-meetings/${meeting.id}`);
    } catch {
      toast.error("Failed to create meeting");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">VERI Minutes of Meetings</h1>
          <p className="text-sm text-ct-muted mt-1">Any meeting -- team, client, vendor -- with AI-assisted minutes and task-linked action items.</p>
        </div>
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
              <DialogDescription>Create a meeting to track minutes and action items.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly sync" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Type</Label>
                <Select value={meetingType} onValueChange={setMeetingType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MEETING_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Date &amp; Time</Label>
                <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
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
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center space-y-2">
            <ClipboardList className="size-10 text-ct-muted mx-auto" />
            <p className="text-sm text-ct-muted">No meetings yet. Create the first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {meetings.map((m) => (
            <button
              key={m.id}
              onClick={() => router.push(`/veri-meetings/${m.id}`)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-ct-cloud transition-colors"
            >
              <ClipboardList className="size-4 text-ct-teal shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ct-navy">{m.title}</p>
                <p className="text-xs text-ct-muted">
                  {new Date(m.scheduledAt).toLocaleString()}
                  {m.systemId && <span className="font-mono ml-2">{m.systemId}</span>}
                </p>
              </div>
              <Badge variant={m.status === "published" ? "secondary" : "outline"} className="text-[10px]">
                {m.status === "published" ? "Published" : "Draft"}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">{MEETING_TYPES.find((t) => t.value === m.meetingType)?.label ?? m.meetingType}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
