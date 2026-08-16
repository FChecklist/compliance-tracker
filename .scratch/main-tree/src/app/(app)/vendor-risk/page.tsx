"use client";

export const dynamic = "force-dynamic";

// Vendor & Third-Party Risk -- riskTier was a manually-picked free-text
// field with nothing computing it. Now backed by a real deterministic 0-100
// score (VCEL GRC Workflow Engine's computeVendorRiskScore) from a short
// assessment questionnaire.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, ClipboardCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type RiskFactor = { label: string; points: number };
type Vendor = { id: string; name: string; riskTier: string; riskScore: number | null; riskFactors: RiskFactor[] | null; certifications: string[]; lastAssessedDate: string | null };

const TIER_COLORS: Record<string, string> = { low: "bg-green-100 text-green-700", medium: "bg-amber-100 text-amber-700", high: "bg-orange-100 text-orange-700", critical: "bg-red-100 text-red-700" };

export default function VendorRiskPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Vendor | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");

  const [assessOpen, setAssessOpen] = useState(false);
  const [gstin, setGstin] = useState(""); const [pan, setPan] = useState("");
  const [incidentCount, setIncidentCount] = useState("0"); const [contractValueInr, setContractValueInr] = useState("0");
  const [assessing, setAssessing] = useState(false);

  const load = useCallback(() => {
    fetch("/api/vendor-risk").then(r => r.json()).then(d => { setVendors(d.vendors ?? []); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const createVendor = async () => {
    if (!name.trim()) { toast.error("Vendor name is required"); return; }
    const res = await fetch("/api/vendor-risk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to add vendor"); return; }
    toast.success("Vendor added"); setNewOpen(false); setName(""); load();
  };

  const runAssessment = async () => {
    if (!selected) return;
    setAssessing(true);
    const res = await fetch(`/api/vendor-risk/${selected.id}/assess`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gstin: gstin || undefined, pan: pan || undefined, incidentCount: Number(incidentCount), contractValueInr: Number(contractValueInr) }),
    });
    setAssessing(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to assess vendor"); return; }
    const d = await res.json();
    setSelected(d.vendor);
    toast.success(`Risk score: ${d.assessment.score} (${d.assessment.tier})`);
    setAssessOpen(false);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Vendor & Third-Party Risk</h1>
          <p className="text-sm text-ct-muted mt-1">Due diligence and ongoing risk tracking, with a real deterministic risk score</p>
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />Add Vendor</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Vendor</DialogTitle></DialogHeader>
            <div><Label>Vendor Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
            <DialogFooter><Button onClick={createVendor} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Add</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border">
              <th className="p-3 font-medium">Vendor</th><th className="p-3 font-medium">Risk Tier</th><th className="p-3 font-medium">Score</th><th className="p-3 font-medium">Last Assessed</th><th className="p-3 font-medium"></th>
            </tr></thead>
            <tbody className="divide-y divide-ct-border">
              {loading ? <tr><td colSpan={5} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                : vendors.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-ct-muted">No vendors assessed yet.</td></tr>
                : vendors.map(v => (
                  <tr key={v.id} className={`hover:bg-ct-row-hover cursor-pointer ${selected?.id === v.id ? "bg-ct-row-hover" : ""}`} onClick={() => setSelected(v)}>
                    <td className="p-3 font-medium text-ct-navy">{v.name}</td>
                    <td className="p-3"><Badge className={TIER_COLORS[v.riskTier] ?? ""}>{v.riskTier}</Badge></td>
                    <td className="p-3">{v.riskScore ?? "—"}</td>
                    <td className="p-3">{v.lastAssessedDate ? new Date(v.lastAssessedDate).toLocaleDateString("en-IN") : "Not yet assessed"}</td>
                    <td className="p-3">
                      <Dialog open={assessOpen && selected?.id === v.id} onOpenChange={(o) => { setAssessOpen(o); if (o) setSelected(v); }}>
                        <DialogTrigger asChild><Button size="sm" variant="outline" className="h-7 text-xs" onClick={(e) => e.stopPropagation()}><ClipboardCheck className="w-3 h-3 mr-1" />Assess</Button></DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Assess {v.name}</DialogTitle></DialogHeader>
                          <div className="space-y-3">
                            <div className="flex gap-3">
                              <div className="flex-1"><Label>GSTIN (optional)</Label><Input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" /></div>
                              <div className="flex-1"><Label>PAN (optional)</Label><Input value={pan} onChange={e => setPan(e.target.value.toUpperCase())} placeholder="AAAAA0000A" /></div>
                            </div>
                            <div className="flex gap-3">
                              <div className="flex-1"><Label>Past Incidents/Complaints</Label><Input type="number" value={incidentCount} onChange={e => setIncidentCount(e.target.value)} /></div>
                              <div className="flex-1"><Label>Contract Value (₹)</Label><Input type="number" value={contractValueInr} onChange={e => setContractValueInr(e.target.value)} /></div>
                            </div>
                          </div>
                          <DialogFooter><Button onClick={runAssessment} disabled={assessing} className="bg-ct-navy hover:bg-ct-navy/90 text-white">{assessing && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Run Assessment</Button></DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {selected?.riskFactors && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-4">
            <h3 className="font-heading text-lg text-ct-navy mb-3">Score Breakdown — {selected.name} ({selected.riskScore}/100)</h3>
            <div className="space-y-1.5">
              {selected.riskFactors.map((f, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm border-b border-ct-border pb-1.5">
                  <span className="text-ct-navy">{f.label}</span>
                  <span className={f.points > 0 ? "text-red-600" : f.points < 0 ? "text-green-600" : "text-ct-muted"}>{f.points > 0 ? "+" : ""}{f.points}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
