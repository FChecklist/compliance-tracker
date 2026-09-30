"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge, module 22/24 (moms): meeting detail / object page.
// Ported from PROJEXA's own MoMObjectClient.tsx (the richest of the three
// PROJEXA moms screens: live minutes, AI summary/key-decisions/suggested
// action items, publish/lock, action items, share links, PDF export),
// rebuilt on this repo's own house pattern (Card/Table/Dialog, see
// change-orders/[id]/page.tsx's real workflow detail page) instead of
// PROJEXA's own KitObjectScreen archetype + shell "door"/composer/focus-
// request system, none of which exist in this repo.
//
// Deliberate simplifications vs. PROJEXA's own object page (kept honest in
// the PR description, not silently dropped): minutes save on an explicit
// "Save now" click rather than a 2s-debounce autosave with retry back-off --
// this repo's other multi-stage-lifecycle ports (change-orders, billing-
// milestones) all use explicit save-on-click, and inventing a bespoke
// autosave/retry mechanism for one screen would be the per-screen divergence
// this repo's own house pattern exists to avoid. Meeting-level fields
// (title/type/date/attendees/agenda) are read-only here after create --
// updateVeriMeetingDetails() is a real route this page does not call; only
// minutes, action items, publish/lock, share links and delete are wired,
// which is what the task's own brief named.
//
// CONFIRMED BACKEND CONTRACT (read directly from veri-meeting-service.ts):
//  - GET /api/v1/projexa/veri-meetings/:id -> the meeting row + actionItems
//    (each { id, task: { id, title, status, dueDate, userId, ... } }).
//  - PATCH with { minutes } -> updateMeetingMinutes (refused once published).
//  - PATCH with { action: "publish" } -> publishVeriMeeting (locks the
//    record; best-effort AI intelligence generation runs server-side if
//    minutes exist).
//  - DELETE -> deleteVeriMeeting (draft-only, soft delete).
//  - POST .../generate-intelligence -> generateMeetingIntelligence (needs
//    non-empty minutes; writes aiSummary/aiKeyDecisions/aiSuggestedActionItems).
//  - POST .../action-items -> addMeetingActionItem (needs a real
//    assigneeUserId in this org -- assertAssigneesInOrg enforces it).
//  - GET/POST .../share-links, DELETE .../share-links/:linkId -- share
//    links can only be created once the meeting is PUBLISHED
//    (createMeetingShareLink: "Only published meetings can be shared").
//  - GET .../pdf -- real PDF export, plain cookie-authed GET, safe as a
//    bare <a href>.
// Assignee is a plain <select> populated from GET /api/v1/projexa/org-users
// (a real, already-existing org-directory route) rather than free text --
// the backend requires a real in-org user id here, unlike attendees.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Download, Link2, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type ActionItem = {
  id: string;
  task: { id: string; title: string; status: string; dueDate: string | null; userId: string | null };
};
type SuggestedActionItem = { title: string; assignee: string | null; dueDateHint: string | null };
type MinutesHistoryEntry = { date: string; amendedBy: string | null; text: string };
type Meeting = {
  id: string;
  title: string;
  meetingType: string;
  status: string;
  scheduledAt: string;
  attendees: string[];
  agenda: string[];
  minutes: string | null;
  minutesHistory: MinutesHistoryEntry[] | null;
  systemId: string | null;
  publishedAt: string | null;
  aiSummary: string | null;
  aiKeyDecisions: string[] | null;
  aiSuggestedActionItems: SuggestedActionItem[] | null;
  actionItems: ActionItem[];
};
type ShareLink = { id: string; token: string; expiresAt: string; revokedAt: string | null; createdAt: string };
type OrgUser = { id: string; name: string; email: string; role: string };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-ct-cloud text-ct-muted",
  published: "bg-green-100 text-green-700",
};

