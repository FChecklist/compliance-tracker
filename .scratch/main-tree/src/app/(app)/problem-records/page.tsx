"use client";

export const dynamic = "force-dynamic";

// Wave 81 (Customer Service enhancements, COMPARISON_CSV_GAP_ANALYSIS.md
// backlog #2): ITIL-style problem management -- a single underlying root
// cause that may manifest as several separate tickets.
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Problem = { id: string; title: string; rootCause: string | null; status: string; createdAt: string };

const STATUS_COLORS: Record<string, string> = {
  open: "bg-ct-saffron/20 text-ct-saffron",
  investigating: "bg-ct-teal/20 text-ct-teal",
  resolved: "bg-green-100 text-green-700",
};

export default function ProblemRecordsPage() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/problem-records");
    const data = await res.json();
    setProblems(data.problems ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const createProblem = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/problem-records", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, rootCause: rootCause || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Problem record created");
      setOpen(false); setTitle(""); setRootCause("");
      load();
    } catch {
      toast.error("Failed to create problem record");
    } finally {
      setCreating(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    setUpdatingId(id);
    const res = await fetch(`/api/problem-records/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    setUpdatingId(null);
    if (!res.ok) { toast.error("Failed to update status"); return; }
    load();
  };

  return (
    <div className="space-y-4">
      <Link href="/tickets" className="text-xs text-ct-muted hover:text-ct-navy flex items-center gap-1">
        <ArrowLeft className="size-3" /> Back to Tickets
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Problem Records</h1>
          <p className="text-sm text-ct-muted mt-1">Group multiple tickets under a single underlying root cause, ITIL-style, instead of tracking it separately on every ticket.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"><Plus className="size-4 mr-2" /> New Problem Record</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Problem Record</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intermittent login failures" /></div>
              <div><Label className="text-xs font-semibold text-ct-muted uppercase">Root Cause (optional)</Label><Input value={rootCause} onChange={(e) => setRootCause(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button onClick={createProblem} disabled={creating || !title.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : problems.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><AlertTriangle className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No problem records yet.</p></CardContent></Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {problems.map((p) => (
            <div key={p.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ct-navy">{p.title}</p>
                {p.rootCause && <p className="text-xs text-ct-muted">{p.rootCause}</p>}
              </div>
              <Badge className={`text-xs border-0 ${STATUS_COLORS[p.status] ?? ""}`}>{p.status}</Badge>
              <Select value={p.status} onValueChange={(v) => updateStatus(p.id, v)} disabled={updatingId === p.id}>
                <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="investigating">Investigating</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
