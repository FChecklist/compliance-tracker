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
  FolderOpen, Upload, Loader2, Download, History, FileText, AlertTriangle, Search, ShieldOff, Trash2, Lock, Clock,
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
  retentionPeriodDays: number | null;
  disposalDate: string | null;
  legalHold: boolean;
  isDisposed: boolean;
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

function DocumentRow({ doc, onDownload, onVersions, onUpload, onRetention, onLegalHold, onDispose }: {
  doc: Document;
  onDownload: (doc: Document) => void;
  onVersions: (doc: Document) => void;
  onUpload: (id: string, doc: Document) => void;
  onRetention: (doc: Document) => void;
  onLegalHold: (doc: Document) => void;
  onDispose: (doc: Document) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const eligibleForDisposal = !doc.isDisposed && !doc.legalHold && doc.disposalDate !== null && doc.disposalDate <= today;

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <FileText className="size-4 text-ct-teal shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ct-navy truncate">{doc.name}</p>
        <p className="text-xs text-ct-muted">
          {doc.versionNumber > 1 ? `v${doc.versionNumber} -- ` : ""}
          {formatSize(doc.fileSize)}
          {doc.category ? ` -- ${CATEGORIES.find((c) => c.value === doc.category)?.label ?? doc.category}` : ""}
          {doc.isDisposed ? " -- disposed" : doc.disposalDate ? ` -- disposal ${doc.disposalDate}` : ""}
        </p>
      </div>
      {doc.legalHold && <Badge className="bg-ct-navy/10 text-ct-navy border-ct-navy/20 text-xs">Legal Hold</Badge>}
      {expiryBadge(doc.expiryDate)}
      <Button variant="ghost" size="sm" onClick={() => onRetention(doc)} title="Set retention policy">
        <Clock className="size-3.5 text-ct-muted" />
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onLegalHold(doc)} title={doc.legalHold ? "Release legal hold" : "Apply legal hold"}>
        <Lock className={`size-3.5 ${doc.legalHold ? "text-ct-navy" : "text-ct-muted"}`} />
      </Button>
      {eligibleForDisposal && (
        <Button variant="ghost" size="sm" onClick={() => onDispose(doc)} title="Dispose document">
          <ShieldOff className="size-3.5 text-ct-error" />
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => onVersions(doc)} title="Version history">
        <History className="size-3.5 text-ct-muted" />
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onUpload(doc.id, doc)} title="Upload new version">
        <Upload className="size-3.5 text-ct-muted" />
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onDownload(doc)} title="Download">
        <Download className="size-3.5 text-ct-navy" />
      </Button>
      <RequestSignatureButton linkedEntityType="document" linkedEntityId={doc.id} defaultTitle={doc.name} />
    </div>
  );
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [expiringCount, setExpiringCount] = useState(0);
  const [pendingDisposalCount, setPendingDisposalCount] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Document[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [retentionOpen, setRetentionOpen] = useState(false);
  const [retentionDoc, setRetentionDoc] = useState<Document | null>(null);
  const [retentionDays, setRetentionDays] = useState("");
  const [savingRetention, setSavingRetention] = useState(false);

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
    const [listRes, expiringRes, pendingDisposalRes] = await Promise.all([
      fetch(`/api/documents?${params.toString()}`),
      fetch("/api/documents/expiring?withinDays=30"),
      fetch("/api/documents/pending-disposal"),
    ]);
    const listData = await listRes.json();
    const expiringData = await expiringRes.json();
    const pendingDisposalData = await pendingDisposalRes.json();
    setDocs(listData.documents ?? []);
    setExpiringCount((expiringData.documents ?? []).length);
    setPendingDisposalCount((pendingDisposalData.documents ?? []).length);
    setLoading(false);
  }, [categoryFilter]);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      const res = await fetch(`/api/documents/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data.documents ?? []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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

  const openRetentionDialog = (doc: Document) => {
    setRetentionDoc(doc);
    setRetentionDays(doc.retentionPeriodDays ? String(doc.retentionPeriodDays) : "");
    setRetentionOpen(true);
  };

  const saveRetention = async () => {
    if (!retentionDoc || !retentionDays) return;
    setSavingRetention(true);
    const res = await fetch(`/api/documents/${retentionDoc.id}/retention`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retentionPeriodDays: Number(retentionDays) }),
    });
    setSavingRetention(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to set retention policy"); return; }
    toast.success("Retention policy set");
    setRetentionOpen(false);
    load();
  };

  const toggleLegalHold = async (doc: Document) => {
    const res = await fetch(`/api/documents/${doc.id}/retention`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ legalHold: !doc.legalHold }),
    });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to update legal hold"); return; }
    toast.success(doc.legalHold ? "Legal hold released" : "Legal hold applied");
    load();
  };

  const disposeDoc = async (doc: Document) => {
    const res = await fetch(`/api/documents/${doc.id}/dispose`, { method: "POST" });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to dispose document"); return; }
    toast.success("Document disposed");
    load();
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

      {pendingDisposalCount > 0 && (
        <Card className="rounded-xl border-ct-error/30 bg-ct-error/5 shadow-none">
          <CardContent className="py-3 flex items-center gap-2 text-sm text-ct-navy">
            <Trash2 className="size-4 text-ct-error shrink-0" />
            {pendingDisposalCount} document{pendingDisposalCount === 1 ? "" : "s"} past its retention period and eligible for disposal.
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="size-3.5 text-ct-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input className="pl-8" placeholder="Search document content..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
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
      ) : searchResults !== null ? (
        searching ? (
          <p className="text-sm text-ct-muted">Searching...</p>
        ) : searchResults.length === 0 ? (
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="pt-10 pb-10 text-center space-y-2">
              <Search className="size-10 text-ct-muted mx-auto" />
              <p className="text-sm text-ct-muted">No documents match &ldquo;{searchQuery}&rdquo;.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
            {searchResults.map((doc) => (
              <DocumentRow key={doc.id} doc={doc} onDownload={download} onVersions={showVersions} onUpload={openUploadDialog} onRetention={openRetentionDialog} onLegalHold={toggleLegalHold} onDispose={disposeDoc} />
            ))}
          </div>
        )
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
            <DocumentRow key={doc.id} doc={doc} onDownload={download} onVersions={showVersions} onUpload={openUploadDialog} onRetention={openRetentionDialog} onLegalHold={toggleLegalHold} onDispose={disposeDoc} />
          ))}
        </div>
      )}

      <Dialog open={retentionOpen} onOpenChange={setRetentionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Retention Policy</DialogTitle>
            <DialogDescription>Disposal date is computed from the upload date + retention period. The document can only be disposed once that date has passed and it is not under legal hold.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Retention Period (days)</Label>
            <Input type="number" value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)} placeholder="e.g. 2555 (7 years)" />
          </div>
          <DialogFooter>
            <Button onClick={saveRetention} disabled={savingRetention || !retentionDays} className="bg-ct-teal hover:bg-ct-teal-hover text-white">
              {savingRetention ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
