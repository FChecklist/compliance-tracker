"use client";

// force-dynamic: see veri-todo/page.tsx for why this is required.
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Loader2, ArrowLeft, Plus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type ActionItem = { id: string; task: { id: string; title: string; status: string } };
type Meeting = {
  id: string; title: string; meetingType: string; scheduledAt: string;
  minutes: string | null; actionItems: ActionItem[];
};

export default function VeriMeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [minutes, setMinutes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newActionItem, setNewActionItem] = useState("");
  const [addingItem, setAddingItem] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/veri-meetings/${params.id}`);
    if (res.ok) {
      const data = await res.json();
      setMeeting(data);
      setMinutes(data.minutes ?? "");
    }
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const saveMinutes = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/veri-meetings/${params.id}/minutes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      if (!res.ok) throw new Error();
      toast.success("Minutes saved");
      load();
    } catch {
      toast.error("Failed to save minutes");
    } finally {
      setSaving(false);
    }
  };

  const addActionItem = async () => {
    if (!newActionItem.trim()) return;
    setAddingItem(true);
    try {
      const res = await fetch(`/api/veri-meetings/${params.id}/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newActionItem }),
      });
      if (!res.ok) throw new Error();
      toast.success("Action item added -- also visible in VERI To Do");
      setNewActionItem("");
      load();
    } catch {
      toast.error("Failed to add action item");
    } finally {
      setAddingItem(false);
    }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!meeting) return <p className="text-sm text-ct-muted">Meeting not found.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.push("/veri-meetings")}>
          <ArrowLeft className="size-4 mr-2" />
          VERI Minutes of Meetings
        </Button>
        <Button onClick={saveMinutes} disabled={saving} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
          {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
          Save Minutes
        </Button>
      </div>

      <div className="rounded-xl border border-ct-border bg-white p-6 space-y-1">
        <h1 className="text-xl font-heading text-ct-navy">{meeting.title}</h1>
        <p className="text-sm text-ct-muted">{new Date(meeting.scheduledAt).toLocaleString()}</p>
      </div>

      <div className="rounded-xl border border-ct-border bg-white p-6 space-y-3">
        <h2 className="text-sm font-semibold text-ct-navy uppercase tracking-wide">Minutes</h2>
        <Textarea
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="Write or paste rough notes here..."
          className="min-h-[300px] text-sm"
        />
      </div>

      <div className="rounded-xl border border-ct-border bg-white p-6 space-y-3">
        <h2 className="text-sm font-semibold text-ct-navy uppercase tracking-wide">Action Items</h2>
        {meeting.actionItems.length > 0 && (
          <div className="space-y-2">
            {meeting.actionItems.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-3.5 text-ct-teal shrink-0" />
                <span className="flex-1 text-ct-navy">{item.task.title}</span>
                <Badge variant="secondary" className="text-[10px]">{item.task.status}</Badge>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Input value={newActionItem} onChange={(e) => setNewActionItem(e.target.value)} placeholder="New action item..." className="h-9" />
          <Button size="sm" onClick={addActionItem} disabled={addingItem || !newActionItem.trim()}>
            {addingItem ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5 mr-1" />}
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
