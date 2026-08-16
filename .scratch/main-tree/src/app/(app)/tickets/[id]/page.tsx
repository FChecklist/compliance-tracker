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
import { Loader2, UserPlus, Copy, Wrench, Star, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ThreadView } from "@/components/chat/ThreadView";

type Ticket = {
  id: string; conversationId: string; subject: string; category: string | null;
  priority: string; status: string; slaDeadline: string | null; installedProductId: string | null;
};

// Wave 81 (Customer Service enhancements): field-service dispatch + CSAT/NPS
// survey results + installed-product link, alongside the existing ticket
// header rather than a separate page -- these are all "about this ticket"
// context a support agent needs while working it.
type Dispatch = { id: string; scheduledAt: string; status: string; addressText: string | null };
type Survey = { id: string; csatScore: number | null; npsScore: number | null; comment: string | null; createdAt: string };
type InstalledProduct = { id: string; productName: string; serialNumber: string | null; warrantyExpiresAt: string | null };

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

  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [installedProducts, setInstalledProducts] = useState<InstalledProduct[]>([]);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchScheduledAt, setDispatchScheduledAt] = useState("");
  const [dispatchAddress, setDispatchAddress] = useState("");
  const [schedulingDispatch, setSchedulingDispatch] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/tickets/${params.id}`)
      .then((r) => r.json())
      .then((data) => setTicket(data.id ? data : null))
      .catch(() => {})
      .finally(() => setLoading(false));
    fetch(`/api/tickets/${params.id}/dispatches`).then((r) => r.json()).then((d) => setDispatches(d.dispatches ?? [])).catch(() => {});
    fetch(`/api/tickets/${params.id}/surveys`).then((r) => r.json()).then((d) => setSurveys(d.surveys ?? [])).catch(() => {});
    fetch("/api/installed-products").then((r) => r.json()).then((d) => setInstalledProducts(d.installedProducts ?? [])).catch(() => {});
  }, [params.id]);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setCurrentUserId(d.id));
    load();
  }, [load]);

  async function scheduleDispatch() {
    if (!ticket || !dispatchScheduledAt) return;
    setSchedulingDispatch(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/dispatches`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: dispatchScheduledAt, addressText: dispatchAddress || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Field-service visit scheduled");
      setDispatchOpen(false); setDispatchScheduledAt(""); setDispatchAddress("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to schedule dispatch");
    } finally {
      setSchedulingDispatch(false);
    }
  }

  async function linkInstalledProduct(installedProductId: string) {
    if (!ticket) return;
    const res = await fetch(`/api/tickets/${ticket.id}/installed-product`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installedProductId: installedProductId || null }),
    });
    if (!res.ok) { toast.error("Failed to link installed product"); return; }
    load();
  }

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

      <div className="flex items-center gap-2 flex-wrap mb-3 text-xs">
        <Select value={ticket.installedProductId ?? "__none__"} onValueChange={(v) => linkInstalledProduct(v === "__none__" ? "" : v)}>
          <SelectTrigger className="w-52 h-8 text-xs"><Package className="size-3 mr-1" /><SelectValue placeholder="No installed product" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No installed product</SelectItem>
            {installedProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}{p.serialNumber ? ` (${p.serialNumber})` : ""}</SelectItem>)}
          </SelectContent>
        </Select>

        <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Schedule Field-Service Visit</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Input type="datetime-local" value={dispatchScheduledAt} onChange={(e) => setDispatchScheduledAt(e.target.value)} />
              <Input placeholder="Site address (optional)" value={dispatchAddress} onChange={(e) => setDispatchAddress(e.target.value)} />
              <Button size="sm" onClick={scheduleDispatch} disabled={!dispatchScheduledAt || schedulingDispatch} className="w-full">
                {schedulingDispatch ? <Loader2 className="size-4 animate-spin" /> : "Schedule"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDispatchOpen(true)}>
          <Wrench className="size-3 mr-1" /> Schedule Visit
        </Button>
        {dispatches.map((d) => (
          <Badge key={d.id} variant="outline" className="text-xs">{d.status}: {new Date(d.scheduledAt).toLocaleDateString()}</Badge>
        ))}

        {surveys.map((s) => (
          <Badge key={s.id} variant="outline" className="text-xs gap-1">
            <Star className="size-3 text-ct-saffron" />
            {s.csatScore != null ? `CSAT ${s.csatScore}/5` : ""}{s.csatScore != null && s.npsScore != null ? " · " : ""}{s.npsScore != null ? `NPS ${s.npsScore}/10` : ""}
          </Badge>
        ))}
      </div>

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
