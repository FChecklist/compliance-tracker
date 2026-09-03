"use client";

export const dynamic = "force-dynamic";

// R63/Sumeet-modules gap-closure (2026-08-29): the backend for Permits has
// existed since Priority 13/Wave 143 (/api/v1/projexa/permits -- a thin
// alias over document-service.ts's generic documents table, category=
// 'permit') but NO (app) page or sidebar link ever called it -- confirmed
// via a real local browser walkthrough (direct nav to /permits 404'd, and
// the full sidebar link list had no /permits entry at all) while testing
// Sumeet's 10 required modules end-to-end. Built on the same list+dialog+
// ProjectPicker shell as the sibling /rfis page (same construction-module
// family, same backend posture -- Bearer/cookie dual auth via
// requireAuthOrApiKey).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, FileWarning, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

// R67 F-02 (R-018/R-021). The register stopped minting a Supabase Storage
// signed URL per row -- one network round trip per permit, on a list nobody may
// click. It reports whether the permit HAS a file; the URL is signed on click,
// by GET /api/v1/projexa/permits/{id}, which signs exactly one.
type Permit = {
  id: string; name: string; permitNumber: string | null; permitAuthority: string | null;
  issueDate: string | null; endDate: string | null; daysToExpiry: number | null; hasDocument: boolean;
};

function statusBadge(daysToExpiry: number | null) {
  if (daysToExpiry === null) return <Badge className="text-xs border-0 bg-ct-cloud text-ct-muted">No expiry</Badge>;
  if (daysToExpiry < 0) return <Badge className="text-xs border-0 bg-red-100 text-red-700">Expired</Badge>;
  if (daysToExpiry <= 30) return <Badge className="text-xs border-0 bg-ct-saffron/20 text-ct-saffron">Expiring in {daysToExpiry}d</Badge>;
  return <Badge className="text-xs border-0 bg-green-100 text-green-700">Valid</Badge>;
}

export default function PermitsPage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [permitAuthority, setPermitAuthority] = useState("");
  const [permitNumber, setPermitNumber] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: PickerProject[] = d.projects ?? [];
        setProjects(list);
        if (list.length > 0) setProjectId((prev) => prev || list[0].id);
      })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setLoadingProjects(false));
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ projectId, all: "true" });
      const res = await fetch(`/api/v1/projexa/permits?${params.toString()}`);
      const data = await res.json();
      setPermits(data.permits ?? []);
    } catch {
      toast.error("Failed to load permits");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // R67 F-02. One signed URL, minted because a human clicked -- not one per row
  // on every load. The blank tab is opened SYNCHRONOUSLY, before the await: a
  // browser only treats window.open() as user-initiated inside the click
  // handler's own turn, so opening it after the fetch resolves is what a popup
  // blocker kills.
  const openPermitDocument = async (permit: Permit) => {
    const tab = window.open("", "_blank", "noopener,noreferrer");
    setOpeningId(permit.id);
    try {
      const res = await fetch(`/api/v1/projexa/permits/${encodeURIComponent(permit.id)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't open this permit's document");
      // The row said there IS a file, so a null URL here means the signing
      // itself failed -- say that, rather than "no document".
      if (!data?.documentUrl) throw new Error("This permit's file could not be opened right now. Please retry.");
      if (tab) tab.location.href = data.documentUrl;
      else window.open(data.documentUrl, "_self");
    } catch (err) {
      tab?.close();
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't open this permit's document");
    } finally {
      setOpeningId(null);
    }
  };

  const createPermit = async () => {
    if (!projectId || !file || !name.trim()) return;
    setCreating(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("name", name);
      formData.set("projectId", projectId);
      if (permitAuthority) formData.set("permitAuthority", permitAuthority);
      if (permitNumber) formData.set("permitNumber", permitNumber);
      if (issueDate) formData.set("issueDate", issueDate);
      if (endDate) formData.set("endDate", endDate);

      const res = await fetch("/api/v1/projexa/permits", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Permit uploaded");
      setOpen(false);
      setFile(null); setName(""); setPermitAuthority(""); setPermitNumber(""); setIssueDate(""); setEndDate("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to upload permit");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Permits</h1>
          <p className="text-sm text-ct-muted mt-1">Statutory permits and approvals per project -- track expiry, keep the approved document on file.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> Upload Permit
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Upload Permit</DialogTitle><DialogDescription>Attached to the selected project.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Permit name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Building Permit -- Tower A" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Issuing authority</Label>
                  <Input value={permitAuthority} onChange={(e) => setPermitAuthority(e.target.value)} placeholder="Dubai Municipality" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Permit number</Label>
                  <Input value={permitNumber} onChange={(e) => setPermitNumber(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Issue date</Label>
                  <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Expiry date</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Permit document (PDF)</Label>
                <Input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createPermit} disabled={creating || !file || !name.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Save Permit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={FileWarning} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : permits.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No permits uploaded for this project yet.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead><TableHead>Authority</TableHead><TableHead>Number</TableHead>
                      <TableHead>Expiry</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Document</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {permits.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium text-ct-navy">{p.name}</TableCell>
                        <TableCell className="text-ct-muted">{p.permitAuthority ?? "--"}</TableCell>
                        <TableCell className="font-mono text-xs text-ct-muted">{p.permitNumber ?? "--"}</TableCell>
                        <TableCell className="text-ct-muted">{p.endDate ? new Date(p.endDate).toLocaleDateString() : "--"}</TableCell>
                        <TableCell>{statusBadge(p.daysToExpiry)}</TableCell>
                        <TableCell className="text-right">
                          {/* R67 F-02: the link renders from hasDocument,
                              and the storage URL is signed on click --
                              not once per row on load. */}
                          {p.hasDocument ? (
                            <button
                              type="button"
                              disabled={openingId === p.id}
                              onClick={() => openPermitDocument(p)}
                              className="inline-flex items-center gap-1 text-xs text-ct-saffron hover:underline disabled:opacity-60"
                            >
                              {openingId === p.id ? "Opening..." : "View"} <ExternalLink className="size-3" />
                            </button>
                          ) : "--"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
