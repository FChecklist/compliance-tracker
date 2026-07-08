"use client";

export const dynamic = "force-dynamic";

// MCA e-Filing -- preparation/status tracking (pre-existing) plus real
// filing-ready form-data generation (AOC-4/MGT-7/DIR-12/CHG-1), sourced
// from directors_kmp/cap_table_entries/company_charges/board_meetings and
// the ERP balance-sheet/P&L engine. Still stops at compiling data -- no
// portal submission, requires the CS's own DSC on the MCA portal.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, FileJson, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Filing = { id: string; formType: string; description: string | null; dueDate: string | null; status: string; srn: string | null; formData: unknown; generatedAt: string | null };
type Director = { id: string; name: string; din: string | null };
type Charge = { id: string; chargeHolder: string; chargeType: string | null };

const STATUS_COLORS: Record<string, string> = { preparing: "bg-ct-cloud text-ct-muted", ready_to_file: "bg-amber-100 text-amber-700", filed: "bg-green-100 text-green-700" };
const FORM_TYPES_NEEDING_FY = new Set(["AOC-4", "MGT-7", "MGT-7A"]);
const FORM_TYPES_NEEDING_DIRECTOR = new Set(["DIR-12", "DIR-3"]);
const FORM_TYPES_NEEDING_CHARGE = new Set(["CHG-1", "CHG-4"]);

