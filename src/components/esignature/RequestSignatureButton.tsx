"use client";

// Wave 86 (Comparison CSV 2 gap analysis: CLM007 + DMS012). Shared between
// the Documents repository and the ERP Contracts detail page -- one
// component, since e-signature is polymorphic (esignature_requests.
// linkedEntityType) exactly like PartyAddressesAndContacts (Wave 84).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { PenLine, Plus, Trash2, Copy, Ban, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Signer = { id: string; name: string; email: string; status: string; accessToken: string };
type SignatureRequest = { id: string; title: string; status: string; createdAt: string; signers: Signer[] };

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-ct-cloud text-ct-muted", partially_signed: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700", declined: "bg-red-100 text-red-700", voided: "bg-red-100 text-red-700",
};

export function RequestSignatureButton({ linkedEntityType, linkedEntityId, defaultTitle }: { linkedEntityType: "document" | "erp_contract"; linkedEntityId: string; defaultTitle: string }) {
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<SignatureRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState(defaultTitle);
  const [signerRows, setSignerRows] = useState<{ name: string; email: string }[]>([{ name: "", email: "" }]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/esignature/requests?linkedEntityType=${linkedEntityType}&linkedEntityId=${linkedEntityId}`);
    const d = await res.json();
    setRequests(d.requests ?? []);
    setLoading(false);
  }, [linkedEntityType, linkedEntityId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const createRequest = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/esignature/requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedEntityType, linkedEntityId, title,
          signers: signerRows.filter((s) => s.name && s.email).map((s, i) => ({ name: s.name, email: s.email, order: i + 1 })),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create signature request");
      toast.success("Signature request created");
      setSignerRows([{ name: "", email: "" }]);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create signature request");
    } finally {
      setCreating(false);
    }
  };

  const voidRequest = async (id: string) => {
    const res = await fetch(`/api/esignature/requests/${id}/void`, { method: "POST" });
    if (!res.ok) { toast.error("Failed to void request"); return; }
    toast.success("Signature request voided");
    load();
  };

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/sign/${token}`);
    toast.success("Signing link copied to clipboard");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="sm" title="Request signature"><PenLine className="size-3.5 text-ct-muted" /></Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Electronic Signature</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-2">
            <Label>Signers (in order)</Label>
            {signerRows.map((s, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input className="flex-1" placeholder="Name" value={s.name} onChange={(e) => setSignerRows((prev) => prev.map((p, idx) => idx === i ? { ...p, name: e.target.value } : p))} />
                <Input className="flex-1" type="email" placeholder="Email" value={s.email} onChange={(e) => setSignerRows((prev) => prev.map((p, idx) => idx === i ? { ...p, email: e.target.value } : p))} />
                <Button size="sm" variant="ghost" onClick={() => setSignerRows((prev) => prev.filter((_, idx) => idx !== i))} disabled={signerRows.length <= 1}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setSignerRows((prev) => [...prev, { name: "", email: "" }])}><Plus className="w-3 h-3 mr-1" />Add signer</Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={createRequest} disabled={creating || !title || signerRows.every((s) => !s.name || !s.email)} className="bg-ct-teal hover:bg-ct-teal-hover text-white">
            {creating && <Loader2 className="size-4 mr-1.5 animate-spin" />}Send for Signature
          </Button>
        </DialogFooter>

        <div className="border-t border-ct-border pt-3 space-y-2">
          <p className="text-xs font-semibold text-ct-navy uppercase">Existing Requests</p>
          {loading ? <p className="text-xs text-ct-muted">Loading...</p> : requests.length === 0 ? <p className="text-xs text-ct-muted">No signature requests yet.</p> : requests.map((r) => (
            <div key={r.id} className="border border-ct-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ct-navy">{r.title}</p>
                <div className="flex items-center gap-1.5">
                  <Badge className={`text-xs border-0 ${STATUS_COLORS[r.status] ?? ""}`}>{r.status.replace("_", " ")}</Badge>
                  {r.status !== "completed" && r.status !== "voided" && (
                    <Button size="sm" variant="ghost" onClick={() => voidRequest(r.id)}><Ban className="size-3.5" /></Button>
                  )}
                </div>
              </div>
              {r.signers.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-xs text-ct-muted pl-2">
                  <span>{s.name} ({s.email})</span>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-xs">{s.status}</Badge>
                    {s.status === "pending" && <Button size="sm" variant="ghost" onClick={() => copyLink(s.accessToken)}><Copy className="size-3 text-ct-teal" /></Button>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
