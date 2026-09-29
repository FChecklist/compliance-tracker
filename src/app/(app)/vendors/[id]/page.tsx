"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge, batch 2 (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own VendorObjectClient.tsx (src/app/(app)/vendors/[id]/page.tsx
// there) -- the Vendor Master workflows (qualification review, sanction/
// blacklist screening, banking details, self-service portal links) that
// erp-vendor-master-service.ts has carried since Wave 80, now with a real UI
// consumer via the already-native /api/v1/projexa/vendors/[id]/** routes
// (qualification, sanction-checks, bank-accounts, portal-links[/linkId]) --
// zero new backend route, zero HTTP hop to a separate origin.
//
// UI is compliance-tracker's own shadcn Card/Table/Select/Checkbox/
// AlertDialog (matching the house convention every already-ported
// construction-* / PROJEXA-merge page uses), not PROJEXA's
// @fchecklist/veridian-ui-kit KitObjectScreen -- porting the DATA and
// BEHAVIOUR, not the exact component tree.
//
// Two deliberate adaptations from PROJEXA's own reference page:
//  1. This repo has no dynamic-segment page anywhere yet (confirmed via a
//     repo-wide search before writing this file), so there is no existing
//     "how do we read route params in a single-file 'use client' page"
//     convention to follow. useParams() from next/navigation (a plain,
//     synchronous client-side read, no Promise-prop unwrapping) is used
//     rather than splitting into an async server-component wrapper +
//     separate Client component -- keeps this one file, matching every
//     other already-ported page's own single-file convention.
//  2. PROJEXA's own "Deactivate" control calls DELETE /api/vendors/{id} --
//     but /api/v1/projexa/vendors/[id]/route.ts (this repo's already-native
//     equivalent) has no DELETE handler, only GET/PATCH (confirmed by
//     reading that file before writing this one). PATCH already accepts
//     `isActive`, and is exactly the soft-delete write updateSupplier()
//     performs either way -- so Deactivate/Reactivate both go through PATCH
//     { isActive } here. No backend change made; this is a UI-only port
//     that calls the real, existing write path instead of a route that does
//     not exist.
// isIndiaOrg gating (PROJEXA's own useOrgRole()) is likewise not ported --
// no useOrgRole hook, no org-country concept, exists anywhere in this repo
// yet; GST/PAN render unconditionally here (see ../page.tsx's own comment).
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Ban, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Vendor = {
  id: string; vendorName: string; vendorType: string | null; gst: string | null; pan: string | null;
  trade: string | null; defaultPaymentTermsDays: number | null;
  creditLimit: string | null; isActive: boolean;
  qualificationStatus: string; sanctionScreeningStatus: string;
};
type QualificationReview = { id: string; status: string; score: string | null; notes: string | null; createdAt: string };
type SanctionCheck = { id: string; listsChecked: string[]; matchFound: boolean; matchDetails: string | null; resultStatus: string; createdAt: string };
type BankAccount = { id: string; accountHolderName: string; bankName: string; accountNumberMasked: string; ifscCode: string | null; accountType: string; isPrimary: boolean };
type PortalLink = { id: string; token: string; expiresAt: string; revokedAt: string | null; createdAt: string };

const formatDate = (iso: string) => new Date(iso).toLocaleDateString();
const formatDateTime = (iso: string) => new Date(iso).toLocaleString();

/** A sub-resource fetch that must never fail the whole page load -- mirrors
 * PROJEXA's own VendorObjectClient.tsx, which wraps each of these four in
 * its own .catch(() => ({...empty})). Only the vendor fetch itself is fatal. */
