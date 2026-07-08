"use client";

export const dynamic = "force-dynamic";

// Legal Opinions Register -- was a pure tracker (topic/advisor/date, no
// drafting). Now generates a real opinion draft via token substitution over
// the existing CLM clause library/templates (same infrastructure
// erp-contract-service.ts's generateContractFromTemplate already uses for
// contracts -- a template's clauses aren't inherently contract-specific).
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Sparkles, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Opinion = { id: string; topic: string; opinionDate: string | null; advisor: string | null; bodyText: string | null; generatedAt: string | null };
type Template = { id: string; name: string; contractType: string | null };

export default function LegalOpinionsPage() {
  const [opinions, setOpinions] = useState<Opinion[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Opinion | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [topic, setTopic] = useState(""); const [advisor, setAdvisor] = useState("");

  const [templateId, setTemplateId] = useState("");
  const [clientName, setClientName] = useState(""); const [keyFacts, setKeyFacts] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(() => {
    Promise.all([fetch("/api/legal-opinions"), fetch("/api/clm/templates")])
      .then(([o, t]) => Promise.all([o.json(), t.json()]))
      .then(([o, t]) => { setOpinions(o.opinions ?? []); setTemplates(t.templates ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const createOpinion = async () => {
    if (!topic.trim()) { toast.error("Topic is required"); return; }
    const res = await fetch("/api/legal-opinions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, advisor }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to record opinion"); return; }
    toast.success("Opinion recorded"); setNewOpen(false); setTopic(""); setAdvisor(""); load();
  };

  const openOpinion = async (o: Opinion) => {
    const res = await fetch(`/api/legal-opinions/${o.id}`);
    const d = await res.json();
    setSelected(d.opinion ?? o);
  };

  const generate = async () => {
    if (!selected || !templateId) { toast.error("Select a template"); return; }
    setGenerating(true);
    const res = await fetch(`/api/legal-opinions/${selected.id}/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, tokens: { clientName, keyFacts } }),
    });
    setGenerating(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to generate draft"); return; }
    const d = await res.json();
    setSelected(d.opinion);
    toast.success("Draft generated"); load();
  };

  const downloadDraft = () => {
    if (!selected?.bodyText) return;
    const blob = new Blob([selected.bodyText], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${selected.topic.replace(/\s+/g, "_")}_opinion.md`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Legal Opinions Register</h1>
          <p className="text-sm text-ct-muted mt-1">Formal legal opinions, with real draft generation from the clause library</p>
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />Record Opinion</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Record Legal Opinion</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Topic</Label><Input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Enforceability of non-compete clause" /></div>
              <div><Label>Advisor</Label><Input value={advisor} onChange={e => setAdvisor(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={createOpinion} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Record</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border">
              <th className="p-3 font-medium">Topic</th><th className="p-3 font-medium">Advisor</th><th className="p-3 font-medium">Date</th><th className="p-3 font-medium"></th>
            </tr></thead>
            <tbody className="divide-y divide-ct-border">
              {loading ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                : opinions.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No opinions recorded.</td></tr>
                : opinions.map(o => (
                  <tr key={o.id} className={`hover:bg-ct-row-hover cursor-pointer ${selected?.id === o.id ? "bg-ct-row-hover" : ""}`} onClick={() => openOpinion(o)}>
                    <td className="p-3 font-medium text-ct-navy">{o.topic}</td><td className="p-3">{o.advisor ?? "—"}</td>
                    <td className="p-3">{o.opinionDate ? new Date(o.opinionDate).toLocaleDateString("en-IN") : "—"}</td>
                    <td className="p-3">{o.generatedAt && <Badge className="bg-blue-100 text-blue-700">drafted</Badge>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {selected && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-lg text-ct-navy">Generate Draft — {selected.topic}</h3>
              {selected.bodyText && <Button size="sm" variant="outline" onClick={downloadDraft}><Download className="w-3.5 h-3.5 mr-1" />Download</Button>}
            </div>
            <div><Label>Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="Select a clause template" /></SelectTrigger>
                <SelectContent>{templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
              {templates.length === 0 && <p className="text-xs text-ct-muted mt-1">No CLM templates yet — create one under Clause Library & Templates first.</p>}
            </div>
            <div className="flex gap-3">
              <div className="flex-1"><Label>Client Name</Label><Input value={clientName} onChange={e => setClientName(e.target.value)} /></div>
              <div className="flex-1"><Label>Key Facts</Label><Input value={keyFacts} onChange={e => setKeyFacts(e.target.value)} /></div>
            </div>
            <Button onClick={generate} disabled={generating || !templateId} className="bg-ct-navy hover:bg-ct-navy/90 text-white">{generating && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}<Sparkles className="w-3.5 h-3.5 mr-1" />Generate Draft</Button>

            {selected.bodyText && <pre className="text-xs bg-ct-cloud/40 p-3 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap">{selected.bodyText}</pre>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
