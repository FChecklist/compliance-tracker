"use client";

// force-dynamic: see veri-todo/page.tsx for why this is required.
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Loader2, ArrowLeft, Plus, CheckCircle2, Lock, Globe, Download, Share2, History, ChevronDown, ChevronUp, Copy, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type ActionItem = { id: string; task: { id: string; title: string; status: string } };
type SuggestedActionItem = { title: string; assignee: string | null; dueDateHint: string | null };
type Meeting = {
  id: string; title: string; meetingType: string; scheduledAt: string; systemId: string | null;
  status: "draft" | "published"; attendees: string[]; agenda: string[];
  minutes: string | null; actionItems: ActionItem[];
  aiSummary: string | null; aiKeyDecisions: string[]; aiSuggestedActionItems: SuggestedActionItem[]; aiGeneratedAt: string | null;
};
type AuditEntry = { id: string; action: string; actorName: string; details: string | null; createdAt: string };
type ShareLink = { id: string; token: string; expiresAt: string; revokedAt: string | null };

export default function VeriMeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [title, setTitle] = useState("");
  const [attendees, setAttendees] = useState("");
  const [minutes, setMinutes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [newActionItem, setNewActionItem] = useState("");
  const [addingItem, setAddingItem] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [creatingLink, setCreatingLink] = useState(false);
  const [generatingIntelligence, setGeneratingIntelligence] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/veri-meetings/${params.id}`);
    if (res.ok) {
      const data = await res.json();
      setMeeting(data);
      setTitle(data.title);
      setAttendees(Array.isArray(data.attendees) ? data.attendees.join(", ") : "");
      setMinutes(data.minutes ?? "");
    }
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const isLocked = meeting?.status === "published";

  const loadHistory = async () => {
    if (historyLoaded) return;
    const res = await fetch(`/api/veri-meetings/${params.id}/audit-log`);
    if (res.ok) {
      const data = await res.json();
      setHistory(data.entries);
      setHistoryLoaded(true);
    }
  };

  const loadShareLinks = useCallback(async () => {
    const res = await fetch(`/api/veri-meetings/${params.id}/share-links`);
    if (res.ok) setShareLinks((await res.json()).links);
  }, [params.id]);

  useEffect(() => {
    if (isLocked) loadShareLinks();
  }, [isLocked, loadShareLinks]);

  const saveDetails = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/veri-meetings/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, attendees: attendees.split(",").map((a) => a.trim()).filter(Boolean) }),
      });
      if (!res.ok) throw new Error();
      const minutesRes = await fetch(`/api/veri-meetings/${params.id}/minutes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      if (!minutesRes.ok) throw new Error();
      toast.success("Saved");
      setHistoryLoaded(false);
      load();
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!confirm("Publish and lock this meeting? Meeting details and minutes cannot be edited afterward.")) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/veri-meetings/${params.id}/publish`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Meeting published and locked");
      setHistoryLoaded(false);
      load();
    } catch {
      toast.error("Failed to publish");
    } finally {
      setPublishing(false);
    }
  };

  const createShareLink = async () => {
    setCreatingLink(true);
    try {
      const res = await fetch(`/api/veri-meetings/${params.id}/share-links`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Share link created");
      loadShareLinks();
    } catch {
      toast.error("Failed to create share link");
    } finally {
      setCreatingLink(false);
    }
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/mom-share/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Share link copied");
  };

  const generateIntelligence = async () => {
    setGeneratingIntelligence(true);
    try {
      const res = await fetch(`/api/veri-meetings/${params.id}/generate-intelligence`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("AI intelligence generated");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate AI intelligence");
    } finally {
      setGeneratingIntelligence(false);
    }
  };

  const addSuggestedActionItem = async (item: SuggestedActionItem) => {
    try {
      const res = await fetch(`/api/veri-meetings/${params.id}/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: item.title }),
      });
      if (!res.ok) throw new Error();
      toast.success("Added to Action Items");
      setHistoryLoaded(false);
      load();
    } catch {
      toast.error("Failed to add action item");
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
      setHistoryLoaded(false);
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
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push("/veri-meetings")}>
          <ArrowLeft className="size-4 mr-2" />
          VERI Minutes of Meetings
        </Button>
        <div className="flex items-center gap-2">
          {meeting.systemId && <span className="text-xs font-mono text-ct-muted">{meeting.systemId}</span>}
          <Badge variant={isLocked ? "secondary" : "outline"} className="text-[10px] gap-1">
            {isLocked ? <Lock className="size-3" /> : null}
            {isLocked ? "Published" : "Draft"}
          </Badge>
          {!isLocked && (
            <Button onClick={publish} disabled={publishing} variant="outline" size="sm">
              {publishing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Globe className="size-4 mr-2" />}
              Publish
            </Button>
          )}
          {isLocked && (
            <a href={`/api/veri-meetings/${params.id}/export`} download>
              <Button variant="outline" size="sm">
                <Download className="size-4 mr-2" />
                Export
              </Button>
            </a>
          )}
          {!isLocked && (
            <Button onClick={saveDetails} disabled={saving} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
              Save
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-ct-border bg-white p-6 space-y-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isLocked}
          className="text-xl font-heading text-ct-navy border-none px-0 h-auto focus-visible:ring-0 disabled:opacity-100 disabled:cursor-default"
        />
        <p className="text-sm text-ct-muted">{new Date(meeting.scheduledAt).toLocaleString()}</p>
        <div>
          <label className="text-xs font-semibold text-ct-navy uppercase tracking-wide">Attendees</label>
          <Input
            value={attendees}
            onChange={(e) => setAttendees(e.target.value)}
            disabled={isLocked}
            placeholder="Alice, Bob, Carol"
            className="mt-1"
          />
        </div>
      </div>

      <div className="rounded-xl border border-ct-border bg-white p-6 space-y-3">
        <h2 className="text-sm font-semibold text-ct-navy uppercase tracking-wide">Minutes</h2>
        <Textarea
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          disabled={isLocked}
          placeholder="Write or paste rough notes here..."
          className="min-h-[300px] text-sm"
        />
      </div>

      {(minutes.trim() || meeting.aiGeneratedAt) && (
        <div className="rounded-xl border border-ct-border bg-white p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ct-navy uppercase tracking-wide flex items-center gap-2">
              <Sparkles className="size-4 text-ct-saffron" /> AI Intelligence
            </h2>
            <Button size="sm" variant="outline" onClick={generateIntelligence} disabled={generatingIntelligence || !minutes.trim()}>
              {generatingIntelligence ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <RefreshCw className="size-3.5 mr-1" />}
              {meeting.aiGeneratedAt ? "Regenerate" : "Generate"}
            </Button>
          </div>
          {!meeting.aiGeneratedAt ? (
            <p className="text-xs text-ct-muted">No AI summary yet -- generated automatically on publish, or click Generate to run it now.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-ct-navy">{meeting.aiSummary}</p>
              {meeting.aiKeyDecisions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ct-navy uppercase tracking-wide mb-1">Key Decisions</p>
                  <ul className="list-disc list-inside space-y-0.5 text-ct-navy">
                    {meeting.aiKeyDecisions.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </div>
              )}
              {meeting.aiSuggestedActionItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ct-navy uppercase tracking-wide mb-1">Suggested Action Items</p>
                  <div className="space-y-1.5">
                    {meeting.aiSuggestedActionItems.map((item, i) => (
                      <div key={i} className="flex items-center gap-2 bg-ct-cloud rounded-lg px-3 py-2">
                        <span className="flex-1">
                          {item.title}
                          {item.assignee && <span className="text-ct-muted"> — {item.assignee}</span>}
                          {item.dueDateHint && <span className="text-ct-muted"> ({item.dueDateHint})</span>}
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => addSuggestedActionItem(item)}>
                          <Plus className="size-3.5 mr-1" /> Add
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-ct-muted">Generated {new Date(meeting.aiGeneratedAt).toLocaleString()} — suggestions only, review before adding.</p>
            </div>
          )}
        </div>
      )}

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
        <p className="text-xs text-ct-muted">Action items remain editable in VERI To Do even after this meeting is published.</p>
      </div>

      {isLocked && (
        <div className="rounded-xl border border-ct-border bg-white p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ct-navy uppercase tracking-wide flex items-center gap-2">
              <Share2 className="size-4" /> Share
            </h2>
            <Button size="sm" variant="outline" onClick={createShareLink} disabled={creatingLink}>
              {creatingLink ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5 mr-1" />}
              New link
            </Button>
          </div>
          {shareLinks.filter((l) => !l.revokedAt).map((link) => (
            <div key={link.id} className="flex items-center gap-2 text-xs bg-ct-cloud rounded-lg px-3 py-2">
              <span className="flex-1 truncate font-mono text-ct-muted">/mom-share/{link.token}</span>
              <span className="text-ct-muted">expires {new Date(link.expiresAt).toLocaleDateString()}</span>
              <Button size="sm" variant="ghost" onClick={() => copyLink(link.token)}>
                <Copy className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-ct-border bg-white overflow-hidden">
        <button
          onClick={() => { setHistoryOpen((v) => !v); loadHistory(); }}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-ct-cloud/50 transition-colors"
        >
          <span className="text-sm font-semibold text-ct-navy uppercase tracking-wide flex items-center gap-2">
            <History className="size-4" /> Change History
          </span>
          {historyOpen ? <ChevronUp className="size-4 text-ct-muted" /> : <ChevronDown className="size-4 text-ct-muted" />}
        </button>
        {historyOpen && (
          <div className="px-6 pb-4 space-y-2">
            {!historyLoaded ? (
              <p className="text-xs text-ct-muted text-center py-3">Loading...</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-ct-muted text-center py-3">No changes recorded yet.</p>
            ) : (
              history.map((h) => (
                <div key={h.id} className="flex items-start gap-2 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-ct-teal mt-1.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-ct-navy">{h.details || h.action}</p>
                    <p className="text-ct-muted mt-0.5">{h.actorName} &middot; {new Date(h.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
