"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 39 (VERIDIAN Ticketing, PLATFORM_STRATEGY.md §21).
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, Ticket as TicketIcon } from "lucide-react";
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

type TicketRow = {
  id: string; subject: string; category: string | null; priority: string; status: string;
  slaDeadline: string | null; createdAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-ct-saffron/20 text-ct-saffron",
  in_progress: "bg-ct-teal/20 text-ct-teal",
  resolved: "bg-green-100 text-green-700",
  closed: "bg-ct-cloud text-ct-muted",
};

export default function TicketsPage() {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("medium");
  const [slaHours, setSlaHours] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/tickets");
    const data = await res.json();
    setTickets(data.tickets ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createTicket = async () => {
    if (!subject.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject, category: category || undefined, priority,
          slaHours: slaHours ? Number(slaHours) : undefined,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Ticket created");
      setOpen(false);
      setSubject(""); setCategory(""); setPriority("medium"); setSlaHours("");
      load();
    } catch {
      toast.error("Failed to create ticket");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Ticketing</h1>
          <p className="text-sm text-ct-muted mt-1">Customer-facing support tickets. Every ticket is a VERI Chat conversation underneath -- invite an external customer as a guest to reply without an account.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/problem-records"><Button variant="outline">Problem Records</Button></Link>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              <Plus className="size-4 mr-2" />
              New Ticket
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Ticket</DialogTitle>
              <DialogDescription>You can invite an external guest to it once created.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Can't access the reports page" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Category (optional)</Label>
                  <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="technical" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">SLA (hours from now, optional)</Label>
                <Input type="number" value={slaHours} onChange={(e) => setSlaHours(e.target.value)} placeholder="24" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createTicket} disabled={creating || !subject.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Ticket
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : tickets.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center space-y-2">
            <TicketIcon className="size-10 text-ct-muted mx-auto" />
            <p className="text-sm text-ct-muted">No tickets yet. Create the first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {tickets.map((ticket) => (
            <Link key={ticket.id} href={`/tickets/${ticket.id}`} className="px-4 py-3 flex items-center gap-3 hover:bg-ct-cloud transition-colors">
              <TicketIcon className="size-4 text-ct-teal shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ct-navy truncate">{ticket.subject}</p>
                <p className="text-xs text-ct-muted">
                  {ticket.category || "General"} &middot; {ticket.priority}
                  {ticket.slaDeadline ? ` · SLA ${new Date(ticket.slaDeadline).toLocaleString()}` : ""}
                </p>
              </div>
              <Badge className={`text-xs border-0 ${STATUS_COLORS[ticket.status] ?? "bg-ct-cloud text-ct-muted"}`}>
                {ticket.status.replace("_", " ")}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
