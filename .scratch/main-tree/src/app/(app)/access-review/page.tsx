"use client";

export const dynamic = "force-dynamic";

// Wave 97 (Comparison CSV 3 gap analysis: IAM010 "Access Review"). A real
// periodic certification cycle over existing RBAC assignments, not a
// static report -- admin-gated (opening a cycle snapshots every active
// user's current role; per-user detail page records confirm/revoke).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { ClipboardCheck, Plus, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Cycle = { id: string; name: string; status: string; dueDate: string | null; createdAt: string };

export default function AccessReviewPage() {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/access-review/cycles");
    setCycles((await res.json()).cycles ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createCycle() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setCreating(true);
    const res = await fetch("/api/access-review/cycles", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, dueDate: dueDate || undefined }),
    });
    setCreating(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to create review cycle"); return; }
    toast.success("Access review cycle created");
    setDialogOpen(false);
    setName(""); setDueDate("");
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><ClipboardCheck className="w-6 h-6" />Access Review</h1>
          <p className="text-sm text-ct-muted mt-1">Periodic certification of every active user's role — confirm or revoke access.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal/90"><Plus className="w-4 h-4 mr-1" />New Review Cycle</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Access Review Cycle</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 2026 Access Certification" /></div>
              <div><Label>Due Date (optional)</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={createCycle} disabled={creating}>{creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create & Snapshot Active Users"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Due Date</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Created</th></tr></thead>
              <tbody className="divide-y divide-ct-border">
                {cycles.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No access review cycles yet.</td></tr>
                  : cycles.map((c) => (
                    <tr key={c.id} className="hover:bg-ct-row-hover cursor-pointer">
                      <td className="p-3"><Link href={`/access-review/${c.id}`} className="text-ct-navy hover:underline">{c.name}</Link></td>
                      <td className="p-3">{c.dueDate ?? "—"}</td>
                      <td className="p-3"><Badge variant={c.status === "completed" ? "outline" : "secondary"}>{c.status}</Badge></td>
                      <td className="p-3">{new Date(c.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
