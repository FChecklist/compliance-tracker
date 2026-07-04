"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 39 (VERIDIAN Ticketing, PLATFORM_STRATEGY.md §21). Reuses ThreadView
// (VERI Chat, Wave 12/37) for the ticket's underlying conversation --
// every reply, guest message, and markdown render already works for free.
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserPlus, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ThreadView } from "@/components/chat/ThreadView";

type Ticket = {
  id: string; conversationId: string; subject: string; category: string | null;
  priority: string; status: string; slaDeadline: string | null;
};

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestOpen, setGuestOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [guestUrl, setGuestUrl] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/tickets/${params.id}`)
      .then((r) => r.json())
      .then((data) => setTicket(data.id ? data : null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setCurrentUserId(d.id));
    load();
  }, [load]);

  async function updateField(patch: Partial<{ status: string; priority: string }>) {
    if (!ticket) return;
    const res = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) load();
    else toast.error("Failed to update ticket");
  }

  function openGuestDialog() {
    setGuestName(""); setGuestEmail(""); setGuestUrl(null);
    setGuestOpen(true);
  }

  async function inviteGuest() {
    if (!ticket || !guestName.trim()) return;
    setInviting(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/guest-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName: guestName.trim(), guestEmail: guestEmail.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setGuestUrl(data.guestUrl);
    } catch {
      toast.error("Failed to invite guest");
    } finally {
      setInviting(false);
    }
  }

  function copyGuestUrl() {
    if (!guestUrl) return;
    navigator.clipboard.writeText(guestUrl);
    toast.success("Link copied");
  }

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!ticket) return <p className="text-sm text-ct-error">Ticket not found.</p>;

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-xl text-ct-navy truncate">{ticket.subject}</h1>
          <p className="text-xs text-ct-muted">{ticket.category || "General"}{ticket.slaDeadline ? ` · SLA ${new Date(ticket.slaDeadline).toLocaleString()}` : ""}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={ticket.priority} onValueChange={(v) => updateField({ priority: v })}>
            <SelectTrigger className="w-[110px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ticket.status} onValueChange={(v) => updateField({ status: v })}>
            <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={openGuestDialog}>
            <UserPlus className="size-4 mr-1" /> Invite guest
          </Button>
        </div>
      </div>

      <Dialog open={guestOpen} onOpenChange={setGuestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite the requester as a guest</DialogTitle>
            <DialogDescription>They can view and reply to this ticket without a VERIDIAN account, the same guest-access mechanism used in VERI Chat.</DialogDescription>
          </DialogHeader>
          {guestUrl ? (
            <div className="flex items-center gap-2">
              <Input readOnly value={guestUrl} className="flex-1 h-9 text-xs text-ct-muted" />
              <Button size="sm" variant="outline" onClick={copyGuestUrl}><Copy className="size-3.5" /></Button>
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

      <div className="flex-1 min-h-0 rounded-lg border border-ct-border bg-white overflow-hidden">
        {currentUserId && (
          <ThreadView
            conversation={{ id: ticket.conversationId, isAiThread: false, title: ticket.subject, otherParticipants: [] }}
            currentUserId={currentUserId}
          />
        )}
      </div>
    </div>
  );
}
