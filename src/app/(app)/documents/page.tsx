"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 61 (Unified Document Management, ERP benchmark Tier 3 #15): a central
// repository view over the existing compliance.documents table -- upload,
// filter by category, track expiry, and manage versions -- rather than each
// module's own ad hoc attachment widget being the only way to see a
// document. Existing per-module upload flows (compliance items, notices)
// are untouched; this page is an additional, cross-cutting view over the
// same table.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  FolderOpen, Upload, Loader2, Download, History, FileText, AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { RequestSignatureButton } from "@/components/esignature/RequestSignatureButton";

type Document = {
  id: string;
  name: string;
  fileType: string | null;
  fileSize: number | null;
  category: string | null;
  expiryDate: string | null;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  versionNumber: number;
  isLatestVersion: boolean;
  createdAt: string;
};

const CATEGORIES = [
  { value: "contract", label: "Contract" },
  { value: "certificate", label: "Certificate" },
  { value: "license", label: "License" },
  { value: "policy", label: "Policy" },
  { value: "id_proof", label: "ID Proof" },
  { value: "other", label: "Other" },
];

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function expiryBadge(expiryDate: string | null) {
  if (!expiryDate) return null;
  const daysLeft = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return <Badge className="bg-ct-error/10 text-ct-error border-ct-error/20 text-xs">Expired</Badge>;
  if (daysLeft <= 30) return <Badge className="bg-ct-saffron/10 text-ct-saffron border-ct-saffron/20 text-xs">Expires in {daysLeft}d</Badge>;
  return <Badge variant="secondary" className="text-xs">Expires {new Date(expiryDate).toLocaleDateString()}</Badge>;
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [expiringCount, setExpiringCount] = useState(0);

  const [open, setOpen] = useState(false);
  const [versionOfId, setVersionOfId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [expiryDate, setExpiryDate] = useState("");
  const [uploading, setUploading] = useState(false);

  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<Document[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    const [listRes, expiringRes] = await Promise.all([
      fetch(`/api/documents?${params.toString()}`),
      fetch("/api/documents/expiring?withinDays=30"),
    ]);
    const listData = await listRes.json();
    const expiringData = await expiringRes.json();
    setDocs(listData.documents ?? []);
    setExpiringCount((expiringData.documents ?? []).length);
    setLoading(false);
  }, [categoryFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openUploadDialog = (replaceId: string | null = null, existing?: Document) => {
    setVersionOfId(replaceId);
    setFile(null);
    setName(existing?.name ?? "");
    setCategory(existing?.category ?? "other");
    setExpiryDate(existing?.expiryDate ? existing.expiryDate.slice(0, 10) : "");
    setOpen(true);
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (name.trim()) formData.append("name", name.trim());
      formData.append("category", category);
      if (expiryDate) formData.append("expiryDate", new Date(expiryDate).toISOString());
      if (versionOfId) formData.append("versionOfId", versionOfId);

      const res = await fetch("/api/documents", { method: "POST", body: formData });
      if (!res.ok) throw new Error();
      toast.success(versionOfId ? "New version uploaded" : "Document uploaded");
      setOpen(false);
      load();
    } catch {
      toast.error("Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  const download = async (doc: Document) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      window.open(data.signedUrl, "_blank");
    } catch {
      toast.error("Failed to open document");
    }
  };

  const showVersions = async (doc: Document) => {
    setVersionsOpen(true);
    setVersionsLoading(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}/versions`);
      const data = await res.json();
      setVersions(data.versions ?? []);
    } catch {
      toast.error("Failed to load version history");
    } finally {
      setVersionsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Documents</h1>
          <p className="text-sm text-ct-muted mt-1">Central repository across every module -- upload, version, and track expiry in one place.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => openUploadDialog(null)}>
              <Upload className="size-4 mr-2" />
              Upload Document
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{versionOfId ? "Upload New Version" : "Upload Document"}</DialogTitle>
              <DialogDescription>
                {versionOfId ? "This replaces the current version -- the previous file stays accessible in Version History." : "Stored in the private document bucket, never publicly accessible."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">File</Label>
                <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name (optional)</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to the file name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Expiry date (optional)</Label>
                  <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={upload} disabled={uploading || !file} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {uploading ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Upload
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {expiringCount > 0 && (
        <Card className="rounded-xl border-ct-saffron/30 bg-ct-saffron/5 shadow-none">
          <CardContent className="py-3 flex items-center gap-2 text-sm text-ct-navy">
            <AlertTriangle className="size-4 text-ct-saffron shrink-0" />
            {expiringCount} document{expiringCount === 1 ? "" : "s"} expiring within 30 days.
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <Label className="text-xs font-semibold text-ct-muted uppercase">Category</Label>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : docs.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center space-y-2">
            <FolderOpen className="size-10 text-ct-muted mx-auto" />
            <p className="text-sm text-ct-muted">No documents yet. Upload the first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {docs.map((doc) => (
            <div key={doc.id} className="px-4 py-3 flex items-center gap-3">
              <FileText className="size-4 text-ct-teal shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ct-navy truncate">{doc.name}</p>
                <p className="text-xs text-ct-muted">
                  {doc.versionNumber > 1 ? `v${doc.versionNumber} -- ` : ""}
                  {formatSize(doc.fileSize)}
                  {doc.category ? ` -- ${CATEGORIES.find((c) => c.value === doc.category)?.label ?? doc.category}` : ""}
                </p>
              </div>
              {expiryBadge(doc.expiryDate)}
              <Button variant="ghost" size="sm" onClick={() => showVersions(doc)} title="Version history">
                <History className="size-3.5 text-ct-muted" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openUploadDialog(doc.id, doc)} title="Upload new version">
                <Upload className="size-3.5 text-ct-muted" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => download(doc)} title="Download">
                <Download className="size-3.5 text-ct-navy" />
              </Button>
              <RequestSignatureButton linkedEntityType="document" linkedEntityId={doc.id} defaultTitle={doc.name} />
            </div>
          ))}
        </div>
      )}

      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Version History</DialogTitle>
            <DialogDescription>Newest first. Every prior version's file remains downloadable.</DialogDescription>
          </DialogHeader>
          {versionsLoading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : (
            <div className="divide-y divide-ct-border">
              {versions.map((v) => (
                <div key={v.id} className="py-2 flex items-center gap-3">
                  <span className="text-xs font-semibold text-ct-navy w-10">v{v.versionNumber}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ct-navy truncate">{v.name}</p>
                    <p className="text-xs text-ct-muted">{new Date(v.createdAt).toLocaleString()}</p>
                  </div>
                  {v.isLatestVersion && <Badge variant="secondary" className="text-xs">Latest</Badge>}
                  <Button variant="ghost" size="sm" onClick={() => download(v)}>
                    <Download className="size-3.5 text-ct-navy" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