async function fetchJsonOr<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export default function VendorDetailPage() {
  const params = useParams<{ id: string }>();
  const vendorId = params.id;
  const router = useRouter();

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [reviews, setReviews] = useState<QualificationReview[]>([]);
  const [checks, setChecks] = useState<SanctionCheck[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [links, setLinks] = useState<PortalLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ vendorName: "", vendorType: "", trade: "", gst: "", pan: "", defaultPaymentTermsDays: "", creditLimit: "" });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  const [qStatus, setQStatus] = useState<"in_review" | "qualified" | "rejected">("in_review");
  const [qScore, setQScore] = useState(""); const [qNotes, setQNotes] = useState("");
  const [sLists, setSLists] = useState(""); const [sMatch, setSMatch] = useState(false);
  const [sResult, setSResult] = useState<"clear" | "flagged" | "blocked">("clear"); const [sDetails, setSDetails] = useState("");
  const [bHolder, setBHolder] = useState(""); const [bBank, setBBank] = useState(""); const [bAccount, setBAccount] = useState("");
  const [bIfsc, setBIfsc] = useState(""); const [bType, setBType] = useState("savings"); const [bPrimary, setBPrimary] = useState(false);

  const load = useCallback(async () => {
    if (!vendorId) return;
    setLoading(true);
    try {
      const vRes = await fetch(`/api/v1/projexa/vendors/${vendorId}`);
      const vBody = await vRes.json().catch(() => null);
      if (!vRes.ok) throw new Error(vBody?.error ?? `Couldn't load this vendor (HTTP ${vRes.status})`);

      const [r, c, a, l] = await Promise.all([
        fetchJsonOr<{ reviews?: QualificationReview[] }>(`/api/v1/projexa/vendors/${vendorId}/qualification`, { reviews: [] }),
        fetchJsonOr<{ checks?: SanctionCheck[] }>(`/api/v1/projexa/vendors/${vendorId}/sanction-checks`, { checks: [] }),
        fetchJsonOr<{ bankAccounts?: BankAccount[] }>(`/api/v1/projexa/vendors/${vendorId}/bank-accounts`, { bankAccounts: [] }),
        fetchJsonOr<{ links?: PortalLink[] }>(`/api/v1/projexa/vendors/${vendorId}/portal-links`, { links: [] }),
      ]);
      setVendor(vBody);
      setReviews(r.reviews ?? []); setChecks(c.checks ?? []); setAccounts(a.bankAccounts ?? []); setLinks(l.links ?? []);
      setLoadError(null);
    } catch (err) {
      setVendor(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this vendor");
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => { void load(); }, [load]);

  async function patchVendor(body: Record<string, unknown>) {
    const res = await fetch(`/api/v1/projexa/vendors/${vendorId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? "Couldn't save vendor");
    return data;
  }

  function startEdit() {
    if (!vendor) return;
    setDraft({
      vendorName: vendor.vendorName, vendorType: vendor.vendorType ?? "", trade: vendor.trade ?? "",
      gst: vendor.gst ?? "", pan: vendor.pan ?? "",
      defaultPaymentTermsDays: vendor.defaultPaymentTermsDays != null ? String(vendor.defaultPaymentTermsDays) : "",
      creditLimit: vendor.creditLimit ?? "",
    });
    setMode("edit");
  }

  async function saveEdit() {
    if (!draft.vendorName.trim()) { toast.error("Vendor name is required"); return; }
    setSaving(true);
    try {
      await patchVendor({
        vendorName: draft.vendorName.trim(), vendorType: draft.vendorType || undefined, trade: draft.trade || undefined,
        gst: draft.gst || undefined, pan: draft.pan || undefined,
        defaultPaymentTermsDays: draft.defaultPaymentTermsDays ? Number(draft.defaultPaymentTermsDays) : undefined,
        creditLimit: draft.creditLimit ? Number(draft.creditLimit) : undefined,
      });
      toast.success("Vendor saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save vendor");
    } finally {
      setSaving(false);
    }
  }

  /** See this file's header comment (adaptation 2): PATCH { isActive }, not
   * DELETE -- this repo's native vendor route has no DELETE handler. */
  async function setActive(next: boolean) {
    setBusy("active");
    try {
      await patchVendor({ isActive: next });
      toast.success(next ? "Vendor reactivated" : "Vendor deactivated");
      setConfirmingDeactivate(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : next ? "Couldn't reactivate this vendor" : "Couldn't deactivate this vendor");
    } finally {
      setBusy(null);
    }
  }

  async function recordQualification() {
    setBusy("qualification");
    try {
      const res = await fetch(`/api/v1/projexa/vendors/${vendorId}/qualification`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: qStatus, score: qScore ? Number(qScore) : undefined, notes: qNotes || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't record qualification review");
      toast.success("Qualification review recorded");
      setQScore(""); setQNotes("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record qualification review");
    } finally {
      setBusy(null);
    }
  }

  async function recordSanctionCheck() {
    if (!sLists.trim()) { toast.error('List at least one list checked (e.g. "OFAC SDN")'); return; }
    setBusy("sanction");
    try {
      const res = await fetch(`/api/v1/projexa/vendors/${vendorId}/sanction-checks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listsChecked: sLists.split(",").map((s) => s.trim()).filter(Boolean),
          matchFound: sMatch, resultStatus: sResult, matchDetails: sDetails || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't record sanction check");
      toast.success("Sanction check recorded");
      setSLists(""); setSMatch(false); setSDetails("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record sanction check");
    } finally {
      setBusy(null);
    }
  }

  async function addBankAccount() {
    if (!bHolder.trim() || !bBank.trim() || bAccount.trim().length < 4) {
      toast.error("Account holder, bank name, and a valid account number are required");
      return;
    }
    setBusy("bank");
    try {
      const res = await fetch(`/api/v1/projexa/vendors/${vendorId}/bank-accounts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountHolderName: bHolder.trim(), bankName: bBank.trim(), accountNumber: bAccount.trim(), ifscCode: bIfsc || undefined, accountType: bType, isPrimary: bPrimary }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't add bank account");
      toast.success("Bank account added");
      setBHolder(""); setBBank(""); setBAccount(""); setBIfsc(""); setBPrimary(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add bank account");
    } finally {
      setBusy(null);
    }
  }

  async function createPortalLink() {
    setBusy("portal");
    try {
      const res = await fetch(`/api/v1/projexa/vendors/${vendorId}/portal-links`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't create portal link");
      toast.success("Portal link created");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create portal link");
    } finally {
      setBusy(null);
    }
  }

  async function revokePortalLink(linkId: string) {
    setBusy(`revoke-${linkId}`);
    try {
      const res = await fetch(`/api/v1/projexa/vendors/${vendorId}/portal-links/${linkId}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't revoke portal link");
      toast.success("Portal link revoked");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't revoke portal link");
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <button onClick={() => router.push("/vendors")} className="inline-flex items-center gap-1 text-xs text-ct-muted hover:underline">
          <ArrowLeft className="size-3.5" /> Vendors
        </button>
        <p role="alert" className="text-sm text-ct-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }
  if (loading || !vendor) {
    return <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  // Counted off records this page has already loaded -- no extra read to
  // state what a deactivation does NOT destroy.
  const keptFacets = [
    accounts.length > 0 ? `${accounts.length} bank ${accounts.length === 1 ? "account" : "accounts"}` : null,
    reviews.length > 0 ? `${reviews.length} qualification ${reviews.length === 1 ? "review" : "reviews"}` : null,
    checks.length > 0 ? `${checks.length} sanction ${checks.length === 1 ? "check" : "checks"}` : null,
    links.length > 0 ? `${links.length} portal ${links.length === 1 ? "link" : "links"}` : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <button onClick={() => router.push("/vendors")} className="inline-flex items-center gap-1 text-xs text-ct-muted hover:underline mb-1">
            <ArrowLeft className="size-3.5" /> Vendors
          </button>
          <h1 className="text-2xl font-heading text-ct-navy flex items-center gap-2">
            {mode === "edit" ? "Edit Vendor" : vendor.vendorName}
            <Badge variant={vendor.isActive ? "default" : "outline"}>{vendor.isActive ? "active" : "inactive"}</Badge>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {mode === "display" && vendor.isActive && (
            <Button variant="outline" onClick={startEdit}>Edit</Button>
          )}
          {mode === "display" && !vendor.isActive && (
            <Button variant="outline" disabled={busy === "active"} onClick={() => void setActive(true)}>
              {busy === "active" ? "Working..." : "Reactivate"}
            </Button>
          )}
          {mode === "display" && vendor.isActive && (
            <Button variant="outline" className="text-ct-error" disabled={busy === "active"} onClick={() => setConfirmingDeactivate(true)}>
              Deactivate
            </Button>
          )}
          {mode === "edit" && (
            <>
              <Button variant="outline" onClick={() => setMode("display")}>Cancel</Button>
              <Button
                onClick={() => void saveEdit()}
                disabled={saving || !draft.vendorName.trim()}
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
              >
                {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Save
              </Button>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={confirmingDeactivate} onOpenChange={setConfirmingDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {vendor.vendorName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing filed against it is removed{keptFacets.length > 0 ? ` -- its ${keptFacets.join(", ")} are kept` : ""}, purchase orders and BOQ lines still name it, and you can reactivate it from this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "active"}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy === "active"} onClick={() => void setActive(false)}>
              {busy === "active" ? "Working..." : "Deactivate vendor"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {mode === "edit" ? (
        <Card className="rounded-xl shadow-card bg-white max-w-2xl">
          <CardHeader><CardTitle className="text-base text-ct-navy">Vendor details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Vendor Name</Label>
              <Input value={draft.vendorName} onChange={(e) => setDraft((d) => ({ ...d, vendorName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Type</Label>
                <Input value={draft.vendorType} onChange={(e) => setDraft((d) => ({ ...d, vendorType: e.target.value }))} placeholder="e.g. Subcontractor" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Trade</Label>
                <Input value={draft.trade} onChange={(e) => setDraft((d) => ({ ...d, trade: e.target.value }))} placeholder="e.g. Electrical" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">GST</Label>
                <Input value={draft.gst} onChange={(e) => setDraft((d) => ({ ...d, gst: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">PAN</Label>
                <Input value={draft.pan} onChange={(e) => setDraft((d) => ({ ...d, pan: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Payment Terms (days)</Label>
                <Input type="number" value={draft.defaultPaymentTermsDays} onChange={(e) => setDraft((d) => ({ ...d, defaultPaymentTermsDays: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Credit Limit</Label>
                <Input type="number" value={draft.creditLimit} onChange={(e) => setDraft((d) => ({ ...d, creditLimit: e.target.value }))} />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="pt-6 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div><p className="text-xs text-ct-muted uppercase">Type</p><p className="text-ct-navy">{vendor.vendorType ?? "--"}</p></div>
              <div><p className="text-xs text-ct-muted uppercase">Trade</p><p className="text-ct-navy">{vendor.trade ?? "--"}</p></div>
              <div><p className="text-xs text-ct-muted uppercase">Payment Terms</p><p className="text-ct-navy">{vendor.defaultPaymentTermsDays != null ? `${vendor.defaultPaymentTermsDays} days` : "--"}</p></div>
              <div><p className="text-xs text-ct-muted uppercase">Credit Limit</p><p className="text-ct-navy">{vendor.creditLimit ?? "--"}</p></div>
              <div><p className="text-xs text-ct-muted uppercase">Qualification</p><p className="text-ct-navy">{vendor.qualificationStatus.replace(/_/g, " ")}</p></div>
              <div><p className="text-xs text-ct-muted uppercase">Sanction Screening</p><p className="text-ct-navy">{vendor.sanctionScreeningStatus.replace(/_/g, " ")}</p></div>
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Qualification</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {reviews.length === 0 ? <p className="text-sm text-ct-muted">No reviews recorded yet.</p> : (
                <ul className="space-y-1 text-sm">
                  {reviews.map((r) => (
                    <li key={r.id} className="flex items-center justify-between rounded-md border px-2 py-1.5">
                      <span className="flex items-center gap-2">
                        <Badge variant={r.status === "qualified" ? "default" : "outline"}>{r.status.replace(/_/g, " ")}</Badge>
                        {r.notes && <span className="text-ct-muted-text">{r.notes}</span>}
                      </span>
                      <span className="text-xs text-ct-muted">{r.score ? `Score ${r.score} · ` : ""}{formatDate(r.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Status</Label>
                  <Select value={qStatus} onValueChange={(v) => setQStatus(v as typeof qStatus)}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_review">In Review</SelectItem>
                      <SelectItem value="qualified">Qualified</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Score (optional)</Label><Input type="number" className="w-24" value={qScore} onChange={(e) => setQScore(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Notes (optional)</Label><Input className="w-56" value={qNotes} onChange={(e) => setQNotes(e.target.value)} /></div>
                <Button size="sm" disabled={busy === "qualification"} onClick={() => void recordQualification()}>{busy === "qualification" ? "Saving..." : "Record Review"}</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Sanction Screening</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-ct-muted">No live sanctions-list API is connected here -- this logs the outcome of a check a human performed against an external list.</p>
              {checks.length === 0 ? <p className="text-sm text-ct-muted">No checks recorded yet.</p> : (
                <ul className="space-y-1 text-sm">
                  {checks.map((c) => (
                    <li key={c.id} className="flex items-center justify-between rounded-md border px-2 py-1.5">
                      <span className="flex items-center gap-2">
                        <Badge variant={c.resultStatus === "clear" ? "default" : "outline"}>{c.resultStatus}</Badge>
                        <span className="text-ct-muted-text">{c.listsChecked.join(", ")}</span>
                      </span>
                      <span className="text-xs text-ct-muted">{formatDate(c.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Lists Checked (comma-separated)</Label><Input className="w-56" value={sLists} onChange={(e) => setSLists(e.target.value)} placeholder="OFAC SDN, UN Consolidated List" /></div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Result</Label>
                  <Select value={sResult} onValueChange={(v) => setSResult(v as typeof sResult)}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clear">Clear</SelectItem>
                      <SelectItem value="flagged">Flagged</SelectItem>
                      <SelectItem value="blocked">Blocked</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1.5 pb-1.5"><Checkbox checked={sMatch} onCheckedChange={(v) => setSMatch(!!v)} /><Label className="font-normal">Match found</Label></div>
                {sMatch && <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Match Details</Label><Input className="w-56" value={sDetails} onChange={(e) => setSDetails(e.target.value)} /></div>}
                <Button size="sm" disabled={busy === "sanction"} onClick={() => void recordSanctionCheck()}>{busy === "sanction" ? "Saving..." : "Record Check"}</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Bank Accounts</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {accounts.length === 0 ? <p className="text-sm text-ct-muted">No bank accounts on file.</p> : (
                <ul className="space-y-1 text-sm">
                  {accounts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between rounded-md border px-2 py-1.5">
                      <span>{a.accountHolderName} &middot; {a.bankName} &middot; {a.accountNumberMasked}</span>
                      {a.isPrimary && <Badge>primary</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Account Holder</Label><Input className="w-40" value={bHolder} onChange={(e) => setBHolder(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Bank Name</Label><Input className="w-40" value={bBank} onChange={(e) => setBBank(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Account Number</Label><Input className="w-40" value={bAccount} onChange={(e) => setBAccount(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">IFSC (optional)</Label><Input className="w-32" value={bIfsc} onChange={(e) => setBIfsc(e.target.value)} /></div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Type</Label>
                  <Select value={bType} onValueChange={setBType}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="savings">Savings</SelectItem>
                      <SelectItem value="current">Current</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1.5 pb-1.5"><Checkbox checked={bPrimary} onCheckedChange={(v) => setBPrimary(!!v)} /><Label className="font-normal">Primary</Label></div>
                <Button size="sm" disabled={busy === "bank"} onClick={() => void addBankAccount()}>{busy === "bank" ? "Saving..." : "Add Account"}</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Self-Service Portal Links</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {links.length === 0 ? <p className="text-sm text-ct-muted">No portal links created yet.</p> : (
                <ul className="space-y-1 text-sm">
                  {links.map((l) => {
                    const revoked = !!l.revokedAt;
                    const expired = !revoked && new Date(l.expiresAt) < new Date();
                    return (
                      <li key={l.id} className="flex items-center justify-between rounded-md border px-2 py-1.5">
                        <span className="font-mono text-xs">{l.token.slice(0, 12)}&hellip;</span>
                        <span className="flex items-center gap-2">
                          <Badge variant={revoked || expired ? "outline" : "default"}>{revoked ? "revoked" : expired ? "expired" : "active"}</Badge>
                          <span className="text-xs text-ct-muted">expires {formatDateTime(l.expiresAt)}</span>
                          {!revoked && !expired && (
                            <Button size="sm" variant="ghost" disabled={busy === `revoke-${l.id}`} onClick={() => void revokePortalLink(l.id)}>
                              <Ban className="size-3.5" /> Revoke
                            </Button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Button size="sm" variant="outline" disabled={busy === "portal"} onClick={() => void createPortalLink()}>{busy === "portal" ? "Creating..." : "Create Portal Link"}</Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
