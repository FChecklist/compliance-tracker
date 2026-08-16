"use client";

export const dynamic = "force-dynamic";

// Wave 90 (Comparison CSV 2 gap analysis: LEGAL001/002 unified Matter
// register + LEGAL004 Arbitration & Mediation + LEGAL009 Legal Spend).
// litigation_matters/ip_portfolio/legal_opinions each lived in their own
// table with no cross-cutting concept -- this page is the unifying register,
// linking existing rows in rather than duplicating them. Evidence Repository
// (LEGAL012) reuses the existing polymorphic documents table + upload
// pattern (same as erp/suppliers/[id]'s KYC documents section, Wave 80).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Gavel, Plus, Loader2, Upload, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Matter = { id: string; matterNumber: number; title: string; matterType: string; status: string; openedDate: string };
type LinkedLitigation = { id: string; matter: string; stage: string };
type LinkedIp = { id: string; mark: string; status: string };
type LinkedOpinion = { id: string; topic: string };
type Arbitration = { id: string; caseTitle: string; status: string; arbitrationInstitution: string | null; claimAmount: string | null };
type SpendEntry = { id: string; description: string; category: string; amount: string; spendDate: string };
type MatterDetail = Matter & { litigation: LinkedLitigation[]; ip: LinkedIp[]; opinions: LinkedOpinion[]; arbitrationCases: Arbitration[]; spendEntries: SpendEntry[]; totalSpend: number };
type Doc = { id: string; name: string; category: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = { open: "default", closed: "outline" };
const ARB_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = { filed: "outline", ongoing: "secondary", award_passed: "default", closed: "outline" };

function fmt(n: string | number) { return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function LegalMattersPage() {
  const [matters, setMatters] = useState<Matter[]>([]);
  const [litigationOptions, setLitigationOptions] = useState<LinkedLitigation[]>([]);
  const [ipOptions, setIpOptions] = useState<LinkedIp[]>([]);
  const [opinionOptions, setOpinionOptions] = useState<LinkedOpinion[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MatterDetail | null>(null);
  const [documents, setDocuments] = useState<Doc[]>([]);

  const [matterDialogOpen, setMatterDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [matterType, setMatterType] = useState("general");
  const [openedDate, setOpenedDate] = useState(new Date().toISOString().slice(0, 10));
  const [creating, setCreating] = useState(false);

  const [linkEntityType, setLinkEntityType] = useState<"litigation" | "ip" | "opinion">("litigation");
  const [linkEntityId, setLinkEntityId] = useState("");

  const [arbTitle, setArbTitle] = useState("");
  const [arbInstitution, setArbInstitution] = useState("");
  const [arbClaimAmount, setArbClaimAmount] = useState("");

  const [spendDesc, setSpendDesc] = useState("");
  const [spendAmount, setSpendAmount] = useState("");
  const [spendCategory, setSpendCategory] = useState("legal_fees");
  const [spendDate, setSpendDate] = useState(new Date().toISOString().slice(0, 10));

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const [matterRes, litRes, ipRes, opRes] = await Promise.all([
      fetch("/api/legal-matters"), fetch("/api/litigation"), fetch("/api/ip-portfolio"), fetch("/api/legal-opinions"),
    ]);
    setMatters((await matterRes.json()).matters ?? []);
    setLitigationOptions((await litRes.json()).matters ?? []);
    setIpOptions((await ipRes.json()).items ?? []);
    setOpinionOptions((await opRes.json()).opinions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadDetail(id: string) {
    setSelectedId(id);
    const [detailRes, docRes] = await Promise.all([
      fetch(`/api/legal-matters/${id}`),
      fetch(`/api/documents?linkedEntityType=legal_matter&linkedEntityId=${id}`),
    ]);
    setDetail(detailRes.ok ? await detailRes.json() : null);
    setDocuments((await docRes.json()).documents ?? []);
  }

  async function createMatter() {
    if (!title.trim() || !openedDate) { toast.error("Title and opened date are required"); return; }
    setCreating(true);
    const res = await fetch("/api/legal-matters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, matterType, openedDate }) });
    setCreating(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to create matter"); return; }
    toast.success("Legal matter created");
    setMatterDialogOpen(false);
    setTitle("");
    load();
  }

  async function linkEntity() {
    if (!selectedId || !linkEntityId) { toast.error("Select an entity to link"); return; }
    const res = await fetch(`/api/legal-matters/${selectedId}/link`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType: linkEntityType, entityId: linkEntityId }),
    });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to link entity"); return; }
    toast.success("Linked to matter");
    setLinkEntityId("");
    loadDetail(selectedId);
  }

  async function addArbitration() {
    if (!selectedId || !arbTitle.trim()) { toast.error("Case title is required"); return; }
    const res = await fetch(`/api/legal-matters/${selectedId}/arbitration`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseTitle: arbTitle, arbitrationInstitution: arbInstitution || undefined, claimAmount: arbClaimAmount ? Number(arbClaimAmount) : undefined }),
    });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to add arbitration case"); return; }
    setArbTitle(""); setArbInstitution(""); setArbClaimAmount("");
    loadDetail(selectedId);
  }

  async function advanceArbitration(id: string, status: string) {
    const res = await fetch(`/api/legal-matters/arbitration/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to update arbitration case"); return; }
    if (selectedId) loadDetail(selectedId);
  }

  async function addSpend() {
    if (!selectedId || !spendDesc.trim() || !spendAmount) { toast.error("Description and amount are required"); return; }
    const res = await fetch(`/api/legal-matters/${selectedId}/spend`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: spendDesc, amount: Number(spendAmount), category: spendCategory, spendDate }),
    });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to add spend entry"); return; }
    setSpendDesc(""); setSpendAmount("");
    loadDetail(selectedId);
  }

  async function uploadEvidence() {
    if (!selectedId || !uploadFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("linkedEntityType", "legal_matter");
      formData.append("linkedEntityId", selectedId);
      const res = await fetch("/api/documents", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Evidence document uploaded");
      setUploadFile(null);
      loadDetail(selectedId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><Gavel className="w-6 h-6" />Legal Matters</h1>
        <p className="text-sm text-ct-muted mt-1">Unified matter register — links litigation, IP, and opinions; arbitration tracking; matter-scoped legal spend; evidence repository.</p>
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <>
          <div className="flex justify-end mb-2">
            <Dialog open={matterDialogOpen} onOpenChange={setMatterDialogOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal/90"><Plus className="w-4 h-4 mr-1" />New Matter</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Legal Matter</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Vendor Contract Dispute" /></div>
                  <div>
                    <Label>Matter Type</Label>
                    <Select value={matterType} onValueChange={setMatterType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem><SelectItem value="litigation">Litigation</SelectItem>
                        <SelectItem value="ip">IP</SelectItem><SelectItem value="opinion">Opinion</SelectItem><SelectItem value="arbitration">Arbitration</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Opened Date</Label><Input type="date" value={openedDate} onChange={(e) => setOpenedDate(e.target.value)} /></div>
                </div>
                <DialogFooter><Button onClick={createMatter} disabled={creating}>{creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Matter"}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">#</th><th className="p-3 font-medium">Title</th><th className="p-3 font-medium">Type</th><th className="p-3 font-medium">Status</th></tr></thead>
                  <tbody className="divide-y divide-ct-border">
                    {matters.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No legal matters yet.</td></tr>
                      : matters.map((m) => (
                        <tr key={m.id} className={`hover:bg-ct-row-hover cursor-pointer ${selectedId === m.id ? "bg-ct-row-hover" : ""}`} onClick={() => loadDetail(m.id)}>
                          <td className="p-3">{m.matterNumber}</td>
                          <td className="p-3">{m.title}</td>
                          <td className="p-3">{m.matterType}</td>
                          <td className="p-3"><Badge variant={STATUS_VARIANT[m.status] ?? "outline"}>{m.status}</Badge></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4">
                {!selectedId || !detail ? (
                  <p className="text-sm text-ct-muted">Select a matter to view linked litigation/IP/opinions, arbitration, spend, and evidence.</p>
                ) : (
                  <div className="space-y-4">
                    <h3 className="font-medium text-ct-navy">{detail.title}</h3>

                    <div>
                      <h4 className="text-xs font-medium text-ct-muted mb-1">Linked Records</h4>
                      <div className="flex gap-2 mb-2">
                        <Select value={linkEntityType} onValueChange={(v) => setLinkEntityType(v as typeof linkEntityType)}>
                          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="litigation">Litigation</SelectItem><SelectItem value="ip">IP</SelectItem><SelectItem value="opinion">Opinion</SelectItem></SelectContent>
                        </Select>
                        <Select value={linkEntityId} onValueChange={setLinkEntityId}>
                          <SelectTrigger className="flex-1"><SelectValue placeholder="Select record to link" /></SelectTrigger>
                          <SelectContent>
                            {linkEntityType === "litigation" && litigationOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.matter}</SelectItem>)}
                            {linkEntityType === "ip" && ipOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.mark}</SelectItem>)}
                            {linkEntityType === "opinion" && opinionOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.topic}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button size="sm" onClick={linkEntity}><Plus className="w-3 h-3" /></Button>
                      </div>
                      <ul className="space-y-1 text-xs">
                        {detail.litigation.map((l) => <li key={l.id}>Litigation: {l.matter} <Badge variant="outline" className="ml-1">{l.stage}</Badge></li>)}
                        {detail.ip.map((i) => <li key={i.id}>IP: {i.mark} <Badge variant="outline" className="ml-1">{i.status}</Badge></li>)}
                        {detail.opinions.map((o) => <li key={o.id}>Opinion: {o.topic}</li>)}
                        {detail.litigation.length + detail.ip.length + detail.opinions.length === 0 && <li className="text-ct-muted">No linked records yet.</li>}
                      </ul>
                    </div>

                    <div>
                      <h4 className="text-xs font-medium text-ct-muted mb-1">Arbitration Cases</h4>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Input placeholder="Case title" value={arbTitle} onChange={(e) => setArbTitle(e.target.value)} className="flex-1 min-w-[120px]" />
                        <Input placeholder="Institution" value={arbInstitution} onChange={(e) => setArbInstitution(e.target.value)} className="w-32" />
                        <Input type="number" placeholder="Claim amount" value={arbClaimAmount} onChange={(e) => setArbClaimAmount(e.target.value)} className="w-28" />
                        <Button size="sm" onClick={addArbitration}><Plus className="w-3 h-3" /></Button>
                      </div>
                      <ul className="space-y-1 text-xs">
                        {detail.arbitrationCases.length === 0 ? <li className="text-ct-muted">None recorded.</li> : detail.arbitrationCases.map((a) => (
                          <li key={a.id} className="flex items-center justify-between">
                            <span>{a.caseTitle}{a.claimAmount ? ` — ${fmt(a.claimAmount)}` : ""}</span>
                            <div className="flex items-center gap-1">
                              <Badge variant={ARB_STATUS_VARIANT[a.status] ?? "outline"}>{a.status.replaceAll("_", " ")}</Badge>
                              {a.status === "filed" && <Button size="sm" variant="outline" className="h-6 text-[10px] px-1.5" onClick={() => advanceArbitration(a.id, "ongoing")}>Start</Button>}
                              {a.status === "ongoing" && <Button size="sm" variant="outline" className="h-6 text-[10px] px-1.5" onClick={() => advanceArbitration(a.id, "award_passed")}>Award</Button>}
                              {(a.status === "award_passed" || a.status === "ongoing") && <Button size="sm" variant="outline" className="h-6 text-[10px] px-1.5" onClick={() => advanceArbitration(a.id, "closed")}>Close</Button>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h4 className="text-xs font-medium text-ct-muted mb-1">Legal Spend (total {fmt(detail.totalSpend)})</h4>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Input placeholder="Description" value={spendDesc} onChange={(e) => setSpendDesc(e.target.value)} className="flex-1 min-w-[120px]" />
                        <Input type="number" placeholder="Amount" value={spendAmount} onChange={(e) => setSpendAmount(e.target.value)} className="w-24" />
                        <Select value={spendCategory} onValueChange={setSpendCategory}>
                          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="legal_fees">Legal Fees</SelectItem><SelectItem value="court_fees">Court Fees</SelectItem><SelectItem value="expert_fees">Expert Fees</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
                        </Select>
                        <Input type="date" value={spendDate} onChange={(e) => setSpendDate(e.target.value)} className="w-36" />
                        <Button size="sm" onClick={addSpend}><Plus className="w-3 h-3" /></Button>
                      </div>
                      <ul className="space-y-1 text-xs">
                        {detail.spendEntries.length === 0 ? <li className="text-ct-muted">None recorded.</li> : detail.spendEntries.map((s) => (
                          <li key={s.id}>{s.spendDate} — {s.description} ({s.category.replaceAll("_", " ")}) — {fmt(s.amount)}</li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h4 className="text-xs font-medium text-ct-muted mb-1 flex items-center gap-1"><FileText className="w-3 h-3" />Evidence Repository</h4>
                      <div className="flex items-center gap-2 mb-2">
                        <Input type="file" className="flex-1 text-xs" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
                        <Button size="sm" onClick={uploadEvidence} disabled={!uploadFile || uploading}>
                          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                        </Button>
                      </div>
                      <ul className="space-y-1 text-xs">
                        {documents.length === 0 ? <li className="text-ct-muted">No evidence uploaded yet.</li> : documents.map((d) => <li key={d.id}>{d.name}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
