"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 62 (Performance Appraisal, ERP benchmark Tier 3 #14). 2 tabs: Review
// Cycles (admin creates/activates/closes) and Reviews (per-employee record
// within a cycle -- draft edit -> submit -> acknowledge).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { CalendarRange, Plus, Loader2, ClipboardCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type Cycle = { id: string; name: string; startDate: string; endDate: string; status: string };
type Review = {
  id: string; cycleId: string; employeeProfileId: string; selfRating: number | null; managerRating: number | null;
  strengths: string | null; improvements: string | null; goalsForNextPeriod: string | null; status: string;
};

export default function PerformanceReviewsPage() {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  const [cycleDialogOpen, setCycleDialogOpen] = useState(false);
  const [cycleName, setCycleName] = useState("");
  const [cycleStart, setCycleStart] = useState("");
  const [cycleEnd, setCycleEnd] = useState("");
  const [creatingCycle, setCreatingCycle] = useState(false);

  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [managerRating, setManagerRating] = useState("");
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [goals, setGoals] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [cyclesRes, reviewsRes] = await Promise.all([fetch("/api/performance-reviews/cycles"), fetch("/api/performance-reviews/reviews")]);
    const cyclesData = await cyclesRes.json();
    const reviewsData = await reviewsRes.json();
    setCycles(cyclesData.cycles ?? []);
    setReviews(reviewsData.reviews ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const createCycle = async () => {
    if (!cycleName.trim() || !cycleStart || !cycleEnd) return;
    setCreatingCycle(true);
    try {
      const res = await fetch("/api/performance-reviews/cycles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cycleName, startDate: cycleStart, endDate: cycleEnd }),
      });
      if (!res.ok) throw new Error();
      toast.success("Review cycle created");
      setCycleDialogOpen(false); setCycleName(""); setCycleStart(""); setCycleEnd("");
      load();
    } catch { toast.error("Failed to create review cycle"); } finally { setCreatingCycle(false); }
  };

  const activateCycle = async (id: string) => {
    try {
      const res = await fetch(`/api/performance-reviews/cycles/${id}/activate`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Cycle activated"); load();
    } catch { toast.error("Failed to activate cycle"); }
  };

  const closeCycle = async (id: string) => {
    try {
      const res = await fetch(`/api/performance-reviews/cycles/${id}/close`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Cycle closed"); load();
    } catch { toast.error("Failed to close cycle"); }
  };

  const openEditReview = (review: Review) => {
    setEditingReview(review);
    setManagerRating(review.managerRating != null ? String(review.managerRating) : "");
    setStrengths(review.strengths ?? ""); setImprovements(review.improvements ?? ""); setGoals(review.goalsForNextPeriod ?? "");
  };

  const saveReviewDraft = async () => {
    if (!editingReview) return;
    setSavingReview(true);
    try {
      const res = await fetch(`/api/performance-reviews/reviews/${editingReview.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerRating: managerRating ? Number(managerRating) : undefined, strengths, improvements, goalsForNextPeriod: goals }),
      });
      if (!res.ok) throw new Error();
      toast.success("Review saved"); setEditingReview(null); load();
    } catch { toast.error("Failed to save review"); } finally { setSavingReview(false); }
  };

  const submitReview = async (id: string) => {
    try {
      const res = await fetch(`/api/performance-reviews/reviews/${id}/submit`, { method: "POST" });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
      toast.success("Review submitted"); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to submit review"); }
  };

  const acknowledgeReview = async (id: string) => {
    try {
      const res = await fetch(`/api/performance-reviews/reviews/${id}/acknowledge`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Review acknowledged"); load();
    } catch { toast.error("Failed to acknowledge review"); }
  };

  const cycleName2 = (id: string) => cycles.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Performance Reviews</h1>
        <p className="text-sm text-ct-muted mt-1">Review cycles and per-employee appraisals.</p>
      </div>

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : (
        <Tabs defaultValue="cycles">
          <TabsList>
            <TabsTrigger value="cycles">Review Cycles</TabsTrigger>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
          </TabsList>

          <TabsContent value="cycles" className="space-y-3">
            <div className="flex justify-end">
              <Dialog open={cycleDialogOpen} onOpenChange={setCycleDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"><Plus className="size-4 mr-2" />New Cycle</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Review Cycle</DialogTitle><DialogDescription>e.g. "H1 2026"</DialogDescription></DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label><Input value={cycleName} onChange={(e) => setCycleName(e.target.value)} /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Start date</Label><Input type="date" value={cycleStart} onChange={(e) => setCycleStart(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">End date</Label><Input type="date" value={cycleEnd} onChange={(e) => setCycleEnd(e.target.value)} /></div>
                    </div>
                  </div>
                  <DialogFooter><Button onClick={createCycle} disabled={creatingCycle || !cycleName.trim() || !cycleStart || !cycleEnd} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">{creatingCycle ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}Create</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {cycles.length === 0 ? (
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><CalendarRange className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No review cycles yet.</p></CardContent></Card>
            ) : (
              <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
                {cycles.map((c) => (
                  <div key={c.id} className="px-4 py-3 flex items-center gap-3">
                    <CalendarRange className="size-4 text-ct-teal shrink-0" />
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium text-ct-navy">{c.name}</p><p className="text-xs text-ct-muted">{c.startDate} to {c.endDate}</p></div>
                    <Badge variant={c.status === "active" ? "default" : "secondary"} className="text-xs">{c.status}</Badge>
                    {c.status === "draft" && <Button size="sm" variant="ghost" onClick={() => activateCycle(c.id)}>Activate</Button>}
                    {c.status === "active" && <Button size="sm" variant="ghost" onClick={() => closeCycle(c.id)}>Close</Button>}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="reviews" className="space-y-3">
            {reviews.length === 0 ? (
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><ClipboardCheck className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No reviews yet. Reviews are created per cycle via the API for now.</p></CardContent></Card>
            ) : (
              <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
                {reviews.map((r) => (
                  <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                    <ClipboardCheck className="size-4 text-ct-teal shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ct-navy">{cycleName2(r.cycleId)}</p>
                      <p className="text-xs text-ct-muted">Manager rating: {r.managerRating ?? "--"} / 5</p>
                    </div>
                    <Badge variant={r.status === "acknowledged" ? "default" : "secondary"} className="text-xs">{r.status}</Badge>
                    {r.status === "pending" && <Button size="sm" variant="ghost" onClick={() => openEditReview(r)}>Edit</Button>}
                    {r.status === "pending" && <Button size="sm" variant="ghost" onClick={() => submitReview(r.id)}>Submit</Button>}
                    {r.status === "submitted" && <Button size="sm" variant="ghost" onClick={() => acknowledgeReview(r.id)}>Acknowledge</Button>}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={!!editingReview} onOpenChange={(open) => !open && setEditingReview(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Review</DialogTitle><DialogDescription>A manager rating is required before submitting.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Manager rating (1-5)</Label><Input type="number" min={1} max={5} value={managerRating} onChange={(e) => setManagerRating(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Strengths</Label><Textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Areas for improvement</Label><Textarea value={improvements} onChange={(e) => setImprovements(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Goals for next period</Label><Textarea value={goals} onChange={(e) => setGoals(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={saveReviewDraft} disabled={savingReview} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">{savingReview ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