export default function MoMDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const meetingId = params.id;

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [minutesDraft, setMinutesDraft] = useState("");
  const [savingMinutes, setSavingMinutes] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [creatingShare, setCreatingShare] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [actionTitle, setActionTitle] = useState("");
  const [actionAssignee, setActionAssignee] = useState("");
  const [actionDueDate, setActionDueDate] = useState("");
  const [addingAction, setAddingAction] = useState(false);

  const isPublished = meeting?.status === "published";
  const hasUnsavedMinutes = minutesDraft !== (meeting?.minutes ?? "");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/projexa/veri-meetings/${meetingId}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load this meeting");
      setMeeting(data);
      setMinutesDraft(data.minutes ?? "");
      setLoadError(null);
      // Share links only exist meaningfully once published -- a non-published
      // meeting simply has none, so the fetch is best-effort and never fatal.
      fetch(`/api/v1/projexa/veri-meetings/${meetingId}/share-links`)
        .then((r) => r.json())
        .then((d) => setLinks(d.links ?? []))
        .catch(() => setLinks([]));
    } catch (err) {
      setMeeting(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this meeting");
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/v1/projexa/org-users")
      .then((r) => r.json())
      .then((d) => setOrgUsers(d.users ?? []))
      .catch(() => setOrgUsers([]));
  }, []);

  async function saveMinutes() {
    setSavingMinutes(true);
    try {
      const res = await fetch(`/api/v1/projexa/veri-meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes: minutesDraft }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't save minutes");
      toast.success("Minutes saved");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save minutes");
    } finally {
      setSavingMinutes(false);
    }
  }

  async function generateSummary() {
    setGeneratingAi(true);
    try {
      const res = await fetch(`/api/v1/projexa/veri-meetings/${meetingId}/generate-intelligence`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't generate AI summary");
      toast.success("AI summary generated");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't generate AI summary");
    } finally {
      setGeneratingAi(false);
    }
  }

  async function publish() {
    setConfirmingPublish(false);
    setPublishing(true);
    try {
      const res = await fetch(`/api/v1/projexa/veri-meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't publish meeting");
      toast.success("Published and locked");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't publish meeting");
    } finally {
      setPublishing(false);
    }
  }

  async function deleteMeeting() {
    setConfirmingDelete(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/projexa/veri-meetings/${meetingId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't delete this meeting");
      toast.success("Meeting deleted");
      router.push("/moms");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete this meeting");
      setDeleting(false);
    }
  }

  function promoteSuggestion(s: SuggestedActionItem) {
    setActionTitle(s.title);
    const match = s.assignee
      ? orgUsers.find((u) => u.name.toLowerCase() === s.assignee!.toLowerCase() || u.email.toLowerCase() === s.assignee!.toLowerCase())
      : undefined;
    if (match) setActionAssignee(match.id);
  }

  async function addActionItem() {
    if (!actionTitle.trim() || !actionAssignee) return;
    setAddingAction(true);
    try {
      const res = await fetch(`/api/v1/projexa/veri-meetings/${meetingId}/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: actionTitle.trim(), assigneeUserId: actionAssignee, dueDate: actionDueDate || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't add action item");
      toast.success("Action item added");
      setActionTitle("");
      setActionAssignee("");
      setActionDueDate("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add action item");
    } finally {
      setAddingAction(false);
    }
  }

  async function createShareLink() {
    setCreatingShare(true);
    try {
      const res = await fetch(`/api/v1/projexa/veri-meetings/${meetingId}/share-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.shareUrl) throw new Error(data?.error ?? "Couldn't create a share link");
      await navigator.clipboard.writeText(data.shareUrl).catch(() => {});
      toast.success("Share link created and copied to clipboard");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create a share link");
    } finally {
      setCreatingShare(false);
    }
  }

  async function revokeLink(linkId: string) {
    setRevokingId(linkId);
    try {
      const res = await fetch(`/api/v1/projexa/veri-meetings/share-links/${linkId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't revoke share link");
      toast.success("Share link revoked");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't revoke share link");
    } finally {
      setRevokingId(null);
    }
  }

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (loadError || !meeting) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Meeting not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/moms" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ArrowLeft className="size-3.5" /> Back to Minutes of Meeting
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">{meeting.title}</h1>
            <Badge className={`text-xs border-0 ${STATUS_COLORS[meeting.status] ?? "bg-ct-cloud text-ct-muted"}`}>{meeting.status}</Badge>
          </div>
          <p className="text-sm text-ct-muted mt-1">
            {meeting.systemId ? `${meeting.systemId} -- ` : ""}
            {new Date(meeting.scheduledAt).toLocaleString()} -- {meeting.meetingType}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/v1/projexa/veri-meetings/${meeting.id}/pdf`}>
              <Download className="size-3.5 mr-1.5" /> Export PDF
            </a>
          </Button>
          {!isPublished && (
            <Button
              size="sm"
              disabled={publishing || hasUnsavedMinutes}
              title={hasUnsavedMinutes ? "Save minutes first" : undefined}
              onClick={() => setConfirmingPublish(true)}
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
            >
              {publishing ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Publish &amp; Lock
            </Button>
          )}
          {meeting.status === "draft" && (
            <Button variant="outline" size="sm" disabled={deleting} onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="size-3.5 mr-1.5" /> Delete
            </Button>
          )}
        </div>
      </div>

      {isPublished && (
        <Card className="rounded-xl border-ct-border bg-ct-cloud/30">
          <CardContent className="pt-4 text-sm text-ct-muted">
            This meeting is published and locked -- its details and minutes cannot be edited.
          </CardContent>
        </Card>
      )}

      {(meeting.attendees.length > 0 || meeting.agenda.length > 0) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Attendees</CardTitle></CardHeader>
            <CardContent>
              {meeting.attendees.length === 0 ? (
                <p className="text-sm text-ct-muted">None listed.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {meeting.attendees.map((a) => (
                    <Badge key={a} variant="outline">{a}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Agenda</CardTitle></CardHeader>
            <CardContent>
              {meeting.agenda.length === 0 ? (
                <p className="text-sm text-ct-muted">None listed.</p>
              ) : (
                <ul className="list-disc space-y-0.5 pl-4 text-sm text-ct-navy">
                  {meeting.agenda.map((a) => <li key={a}>{a}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base text-ct-navy">Minutes</CardTitle>
            {Array.isArray(meeting.minutesHistory) && meeting.minutesHistory.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? "Hide" : "Show"} history ({meeting.minutesHistory.length})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={minutesDraft}
            onChange={(e) => setMinutesDraft(e.target.value)}
            rows={8}
            placeholder="Type live meeting notes here..."
            disabled={isPublished}
          />
          <div className="flex items-center gap-2">
            {!isPublished && (
              <Button size="sm" onClick={saveMinutes} disabled={savingMinutes || !hasUnsavedMinutes}>
                {savingMinutes ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null}
                Save now
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={generateSummary} disabled={generatingAi || !meeting.minutes?.trim()}>
              {generatingAi ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Sparkles className="size-3.5 mr-1.5" />}
              Generate AI Summary
            </Button>
          </div>

          {showHistory && Array.isArray(meeting.minutesHistory) && (
            <div className="rounded-md border border-ct-border bg-ct-cloud/20 p-3 text-xs text-ct-muted space-y-2">
              {meeting.minutesHistory
                .slice()
                .reverse()
                .map((h, i) => (
                  <div key={i} className="border-b border-ct-border/60 pb-2 last:border-0 last:pb-0">
                    <p className="font-medium text-ct-navy">{new Date(h.date).toLocaleString()}</p>
                    <p className="whitespace-pre-wrap">{h.text}</p>
                  </div>
                ))}
            </div>
          )}

          {meeting.aiSummary && (
            <div className="rounded-md border border-ct-border bg-ct-cloud/30 p-3 text-sm space-y-2">
              <p className="text-ct-navy">{meeting.aiSummary}</p>
              {(meeting.aiKeyDecisions?.length ?? 0) > 0 && (
                <div>
                  <p className="font-medium text-ct-navy text-xs uppercase">Key Decisions</p>
                  <ul className="list-disc pl-4 text-ct-navy">
                    {meeting.aiKeyDecisions!.map((d) => <li key={d}>{d}</li>)}
                  </ul>
                </div>
              )}
              {(meeting.aiSuggestedActionItems?.length ?? 0) > 0 && (
                <div>
                  <p className="font-medium text-ct-navy text-xs uppercase">AI-Suggested Action Items</p>
                  <ul className="space-y-1">
                    {meeting.aiSuggestedActionItems!.map((s, i) => (
                      <li key={i} className="flex items-center justify-between gap-2">
                        <span className="text-ct-navy">
                          {s.title}
                          {s.assignee ? ` -- ${s.assignee}` : ""}
                          {s.dueDateHint ? ` (${s.dueDateHint})` : ""}
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => promoteSuggestion(s)}>Add as Action Item</Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Action Items</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {meeting.actionItems.length === 0 ? (
            <p className="text-sm text-ct-muted">No action items yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {meeting.actionItems.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-md border border-ct-border px-2 py-1.5">
                  <span className="text-ct-navy">{a.task.title}</span>
                  <span className="text-xs text-ct-muted">
                    {a.task.status}
                    {a.task.dueDate ? ` -- due ${new Date(a.task.dueDate).toLocaleDateString()}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
              <Input className="w-52" value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Assignee</Label>
              <Select value={actionAssignee} onValueChange={setActionAssignee}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Choose an assignee" /></SelectTrigger>
                <SelectContent>
                  {orgUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Due Date (optional)</Label>
              <Input type="date" className="w-40" value={actionDueDate} onChange={(e) => setActionDueDate(e.target.value)} />
            </div>
            <Button
              size="sm"
              disabled={addingAction || !actionTitle.trim() || !actionAssignee}
              onClick={addActionItem}
            >
              {addingAction ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null}
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Share links</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!isPublished ? (
            <p className="text-sm text-ct-muted">Publish this meeting first -- only published minutes can be shared.</p>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={creatingShare} onClick={createShareLink}>
                {creatingShare ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Link2 className="size-3.5 mr-1.5" />}
                Create share link
              </Button>
              {links.length === 0 ? (
                <p className="text-sm text-ct-muted">No share links created yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {links.map((l) => {
                    const revoked = !!l.revokedAt;
                    const expired = !revoked && new Date(l.expiresAt) < new Date();
                    return (
                      <li key={l.id} className="flex items-center justify-between rounded-md border border-ct-border px-2 py-1.5">
                        <span className="text-ct-muted">
                          {revoked ? "Revoked" : expired ? "Expired" : "Active"} -- expires {new Date(l.expiresAt).toLocaleString()}
                        </span>
                        {!revoked && !expired && (
                          <Button size="sm" variant="ghost" disabled={revokingId === l.id} onClick={() => revokeLink(l.id)}>
                            Revoke
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmingPublish} onOpenChange={setConfirmingPublish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish and lock &ldquo;{meeting.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              Title, date, attendees, agenda and minutes can no longer be edited. Action items stay editable.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingPublish(false)}>Cancel</Button>
            <Button onClick={publish} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">Publish &amp; Lock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{meeting.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              This removes the draft meeting and everything typed into its minutes. Only a draft can be deleted; a published meeting stays as the locked record.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteMeeting}>Delete meeting</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
