"use client";

export const dynamic = "force-dynamic";

// Wave 80 (Vendor Master enhancements, COMPARISON_CSV_GAP_ANALYSIS.md
// backlog #1): banking details, qualification workflow, sanction/blacklist
// screening, KYC documents (reusing the existing central document
// repository, Wave 61), and a self-service vendor portal link.
import { useEffect, useState, useCallback, use as usePromise } from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  ArrowLeft, Loader2, Plus, Landmark, ShieldCheck, ShieldAlert, FileText,
  Upload, Link2, Copy, Ban,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Supplier = { id: string; supplierName: string; qualificationStatus: string; sanctionScreeningStatus: string; sanctionScreenedAt: string | null };
type BankAccount = { id: string; accountHolderName: string; bankName: string; accountNumberMasked: string; ifscCode: string | null; accountType: string; isPrimary: boolean };
type Qualification = { id: string; status: string; score: string | null; notes: string | null; createdAt: string };
type SanctionCheck = { id: string; listsChecked: string[]; matchFound: boolean; matchDetails: string | null; resultStatus: string; createdAt: string };
type PortalLink = { id: string; token: string; expiresAt: string; revokedAt: string | null; createdAt: string };
type Doc = { id: string; name: string; category: string | null; expiryDate: string | null; createdAt: string };

