"use client";

export const dynamic = "force-dynamic";

// Wave 93 (Comparison CSV 3 gap analysis: MDM007 "Duplicate Detection" +
// MDM008 "Data Quality Scoring"). Scan runs pg_trgm similarity() +
// gstin/pan exact-match over erp_customers/erp_suppliers -- a real
// computation, not a fabricated score. Merge is scoped: it deactivates the
// loser and reassigns its contacts/addresses/(supplier) bank accounts, but
// does NOT rewrite historical invoices/POs still pointing at the merged id
// -- see mdm-quality-service.ts's file header for the full boundary.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Fingerprint, ScanSearch, Loader2, Check, X, GitMerge } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type DuplicateCandidate = {
  id: string; entityType: string; entityIdA: string; entityIdB: string;
  entityAName: string; entityBName: string; matchScore: string; matchReason: string; status: string;
};
type QualityScoreRow = { id: string; name: string; qualityScore: number; missingFields: string[] };

const REASON_LABEL: Record<string, string> = {
  name_similarity: "Name similarity", gstin_match: "GSTIN match", pan_match: "PAN match", combined: "Combined signals",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  pending: "secondary", confirmed_duplicate: "default", not_duplicate: "outline", merged: "outline",
};

export default function MdmQualityPage() {
  const [entityType, setEntityType] = useState("erp_customer");
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [scores, setScores] = useState<QualityScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const [mergeCandidate, setMergeCandidate] = useState<DuplicateCandidate | null>(null);
  const [merging, setMerging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [candRes, scoreRes] = await Promise.all([
      fetch(`/api/mdm/duplicates?entityType=${entityType}&status=pending`),
      fetch(`/api/mdm/quality-scores?entityType=${entityType}`),
    ]);
    setCandidates((await candRes.json()).candidates ?? []);
    setScores((await scoreRes.json()).scores ?? []);
    setLoading(false);
  }, [entityType]);

  useEffect(() => { load(); }, [load]);

  async function scan() {
    setScanning(true);
    const res = await fetch("/api/mdm/duplicates/scan", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType }),
    });
    setScanning(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Scan failed"); return; }
    const result = await res.json();
    toast.success(`Scanned ${result.scanned} pairs — ${result.newCandidates} new candidate(s)`);
    load();
  }

  async function review(candidateId: string, status: "confirmed_duplicate" | "not_duplicate") {
    const res = await fetch(`/api/mdm/duplicates/${candidateId}/review`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to update candidate"); return; }
    toast.success(status === "confirmed_duplicate" ? "Marked as duplicate — pick a survivor to merge" : "Dismissed as not a duplicate");
    load();
  }

  async function merge(survivingEntityId: string) {
    if (!mergeCandidate) return;
    setMerging(true);
    const res = await fetch(`/api/mdm/duplicates/${mergeCandidate.id}/merge`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ survivingEntityId }),
    });
    setMerging(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Merge failed"); return; }
    toast.success("Entities merged");
    setMergeCandidate(null);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><Fingerprint className="w-6 h-6" />Master Data Quality</h1>
          <p className="text-sm text-ct-muted mt-1">Duplicate detection (name similarity + GSTIN/PAN match) and completeness scoring for Customers/Suppliers.</p>
        </div>
        <div className="flex gap-2">
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="erp_customer">Customers</SelectItem>
              <SelectItem value="erp_supplier">Suppliers</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={scan} disabled={scanning} className="bg-ct-teal hover:bg-ct-teal/90">
            {scanning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ScanSearch className="w-4 h-4 mr-1" />}Scan for Duplicates
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-4 space-y-3">
              <h3 className="font-medium text-ct-navy text-sm">Duplicate Candidates ({candidates.length})</h3>
              {candidates.length === 0 ? (
                <p className="text-xs text-ct-muted">No pending duplicate candidates. Run a scan to check for new ones.</p>
              ) : (
                <ul className="space-y-2">
                  {candidates.map((c) => (
                    <li key={c.id} className="border border-ct-border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-ct-navy">{c.entityAName} <span className="text-ct-muted">vs</span> {c.entityBName}</span>
                        <Badge variant={STATUS_VARIANT[c.status] ?? "outline"}>{Math.round(Number(c.matchScore) * 100)}%</Badge>
                      </div>
                      <p className="text-xs text-ct-muted">{REASON_LABEL[c.matchReason] ?? c.matchReason}</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => review(c.id, "confirmed_duplicate")}><Check className="w-3 h-3 mr-1" />Confirm duplicate</Button>
                        <Button size="sm" variant="outline" onClick={() => review(c.id, "not_duplicate")}><X className="w-3 h-3 mr-1" />Not a duplicate</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-4 space-y-3">
              <h3 className="font-medium text-ct-navy text-sm">Data Completeness Scores</h3>
              <ul className="space-y-2 max-h-[420px] overflow-y-auto">
                {scores.length === 0 ? <li className="text-xs text-ct-muted">No active records.</li> : scores.map((s) => (
                  <li key={s.id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-ct-navy">{s.name}</span>
                      <span className="text-ct-muted">{Math.round(s.qualityScore * 100)}%</span>
                    </div>
                    <Progress value={s.qualityScore * 100} className="h-1.5" />
                    {s.missingFields.length > 0 && <p className="text-[11px] text-ct-muted">Missing: {s.missingFields.join(", ")}</p>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmedDuplicatesPanel entityType={entityType} onMerge={setMergeCandidate} refreshKey={candidates.length} />

      <Dialog open={!!mergeCandidate} onOpenChange={(open) => !open && setMergeCandidate(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Merge Duplicate Entities</DialogTitle></DialogHeader>
          {mergeCandidate && (
            <div className="space-y-3 text-sm">
              <p className="text-ct-muted">Pick which record survives. The other is deactivated; its contacts/addresses{mergeCandidate.entityType === "erp_supplier" ? "/bank accounts" : ""} move to the survivor. Historical invoices/POs stay on their original record.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => merge(mergeCandidate.entityIdA)} disabled={merging}>{mergeCandidate.entityAName} survives</Button>
                <Button variant="outline" onClick={() => merge(mergeCandidate.entityIdB)} disabled={merging}>{mergeCandidate.entityBName} survives</Button>
              </div>
            </div>
          )}
          <DialogFooter />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfirmedDuplicatesPanel({ entityType, onMerge }: { entityType: string; onMerge: (c: DuplicateCandidate) => void; refreshKey: number }) {
  const [confirmed, setConfirmed] = useState<DuplicateCandidate[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/mdm/duplicates?entityType=${entityType}&status=confirmed_duplicate`);
    setConfirmed((await res.json()).candidates ?? []);
  }, [entityType]);

  useEffect(() => { load(); }, [load]);

  if (confirmed.length === 0) return null;

  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardContent className="p-4 space-y-3">
        <h3 className="font-medium text-ct-navy text-sm">Confirmed Duplicates Awaiting Merge ({confirmed.length})</h3>
        <ul className="space-y-2">
          {confirmed.map((c) => (
            <li key={c.id} className="flex items-center justify-between text-xs border border-ct-border rounded-lg p-3">
              <span>{c.entityAName} vs {c.entityBName}</span>
              <Button size="sm" onClick={() => onMerge(c)}><GitMerge className="w-3 h-3 mr-1" />Merge</Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