export default function McaFilingsPage() {
  const [filings, setFilings] = useState<Filing[]>([]);
  const [directors, setDirectors] = useState<Director[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFiling, setSelectedFiling] = useState<Filing | null>(null);

  const [trackOpen, setTrackOpen] = useState(false);
  const [formType, setFormType] = useState(""); const [description, setDescription] = useState(""); const [dueDate, setDueDate] = useState("");

  const [fyStart, setFyStart] = useState(""); const [fyEnd, setFyEnd] = useState("");
  const [directorId, setDirectorId] = useState(""); const [chargeId, setChargeId] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(() => {
    Promise.all([fetch("/api/mca-filings"), fetch("/api/directors"), fetch("/api/charges")])
      .then(([f, d, c]) => Promise.all([f.json(), d.json(), c.json()]))
      .then(([f, d, c]) => { setFilings(f.filings ?? []); setDirectors(d.directors ?? []); setCharges(c.charges ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const trackFiling = async () => {
    if (!formType.trim()) { toast.error("Form type is required"); return; }
    const res = await fetch("/api/mca-filings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formType, description, dueDate: dueDate || undefined }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to track filing"); return; }
    toast.success("Filing tracked"); setTrackOpen(false); setFormType(""); setDescription(""); setDueDate(""); load();
  };

  const openFiling = async (f: Filing) => {
    const res = await fetch(`/api/mca-filings/${f.id}`);
    const d = await res.json();
    setSelectedFiling(d.filing ?? f);
  };

  const generate = async () => {
    if (!selectedFiling) return;
    const formTypeUpper = selectedFiling.formType.trim().toUpperCase();
    const body: Record<string, string> = {};
    if (FORM_TYPES_NEEDING_FY.has(formTypeUpper)) {
      if (!fyStart || !fyEnd) { toast.error("Financial year start and end dates are required"); return; }
      body.financialYearStart = fyStart; body.financialYearEnd = fyEnd;
    } else if (FORM_TYPES_NEEDING_DIRECTOR.has(formTypeUpper)) {
      if (!directorId) { toast.error("Select a director"); return; }
      body.directorId = directorId;
    } else if (FORM_TYPES_NEEDING_CHARGE.has(formTypeUpper)) {
      if (!chargeId) { toast.error("Select a charge"); return; }
      body.chargeId = chargeId;
    }

    setGenerating(true);
    const res = await fetch(`/api/mca-filings/${selectedFiling.id}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setGenerating(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to generate form data"); return; }
    const d = await res.json();
    setSelectedFiling(d.filing);
    toast.success("Form data generated");
    load();
  };

  const downloadFormData = () => {
    if (!selectedFiling?.formData) return;
    const blob = new Blob([JSON.stringify(selectedFiling.formData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${selectedFiling.formType}_${selectedFiling.id}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const formTypeUpper = selectedFiling?.formType.trim().toUpperCase() ?? "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">MCA e-Filing</h1>
          <p className="text-sm text-ct-muted mt-1">Preparation, status tracking, and real filing-ready form data (AOC-4, MGT-7, DIR-12, CHG-1) — this platform does not submit to the MCA portal; that requires the CS's own Digital Signature Certificate</p>
        </div>
        <Dialog open={trackOpen} onOpenChange={setTrackOpen}>
          <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />Track New Filing</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Track New Filing</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Form Type</Label><Input value={formType} onChange={e => setFormType(e.target.value)} placeholder="e.g. AOC-4, MGT-7, DIR-12, CHG-1" /></div>
              <div><Label>Description</Label><Input value={description} onChange={e => setDescription(e.target.value)} /></div>
              <div><Label>Due Date</Label><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={trackFiling} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Track</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border">
              <th className="p-3 font-medium">Form</th><th className="p-3 font-medium">Description</th><th className="p-3 font-medium">Due</th>
              <th className="p-3 font-medium">Status</th><th className="p-3 font-medium">SRN</th><th className="p-3 font-medium"></th>
            </tr></thead>
            <tbody className="divide-y divide-ct-border">
              {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                : filings.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No MCA filings tracked.</td></tr>
                : filings.map(f => (
                  <tr key={f.id} className={`hover:bg-ct-row-hover cursor-pointer ${selectedFiling?.id === f.id ? "bg-ct-row-hover" : ""}`} onClick={() => openFiling(f)}>
                    <td className="p-3 font-medium text-ct-navy">{f.formType}</td><td className="p-3">{f.description ?? "—"}</td>
                    <td className="p-3">{f.dueDate ? new Date(f.dueDate).toLocaleDateString("en-IN") : "—"}</td>
                    <td className="p-3"><Badge className={STATUS_COLORS[f.status] ?? ""}>{f.status}</Badge></td>
                    <td className="p-3">{f.srn ?? "—"}</td>
                    <td className="p-3">{f.generatedAt && <Badge className="bg-blue-100 text-blue-700"><FileJson className="w-3 h-3 mr-1" />data ready</Badge>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {selectedFiling && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-lg text-ct-navy">Generate Form Data — {selectedFiling.formType}</h3>
              {selectedFiling.formData ? <Button size="sm" variant="outline" onClick={downloadFormData}><FileJson className="w-3.5 h-3.5 mr-1" />Download JSON</Button> : null}
            </div>

            {FORM_TYPES_NEEDING_FY.has(formTypeUpper) && (
              <div className="flex gap-3">
                <div className="flex-1"><Label>Financial Year Start</Label><Input type="date" value={fyStart} onChange={e => setFyStart(e.target.value)} /></div>
                <div className="flex-1"><Label>Financial Year End</Label><Input type="date" value={fyEnd} onChange={e => setFyEnd(e.target.value)} /></div>
              </div>
            )}
            {FORM_TYPES_NEEDING_DIRECTOR.has(formTypeUpper) && (
              <div><Label>Director</Label>
                <Select value={directorId} onValueChange={setDirectorId}>
                  <SelectTrigger><SelectValue placeholder="Select director" /></SelectTrigger>
                  <SelectContent>{directors.map(d => <SelectItem key={d.id} value={d.id}>{d.name}{d.din ? ` (DIN ${d.din})` : ""}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {FORM_TYPES_NEEDING_CHARGE.has(formTypeUpper) && (
              <div><Label>Charge</Label>
                <Select value={chargeId} onValueChange={setChargeId}>
                  <SelectTrigger><SelectValue placeholder="Select charge" /></SelectTrigger>
                  <SelectContent>{charges.map(c => <SelectItem key={c.id} value={c.id}>{c.chargeHolder}{c.chargeType ? ` — ${c.chargeType}` : ""}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {!FORM_TYPES_NEEDING_FY.has(formTypeUpper) && !FORM_TYPES_NEEDING_DIRECTOR.has(formTypeUpper) && !FORM_TYPES_NEEDING_CHARGE.has(formTypeUpper) && (
              <p className="text-sm text-ct-muted">No form-data generator implemented for &quot;{selectedFiling.formType}&quot; yet — supported: AOC-4, MGT-7, DIR-12/DIR-3, CHG-1/CHG-4.</p>
            )}

            <Button onClick={generate} disabled={generating} className="bg-ct-navy hover:bg-ct-navy/90 text-white"><Sparkles className="w-3.5 h-3.5 mr-1" />{generating && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Generate</Button>

            {!!selectedFiling.formData && (
              <pre className="text-xs bg-ct-cloud/40 p-3 rounded-lg overflow-auto max-h-96">{JSON.stringify(selectedFiling.formData, null, 2)}</pre>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
