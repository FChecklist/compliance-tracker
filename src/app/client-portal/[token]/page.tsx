"use client";

// Intentionally outside (app)/ and outside middleware's protected-route
// allowlist -- THE FIRM's client self-service portal, mirroring
// /vendor-portal/[token]'s exact pattern (tokenized, no auth session).
// Never move this under (app)/.
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Loader2, ShieldAlert, FileText, Receipt, CheckCircle2, Upload } from "lucide-react";

type Engagement = { id: string; title: string; serviceLine: string; status: string; startDate: string; endDate: string | null };
type Deliverable = { id: string; engagementId: string; title: string; dueDate: string | null; status: string; submittedAt: string | null };
type InvoiceLineItem = { description: string; amount: string };
type Invoice = { id: string; invoiceNumber: string; issueDate: string; dueDate: string | null; status: string; totalAmount: string; lineItems: InvoiceLineItem[] };
type PortalDoc = { id: string; name: string; category: string | null; createdAt: string };
type PortalData = { clientName: string; engagements: Engagement[]; deliverables: Deliverable[]; invoices: Invoice[]; documents: PortalDoc[] };

const STATUS_COLORS: Record<string, string> = { pending: "bg-amber-100 text-amber-700", in_progress: "bg-blue-100 text-blue-700", done: "bg-green-100 text-green-700", blocked: "bg-red-100 text-red-700" };
const INVOICE_COLORS: Record<string, string> = { draft: "bg-gray-100 text-gray-700", sent: "bg-blue-100 text-blue-700", paid: "bg-green-100 text-green-700", overdue: "bg-red-100 text-red-700", void: "bg-gray-100 text-gray-700" };

export default function ClientPortalPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/client-portal/${params.token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "This client portal link is invalid or has expired");
      } else {
        setData(await res.json());
        setError(null);
      }
    } catch {
      setError("Could not load this portal. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [params.token]);

  useEffect(() => { load(); }, [load]);

  const submitDeliverable = async (deliverableId: string) => {
    setSubmittingId(deliverableId);
    const res = await fetch(`/api/client-portal/${params.token}/deliverables/${deliverableId}/submit`, { method: "POST" });
    setSubmittingId(null);
    if (res.ok) { setMessage("Marked as submitted."); load(); } else { setMessage("Could not update — please try again."); }
  };

  const uploadDocument = async () => {
    if (!uploadingFile) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", uploadingFile);
    const res = await fetch(`/api/client-portal/${params.token}/documents`, { method: "POST", body: formData });
    setUploading(false);
    if (res.ok) { setMessage("Document uploaded."); setUploadingFile(null); load(); } else { setMessage("Upload failed — please try again."); }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-ct-cream"><Loader2 className="w-6 h-6 animate-spin text-ct-teal" /></div>;
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ct-cream p-6">
        <div className="max-w-sm text-center space-y-3">
          <ShieldAlert className="w-10 h-10 mx-auto text-red-500" />
          <p className="text-sm text-ct-navy font-medium">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ct-cream p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="font-heading text-2xl text-ct-navy">Welcome, {data.clientName}</h1>
          <p className="text-sm text-ct-muted mt-1">Your engagements, requests, invoices, and documents in one place</p>
          {message && <p className="text-xs text-ct-teal mt-1">{message}</p>}
        </div>

        <section className="rounded-xl border border-ct-border bg-white p-5">
          <h2 className="text-sm font-semibold text-ct-navy mb-3">Engagements</h2>
          {data.engagements.length === 0 ? <p className="text-xs text-ct-muted">No active engagements.</p> : (
            <div className="space-y-2">
              {data.engagements.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm border-b border-ct-border pb-2">
                  <div><span className="font-medium text-ct-navy">{e.title}</span><span className="text-ct-muted text-xs ml-2">{e.serviceLine.replace(/_/g, " ")}</span></div>
                  <span className="text-xs text-ct-muted">{e.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-ct-border bg-white p-5">
          <h2 className="text-sm font-semibold text-ct-navy mb-3">Requests from your firm</h2>
          {data.deliverables.length === 0 ? <p className="text-xs text-ct-muted">Nothing pending.</p> : (
            <div className="space-y-2">
              {data.deliverables.map((d) => (
                <div key={d.id} className="flex items-center justify-between text-sm border-b border-ct-border pb-2">
                  <div><span className="text-ct-navy">{d.title}</span>{d.dueDate && <span className="text-ct-muted text-xs ml-2">due {d.dueDate}</span>}</div>
                  {d.submittedAt || d.status === "done" ? (
                    <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="w-3.5 h-3.5" />Submitted</span>
                  ) : (
                    <button onClick={() => submitDeliverable(d.id)} disabled={submittingId === d.id} className="text-xs text-ct-teal underline disabled:opacity-50">
                      {submittingId === d.id ? "Submitting…" : "Mark as sent"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-ct-border bg-white p-5">
          <h2 className="text-sm font-semibold text-ct-navy mb-3 flex items-center gap-2"><Receipt className="w-4 h-4" />Invoices</h2>
          {data.invoices.length === 0 ? <p className="text-xs text-ct-muted">No invoices yet.</p> : (
            <div className="space-y-2">
              {data.invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between text-sm border-b border-ct-border pb-2">
                  <div><span className="font-medium text-ct-navy">{inv.invoiceNumber}</span><span className="text-ct-muted text-xs ml-2">{inv.issueDate}</span></div>
                  <div className="flex items-center gap-2">
                    <span className="text-ct-navy">₹{Number(inv.totalAmount).toLocaleString("en-IN")}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${INVOICE_COLORS[inv.status] ?? ""}`}>{inv.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-ct-border bg-white p-5">
          <h2 className="text-sm font-semibold text-ct-navy mb-3 flex items-center gap-2"><FileText className="w-4 h-4" />Documents</h2>
          <div className="flex items-center gap-2 mb-3">
            <input type="file" onChange={(e) => setUploadingFile(e.target.files?.[0] ?? null)} className="text-xs" />
            <button onClick={uploadDocument} disabled={!uploadingFile || uploading} className="flex items-center gap-1 text-xs bg-ct-teal text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
              <Upload className="w-3.5 h-3.5" />{uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
          {data.documents.length === 0 ? <p className="text-xs text-ct-muted">No documents on file.</p> : (
            <div className="space-y-1.5">
              {data.documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between text-xs text-ct-navy border-b border-ct-border pb-1.5">
                  <span>{doc.name}</span><span className="text-ct-muted">{new Date(doc.createdAt).toLocaleDateString("en-IN")}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
