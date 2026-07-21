"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 6 batch 2 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR): change orders with a real e-signature approval
// workflow. Backend (construction-change-order-service.ts, Wave 141)
// reuses the existing esignature-service.ts rather than a bespoke
// approve/reject flag -- see that service's own comment: a PATCH
// action:"approve"/"reject" branch used to let ANY caller flip a change
// order to approved with zero signature ever happening, and was removed as
// a real integrity bypass. The only way to move a draft change order
// forward is "submit for approval", which dispatches a real signature
// request; approval/rejection then happens automatically, server-side,
// once every signer has actually signed or one declines. This list page
// (ported from PROJEXA's own ChangeOrdersClient.tsx, table + inline
// signature-status cell) intentionally has no approve/reject button
// anywhere, matching that reference exactly. Row click drills into
// /change-orders/[id] for full detail + submit-for-approval + live
// signature progress (PROJEXA's own reference never split this into a
// detail page -- everything lived in the list row -- but this wave's brief
// specifically asked for one, and change orders carry enough workflow
// depth, same as scope/[id]'s BOQ detail page, to earn it).
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, FileSignature } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type ChangeOrder = {
  id: string; number: number; title: string; reason: string | null;
  costImpact: string; scheduleImpactDays: number; status: string;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-ct-cloud text-ct-muted",
  pending_approval: "bg-ct-saffron/20 text-ct-saffron",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export default function ChangeOrdersPage() {
  const currencies = useCurrencies();
  const money = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [items, setItems] = useState<ChangeOrder[]>([]);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [costImpact, setCostImpact] = useState("");
  const [scheduleImpactDays, setScheduleImpactDays] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: PickerProject[] = d.projects ?? [];
        setProjects(list);
        if (list.length > 0) setProjectId((prev) => prev || list[0].id);
      })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setLoadingProjects(false));
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/change-orders?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setItems(data.changeOrders ?? []);
    } catch {
      toast.error("Failed to load change orders");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const createChangeOrder = async () => {
    if (!projectId || !title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/change-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, title, reason: reason || undefined,
          costImpact: costImpact ? Number(costImpact) : 0,
          scheduleImpactDays: scheduleImpactDays ? Number(scheduleImpactDays) : 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Change order created");
      setOpen(false);
      setTitle(""); setReason(""); setCostImpact(""); setScheduleImpactDays("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to create change order");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Change Orders</h1>
          <p className="text-sm text-ct-muted mt-1">Cost/schedule variations per project, approved only via real e-signature -- no one-click approve button.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> New Change Order
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Change Order</DialogTitle><DialogDescription>Created as a draft; send for e-signature approval from the detail page.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Reason (optional)</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Cost Impact ({currencyLabel(undefined, currencies).trim()})</Label>
                  <Input type="number" value={costImpact} onChange={(e) => setCostImpact(e.target.value)} placeholder="+/- amount" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Schedule Impact (days)</Label>
                  <Input type="number" value={scheduleImpactDays} onChange={(e) => setScheduleImpactDays(e.target.value)} placeholder="+/- days" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createChangeOrder} disabled={creating || !title.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={FileSignature} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : items.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No change orders yet for this project.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead><TableHead>Title</TableHead><TableHead>Cost Impact</TableHead>
                      <TableHead>Schedule Impact</TableHead><TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((c) => (
                      <TableRow key={c.id} className="cursor-pointer hover:bg-ct-cloud/40">
                        <TableCell className="font-mono text-xs text-ct-muted">
                          <Link href={`/change-orders/${c.id}`} className="block">CO-{c.number}</Link>
                        </TableCell>
                        <TableCell className="font-medium text-ct-navy">
                          <Link href={`/change-orders/${c.id}`} className="block">{c.title}</Link>
                        </TableCell>
                        <TableCell className={Number(c.costImpact) >= 0 ? "text-red-600" : "text-green-700"}>{money(Number(c.costImpact))}</TableCell>
                        <TableCell className="text-ct-muted">{c.scheduleImpactDays > 0 ? `+${c.scheduleImpactDays}d` : c.scheduleImpactDays === 0 ? "--" : `${c.scheduleImpactDays}d`}</TableCell>
                        <TableCell><Badge className={`text-xs border-0 ${STATUS_COLORS[c.status] ?? "bg-ct-cloud text-ct-muted"}`}>{c.status.replace(/_/g, " ")}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
