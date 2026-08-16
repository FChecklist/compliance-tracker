"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Share2, Copy, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ConversationList, type ConversationSummary } from "@/components/chat/ConversationList";
import { ThreadView } from "@/components/chat/ThreadView";
import { useResilientPoll } from "@/lib/use-resilient-poll";
import { useMe } from "@/lib/queries/use-me";

const POLL_MS = 8000;

type OrgUser = { id: string; name: string };

function ChatPageInner() {
  const searchParams = useSearchParams();
  const linkedConversationId = searchParams.get("conversation");
  const highlightMismatchId = searchParams.get("highlight");

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Shared react-query cache instead of its own /api/me fetch-on-mount.
  const { data: me } = useMe();
  const currentUserId = me?.id ?? null;
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  // Priority 18a: was a single pickerUserId (one Select, always sent as a
  // 1-element array) -- chat-service.ts's createConversation() already
  // accepts participantUserIds: string[] and auto-derives type: 'group' the
  // instant more than 2 people end up in it (see that function's own
  // comment), so the only real gap was this picker never offering more than
  // one person. Now a genuine multi-select; picking exactly one still
  // behaves exactly as before (direct, no title prompt).
  const [pickerUserIds, setPickerUserIds] = useState<string[]>([]);
  const [pickerTitle, setPickerTitle] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareLinks, setShareLinks] = useState<{ shareUrl: string; whatsappHref: string; telegramHref: string } | null>(null);
  const [guestOpen, setGuestOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestLink, setGuestLink] = useState<{ guestUrl: string; whatsappHref: string; telegramHref: string } | null>(null);
  const appliedLinkRef = useRef(false);

  // Wave 146 gap-closure fix: previously a bare setInterval(loadConversations,
  // POLL_MS) with no in-flight guard and no backoff -- during a backend
  // outage it kept firing every 8s regardless of whether the previous call
  // had resolved. useResilientPoll waits for each attempt to settle and
  // backs off (capped) on repeated failures, same as AppShell.tsx's chat
  // poll.
  const loadConversations = useCallback(async () => {
    try {
      const r = await fetch("/api/conversations");
      if (!r.ok) return false;
      const data = await r.json();
      // Wave 37: VERI Chat is now human/guest chat only -- the AI thread
      // has its own dedicated surface at /veri-ai (VERI Chat Intelligence
      // Engine, PLATFORM_STRATEGY.md §18).
      const list: ConversationSummary[] = (data.conversations ?? []).filter((c: ConversationSummary) => !c.isAiThread);
      setConversations(list);
      setSelectedId((prev) => {
        if (prev) return prev;
        // A notification's click-through wins over the default (most-
        // recent) selection, but only once per page load.
        if (!appliedLinkRef.current && linkedConversationId && list.some((c) => c.id === linkedConversationId)) {
          appliedLinkRef.current = true;
          return linkedConversationId;
        }
        return list[0]?.id ?? null;
      });
      return true;
    } catch {
      return false;
    }
  }, [linkedConversationId]);
  useResilientPoll(loadConversations, POLL_MS);

  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setOrgUsers(d.users ?? []));
  }, []);

  async function startConversation() {
    if (pickerUserIds.length === 0) return;
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantUserIds: pickerUserIds,
        title: pickerUserIds.length > 1 && pickerTitle.trim() ? pickerTitle.trim() : undefined,
      }),
    });
    if (res.ok) {
      const created = await res.json();
      setShowPicker(false);
      setPickerUserIds([]);
      setPickerTitle("");
      loadConversations();
      setSelectedId(created.id);
    }
  }

  function togglePickerUser(userId: string) {
    setPickerUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  // Every org user other than yourself is a valid group participant, even
  // one you already have a 1:1 with -- a group is a genuinely different
  // conversation, so the "don't re-offer an existing direct chat" filter
  // (still correct for the single-person case below) doesn't apply once
  // more than one person can be picked.
  const selectableUsers = orgUsers.filter((u) => u.id !== currentUserId);

  async function shareConversation() {
    if (!selectedId) return;
    setSharing(true);
    setShareOpen(true);
    try {
      const res = await fetch(`/api/veri-chat/conversations/${selectedId}/share-links`, { method: "POST" });
      if (!res.ok) throw new Error();
      const link = await res.json();
      setShareLinks({ shareUrl: link.shareUrl, whatsappHref: link.whatsappHref, telegramHref: link.telegramHref });
    } catch {
      toast.error("Failed to create share link");
      setShareOpen(false);
    } finally {
      setSharing(false);
    }
  }

  function copyShareUrl() {
    if (!shareLinks) return;
    navigator.clipboard.writeText(shareLinks.shareUrl);
    toast.success("Link copied");
  }

  function openGuestDialog() {
    setGuestName("");
    setGuestEmail("");
    setGuestLink(null);
    setGuestOpen(true);
  }

  async function inviteGuest() {
    if (!selectedId || !guestName.trim()) return;
    setInviting(true);
    try {
      const res = await fetch(`/api/veri-chat/conversations/${selectedId}/guest-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName: guestName.trim(), guestEmail: guestEmail.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      const link = await res.json();
      setGuestLink({ guestUrl: link.guestUrl, whatsappHref: link.whatsappHref, telegramHref: link.telegramHref });
    } catch {
      toast.error("Failed to invite guest");
    } finally {
      setInviting(false);
    }
  }

  function copyGuestUrl() {
    if (!guestLink) return;
    navigator.clipboard.writeText(guestLink.guestUrl);
    toast.success("Link copied");
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-heading text-xl text-ct-navy">VERI Chat</h1>
        <div className="flex items-center gap-2">
          {selected && !selected.isAiThread && (
            <>
              <Button size="sm" variant="outline" onClick={shareConversation}>
                <Share2 className="size-4 mr-1" /> Share
              </Button>
              <Button size="sm" variant="outline" onClick={openGuestDialog}>
                <UserPlus className="size-4 mr-1" /> Invite guest
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowPicker((s) => !s)}>
            <Plus className="size-4 mr-1" /> New conversation
          </Button>
        </div>
      </div>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share this conversation</DialogTitle>
            <DialogDescription>
              Anyone with this link can view a read-only copy of this conversation for 72 hours. WhatsApp and Telegram only support composing a new message with this link -- there is no way for either platform to hand over an existing chat directly.
            </DialogDescription>
          </DialogHeader>
          {sharing ? (
            <div className="flex items-center justify-center py-6"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
          ) : shareLinks ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input readOnly value={shareLinks.shareUrl} className="flex-1 h-9 px-3 rounded-lg border border-ct-border text-xs text-ct-muted" />
                <Button size="sm" variant="outline" onClick={copyShareUrl}><Copy className="size-3.5" /></Button>
              </div>
              <div className="flex gap-2">
                <a href={shareLinks.whatsappHref} target="_blank" rel="noopener noreferrer" className="flex-1">
                  <Button size="sm" variant="outline" className="w-full">WhatsApp</Button>
                </a>
                <a href={shareLinks.telegramHref} target="_blank" rel="noopener noreferrer" className="flex-1">
                  <Button size="sm" variant="outline" className="w-full">Telegram</Button>
                </a>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={guestOpen} onOpenChange={setGuestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite an external guest</DialogTitle>
            <DialogDescription>
              An external customer or vendor can reply in this conversation without a VERIDIAN account. The link expires in 7 days and can be revoked any time.
            </DialogDescription>
          </DialogHeader>
          {guestLink ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input readOnly value={guestLink.guestUrl} className="flex-1 h-9 px-3 rounded-lg border border-ct-border text-xs text-ct-muted" />
                <Button size="sm" variant="outline" onClick={copyGuestUrl}><Copy className="size-3.5" /></Button>
              </div>
              <div className="flex gap-2">
                <a href={guestLink.whatsappHref} target="_blank" rel="noopener noreferrer" className="flex-1">
                  <Button size="sm" variant="outline" className="w-full">WhatsApp</Button>
                </a>
                <a href={guestLink.telegramHref} target="_blank" rel="noopener noreferrer" className="flex-1">
                  <Button size="sm" variant="outline" className="w-full">Telegram</Button>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Input placeholder="Guest name" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
              <Input placeholder="Guest email (optional)" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
              <Button size="sm" onClick={inviteGuest} disabled={!guestName.trim() || inviting} className="w-full">
                {inviting ? <Loader2 className="size-4 animate-spin" /> : "Create invite link"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {showPicker && (
        <div className="mb-3 p-3 rounded-lg border border-ct-border bg-white space-y-2">
          <p className="text-xs text-ct-muted">
            {pickerUserIds.length <= 1 ? "Pick one person for a 1:1, or more for a group discussion." : `${pickerUserIds.length} people selected -- this will be a group.`}
          </p>
          <div className="max-h-40 overflow-y-auto rounded-md border border-ct-border divide-y divide-ct-border">
            {selectableUsers.map((u) => (
              <label key={u.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-ct-cloud/60">
                <Checkbox checked={pickerUserIds.includes(u.id)} onCheckedChange={() => togglePickerUser(u.id)} />
                {u.name}
              </label>
            ))}
          </div>
          {pickerUserIds.length > 1 && (
            <Input placeholder="Name this discussion (optional)" value={pickerTitle} onChange={(e) => setPickerTitle(e.target.value)} className="h-9" />
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={startConversation} disabled={pickerUserIds.length === 0}>Start</Button>
            <Button size="sm" variant="outline" onClick={() => { setShowPicker(false); setPickerUserIds([]); setPickerTitle(""); }}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-[280px_1fr] rounded-lg border border-ct-border bg-white overflow-hidden">
        <div className="border-r border-ct-border overflow-hidden">
          <ConversationList conversations={conversations} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className="overflow-hidden">
          {selected && currentUserId ? (
            <ThreadView
              key={selected.id}
              conversation={selected}
              currentUserId={currentUserId}
              highlightMismatchId={selected.id === linkedConversationId ? highlightMismatchId : null}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-ct-muted">
              {conversations.length === 0 ? "Loading..." : "Select a conversation"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="text-sm text-ct-muted">Loading...</div>}>
      <ChatPageInner />
    </Suspense>
  );
}