const QUALIFICATION_COLORS: Record<string, string> = {
  not_started: "bg-ct-cloud text-ct-muted", in_review: "bg-ct-saffron/20 text-ct-saffron",
  qualified: "bg-green-100 text-green-700", rejected: "bg-red-100 text-red-700",
};
const SANCTION_COLORS: Record<string, string> = {
  not_checked: "bg-ct-cloud text-ct-muted", clear: "bg-green-100 text-green-700",
  flagged: "bg-red-100 text-red-700",
};

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [qualifications, setQualifications] = useState<Qualification[]>([]);
  const [sanctionChecks, setSanctionChecks] = useState<SanctionCheck[]>([]);
  const [portalLinks, setPortalLinks] = useState<PortalLink[]>([]);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);

  const [bankOpen, setBankOpen] = useState(false);
  const [bankHolder, setBankHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankNumber, setBankNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [savingBank, setSavingBank] = useState(false);

  const [qualOpen, setQualOpen] = useState(false);
  const [qualStatus, setQualStatus] = useState<"in_review" | "qualified" | "rejected">("in_review");
  const [qualScore, setQualScore] = useState("");
  const [qualNotes, setQualNotes] = useState("");
  const [savingQual, setSavingQual] = useState(false);

  const [sanctionOpen, setSanctionOpen] = useState(false);
  const [sanctionLists, setSanctionLists] = useState("UN Consolidated List, OFAC SDN, RBI Caution List");
  const [sanctionMatch, setSanctionMatch] = useState(false);
  const [sanctionDetails, setSanctionDetails] = useState("");
  const [sanctionResult, setSanctionResult] = useState<"clear" | "flagged" | "blocked">("clear");
  const [savingSanction, setSavingSanction] = useState(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState("kyc_other");
  const [uploadExpiry, setUploadExpiry] = useState("");
  const [uploading, setUploading] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);

  const load = useCallback(async () => {
    const [supRes, bankRes, qualRes, sanctionRes, linkRes, docRes] = await Promise.all([
      fetch("/api/erp/buying/suppliers"),
      fetch(`/api/erp/buying/suppliers/${id}/bank-accounts`),
      fetch(`/api/erp/buying/suppliers/${id}/qualifications`),
      fetch(`/api/erp/buying/suppliers/${id}/sanction-checks`),
      fetch(`/api/erp/buying/suppliers/${id}/portal-links`),
      fetch(`/api/documents?linkedEntityType=erp_supplier&linkedEntityId=${id}`),
    ]);
    const [supData, bankData, qualData, sanctionData, linkData, docData] = await Promise.all([
      supRes.json(), bankRes.json(), qualRes.json(), sanctionRes.json(), linkRes.json(), docRes.json(),
    ]);
    setSupplier((supData.suppliers ?? []).find((s: Supplier) => s.id === id) ?? null);
    setBankAccounts(bankData.bankAccounts ?? []);
    setQualifications(qualData.qualifications ?? []);
    setSanctionChecks(sanctionData.sanctionChecks ?? []);
    setPortalLinks(linkData.portalLinks ?? []);
    setDocuments(docData.documents ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const addBankAccount = async () => {
    setSavingBank(true);
    try {
      const res = await fetch(`/api/erp/buying/suppliers/${id}/bank-accounts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountHolderName: bankHolder, bankName, accountNumber: bankNumber, ifscCode: bankIfsc || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Bank account added");
      setBankOpen(false); setBankHolder(""); setBankName(""); setBankNumber(""); setBankIfsc("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add bank account");
    } finally {
      setSavingBank(false);
    }
  };

  const recordQualification = async () => {
    setSavingQual(true);
    try {
      const res = await fetch(`/api/erp/buying/suppliers/${id}/qualifications`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: qualStatus, score: qualScore ? Number(qualScore) : undefined, notes: qualNotes || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Qualification review recorded");
      setQualOpen(false); setQualScore(""); setQualNotes("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record review");
    } finally {
      setSavingQual(false);
    }
  };

  const recordSanction = async () => {
    setSavingSanction(true);
    try {
      const res = await fetch(`/api/erp/buying/suppliers/${id}/sanction-checks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listsChecked: sanctionLists.split(",").map((s) => s.trim()).filter(Boolean),
          matchFound: sanctionMatch, matchDetails: sanctionDetails || undefined, resultStatus: sanctionResult,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Sanction check recorded");
      setSanctionOpen(false); setSanctionDetails("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record sanction check");
    } finally {
      setSavingSanction(false);
    }
  };

  const uploadKycDocument = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("category", uploadCategory);
      formData.append("linkedEntityType", "erp_supplier");
      formData.append("linkedEntityId", id);
      if (uploadExpiry) formData.append("expiryDate", uploadExpiry);
      const res = await fetch("/api/documents", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("KYC document uploaded");
      setUploadFile(null); setUploadExpiry("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  const createPortalLink = async () => {
    setCreatingLink(true);
    try {
      const res = await fetch(`/api/erp/buying/suppliers/${id}/portal-links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Vendor portal link created");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create portal link");
    } finally {
      setCreatingLink(false);
    }
  };

  const revokeLink = async (linkId: string) => {
    const res = await fetch(`/api/erp/buying/suppliers/portal-links/${linkId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to revoke link"); return; }
    toast.success("Portal link revoked");
    load();
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/vendor-portal/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Portal link copied to clipboard");
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!supplier) return <p className="text-sm text-ct-muted">Supplier not found.</p>;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/erp/suppliers" className="text-xs text-ct-muted hover:text-ct-navy flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3" /> Back to Suppliers
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-heading text-ct-navy">{supplier.supplierName}</h1>
          <Badge className={`text-xs border-0 ${QUALIFICATION_COLORS[supplier.qualificationStatus] ?? ""}`}>
            {supplier.qualificationStatus.replace("_", " ")}
          </Badge>
          <Badge className={`text-xs border-0 ${SANCTION_COLORS[supplier.sanctionScreeningStatus] ?? ""}`}>
            sanction: {supplier.sanctionScreeningStatus.replace("_", " ")}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Banking */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base text-ct-navy flex items-center gap-2"><Landmark className="size-4 text-ct-teal" /> Banking Details</CardTitle>
            <Dialog open={bankOpen} onOpenChange={setBankOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="size-3.5 mr-1" /> Add</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Bank Account</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                  <div><Label>Account Holder Name</Label><Input value={bankHolder} onChange={(e) => setBankHolder(e.target.value)} /></div>
                  <div><Label>Bank Name</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></div>
                  <div><Label>Account Number</Label><Input value={bankNumber} onChange={(e) => setBankNumber(e.target.value)} placeholder="Stored encrypted at rest" /></div>
                  <div><Label>IFSC Code (optional)</Label><Input value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value)} /></div>
                </div>
                <DialogFooter>
                  <Button onClick={addBankAccount} disabled={savingBank || !bankHolder || !bankName || bankNumber.length < 4} className="bg-ct-teal hover:bg-ct-teal-hover text-white">
                    {savingBank && <Loader2 className="size-4 mr-1.5 animate-spin" />} Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="space-y-2">
            {bankAccounts.length === 0 ? <p className="text-xs text-ct-muted">No bank accounts on file.</p> : bankAccounts.map((b) => (
              <div key={b.id} className="text-sm border border-ct-border rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="font-medium text-ct-navy">{b.bankName} {b.accountNumberMasked}</p>
                  <p className="text-xs text-ct-muted">{b.accountHolderName}{b.ifscCode ? ` · ${b.ifscCode}` : ""}</p>
                </div>
                {b.isPrimary && <Badge variant="outline" className="text-xs">Primary</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* KYC Documents */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2"><CardTitle className="text-base text-ct-navy flex items-center gap-2"><FileText className="size-4 text-ct-teal" /> KYC Documents</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Input type="file" className="flex-1 min-w-[160px] text-xs" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kyc_pan">PAN</SelectItem>
                  <SelectItem value="kyc_gst">GST Certificate</SelectItem>
                  <SelectItem value="kyc_address_proof">Address Proof</SelectItem>
                  <SelectItem value="kyc_bank_proof">Bank Proof</SelectItem>
                  <SelectItem value="kyc_other">Other</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" className="w-36 h-9 text-xs" value={uploadExpiry} onChange={(e) => setUploadExpiry(e.target.value)} placeholder="Expiry" />
              <Button size="sm" onClick={uploadKycDocument} disabled={!uploadFile || uploading} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              </Button>
            </div>
            {documents.length === 0 ? <p className="text-xs text-ct-muted">No KYC documents uploaded yet.</p> : documents.map((d) => (
              <div key={d.id} className="text-sm border border-ct-border rounded-lg px-3 py-2 flex items-center justify-between">
                <div><p className="font-medium text-ct-navy">{d.name}</p><p className="text-xs text-ct-muted">{d.category ?? "uncategorized"}{d.expiryDate ? ` · expires ${new Date(d.expiryDate).toLocaleDateString()}` : ""}</p></div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Qualification workflow */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base text-ct-navy flex items-center gap-2"><ShieldCheck className="size-4 text-ct-teal" /> Qualification</CardTitle>
            <Dialog open={qualOpen} onOpenChange={setQualOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="size-3.5 mr-1" /> Record Review</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Qualification Review</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                  <div><Label>Status</Label>
                    <Select value={qualStatus} onValueChange={(v) => setQualStatus(v as typeof qualStatus)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="in_review">In Review</SelectItem><SelectItem value="qualified">Qualified</SelectItem><SelectItem value="rejected">Rejected</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div><Label>Score (optional)</Label><Input type="number" value={qualScore} onChange={(e) => setQualScore(e.target.value)} /></div>
                  <div><Label>Notes</Label><Input value={qualNotes} onChange={(e) => setQualNotes(e.target.value)} /></div>
                </div>
                <DialogFooter><Button onClick={recordQualification} disabled={savingQual} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{savingQual && <Loader2 className="size-4 mr-1.5 animate-spin" />}Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="space-y-2">
            {qualifications.length === 0 ? <p className="text-xs text-ct-muted">No qualification reviews yet.</p> : qualifications.map((q) => (
              <div key={q.id} className="text-sm border border-ct-border rounded-lg px-3 py-2">
                <div className="flex items-center justify-between">
                  <Badge className={`text-xs border-0 ${QUALIFICATION_COLORS[q.status] ?? ""}`}>{q.status.replace("_", " ")}</Badge>
                  <span className="text-xs text-ct-muted">{new Date(q.createdAt).toLocaleDateString()}</span>
                </div>
                {q.notes && <p className="text-xs text-ct-muted mt-1">{q.notes}</p>}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Sanction screening */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base text-ct-navy flex items-center gap-2"><ShieldAlert className="size-4 text-ct-teal" /> Sanction Screening</CardTitle>
            <Dialog open={sanctionOpen} onOpenChange={setSanctionOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="size-3.5 mr-1" /> Record Check</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Sanction/Blacklist Check</DialogTitle></DialogHeader>
                <p className="text-xs text-ct-muted -mt-2">This environment has no live sanctions-API integration -- record the outcome of a check performed externally (UN/OFAC/RBI caution list/etc).</p>
                <div className="space-y-3 py-2">
                  <div><Label>Lists Checked (comma-separated)</Label><Input value={sanctionLists} onChange={(e) => setSanctionLists(e.target.value)} /></div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={sanctionMatch} onChange={(e) => setSanctionMatch(e.target.checked)} />
                    <Label className="!mb-0">Match found</Label>
                  </div>
                  {sanctionMatch && <div><Label>Match Details</Label><Input value={sanctionDetails} onChange={(e) => setSanctionDetails(e.target.value)} /></div>}
                  <div><Label>Result</Label>
                    <Select value={sanctionResult} onValueChange={(v) => setSanctionResult(v as typeof sanctionResult)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="clear">Clear</SelectItem><SelectItem value="flagged">Flagged</SelectItem><SelectItem value="blocked">Blocked</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter><Button onClick={recordSanction} disabled={savingSanction} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{savingSanction && <Loader2 className="size-4 mr-1.5 animate-spin" />}Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="space-y-2">
            {sanctionChecks.length === 0 ? <p className="text-xs text-ct-muted">No sanction checks recorded yet.</p> : sanctionChecks.map((s) => (
              <div key={s.id} className="text-sm border border-ct-border rounded-lg px-3 py-2">
                <div className="flex items-center justify-between">
                  <Badge className={`text-xs border-0 ${s.resultStatus === "clear" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{s.resultStatus}</Badge>
                  <span className="text-xs text-ct-muted">{new Date(s.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-xs text-ct-muted mt-1">Checked: {s.listsChecked.join(", ")}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Vendor self-service portal */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base text-ct-navy flex items-center gap-2"><Link2 className="size-4 text-ct-teal" /> Vendor Self-Service Portal</CardTitle>
          <Button size="sm" variant="outline" onClick={createPortalLink} disabled={creatingLink}>
            {creatingLink ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Plus className="size-3.5 mr-1" />} Create Link
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {portalLinks.length === 0 ? <p className="text-xs text-ct-muted">No portal links created yet -- the vendor can view their KYC/banking/qualification status and submit new bank details via a tokenized link.</p> : portalLinks.map((l) => {
            const expired = new Date(l.expiresAt) < new Date();
            return (
              <div key={l.id} className="text-sm border border-ct-border rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="text-xs text-ct-muted">Expires {new Date(l.expiresAt).toLocaleDateString()}{l.revokedAt ? " · revoked" : expired ? " · expired" : ""}</p>
                </div>
                <div className="flex items-center gap-1">
                  {!l.revokedAt && !expired && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => copyLink(l.token)}><Copy className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => revokeLink(l.id)}><Ban className="size-3.5" /></Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
