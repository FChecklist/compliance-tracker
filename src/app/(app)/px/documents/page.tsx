"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge (2026-09-29): port of PROJEXA's Documents module
// (src/app/(app)/documents/page.tsx + DocumentsClient.tsx, and the separate
// documents/upload/page.tsx + DocumentUploadClient.tsx PROJEXA uses for
// create) into compliance-tracker as a native page calling the same-origin
// backend directly (real signed-in session, no HTTP hop, no X-Acting-User
// bridge -- requireActingPerson() resolves the acting person straight from
// ctx.dbUser for a real session).
//
// Lives at px/documents, NOT documents: compliance-tracker already has its
// OWN native /documents page (Wave 61) -- a central, ORG-WIDE repository
// view with retention/legal-hold/classification-rules/full-text-search --
// over the exact same compliance.documents table. Verified directly this is
// NOT the same kind of duplicate recruitment/page.tsx's header comment
// describes: PROJEXA's Documents screen answers a genuinely different
// question on the same rows -- PROJECT scope (every document filed against
// one project, or against one of that project's permits/RFIs/meetings),
// no retention/legal-hold/classification UI, no full-text search. Both
// screens stay; this is not a candidate for the later
// consolidation pass recruitment's header flags for the other 6.
//
// REAL DEVIATION from this task's own instruction to read only
// `/api/v1/projexa/documents/**` for the response shape: the Documents
// module never had a list+create route under that prefix. PROJEXA's own
// src/lib/module-list-source.ts documents this explicitly ("/api/v1/
// documents was never re-exported under /api/v1/projexa/*, hence root") --
// its list read and its upload both go to compliance-tracker's root
// /api/v1/documents (requireAuthOrApiKey-gated, the identical real-session
// auth every /api/v1/projexa/* route uses, just not nested under that path
// segment). Only the single-document surface (view+signed-url / patch /
// dispose / versions) actually lives under /api/v1/projexa/documents/
// [id]/**. Both are same-origin and require the same real signed-in
// session -- this is a path-naming quirk in the already-existing backend,
// not a different auth model, so it is used as-is rather than inventing a
// new /api/v1/projexa/documents route this task did not ask for.
//
// Real gaps versus PROJEXA's UI, NOT invented here because the backend does
// not expose them on this session/Bearer surface (see the object page for
// the rest of this list):
//   - Full-text content search (/api/documents/search) and the
//     expiring/pending-disposal aggregate feeds compliance-tracker's own
//     native page shows are internal-cookie-route-only; omitted rather
//     than faked with client-side approximations.
//
// UI rebuilt in compliance-tracker's own component vocabulary (@/components
// /ui/*, shadcn Table/Select/Dialog, csv-export.ts) -- PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen/ListScreen is not used anywhere
// in this port.
import { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv, toCsv } from "@/lib/csv-export";
import { Loader2, Plus, FileText, Filter, Download } from "lucide-react";

type Doc = {
  id: string;
  name: string;
  category: string | null;
  fileType: string | null;
  fileSize: number | null;
  expiryDate: string | null;
  versionNumber: number;
  createdAt: string;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
};
type Project = { id: string; name: string; status: string };
type RelatesToOption = { type: "permit" | "rfi" | "mom"; id: string; label: string };

// Same list PROJEXA's src/lib/document-intake.ts defines (DOCUMENT_CATEGORIES)
// -- the filter, the upload dialog and the object page in THIS port are all
// inside two files, so this is the one pair that must not drift.
const DOCUMENT_CATEGORIES = ["permit", "drawing", "contract", "certificate", "license", "site_photo", "email", "other"] as const;

function categoryWords(category: string): string {
  return category.replace(/_/g, " ");
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function relatesToWord(type: string | null): string {
  if (!type) return "—";
  if (type === "project") return "Project";
  if (type === "permit") return "Permit";
  if (type === "rfi") return "RFI";
  if (type === "mom") return "Minutes of Meeting";
  return type.replace(/_/g, " ");
}

function PxDocumentsPageInner() {
  const router = useRouter();
  // useSearchParams-in-Suspense convention (recruitment/page.tsx, mood-boards/
  // page.tsx, reports/page.tsx's CustomReportsSection).
  const searchParams = useSearchParams();
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [category, setCategory] = useState("all");
  const [fileType, setFileType] = useState("");
  const [addedFrom, setAddedFrom] = useState("");
  const [addedTo, setAddedTo] = useState("");
  const [relatesTo, setRelatesTo] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  const [relatedOptions, setRelatedOptions] = useState<RelatesToOption[]>([]);
  const [relatedLabels, setRelatedLabels] = useState<Record<string, string>>({});

  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState("other");
  const [uploadRelatesTo, setUploadRelatesTo] = useState("");
  const [uploadExpiry, setUploadExpiry] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailReceivedOn, setEmailReceivedOn] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [uploading, setUploading] = useState(false);

  // Projects, once -- the picker this screen needs since (unlike every other
  // ported px/ module so far -- recruitment/hr/settings are org-wide)
  // Documents is PROJECT-scoped. Same GET /api/v1/projexa/projects the
  // Phase 0 Projects list page and every "New Project" picker already use.
  useEffect(() => {
    fetch("/api/v1/projexa/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false));
  }, []);

  const selectProject = useCallback(
    (id: string) => {
      setProjectId(id);
      const params = new URLSearchParams(window.location.search);
      if (id) params.set("projectId", id);
      else params.delete("projectId");
      router.replace(`/px/documents?${params.toString()}`, { scroll: false });
    },
    [router]
  );

  const load = useCallback(async () => {
    if (!projectId) {
      setDocs([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      // R67 D-14 (documents/route.ts's own comment): projectScopeId, not
      // linkedEntityType=project -- a document filed against one of this
      // project's permits/RFIs/meetings still belongs on this screen.
      const params = new URLSearchParams({ projectScopeId: projectId });
      if (category !== "all") params.set("category", category);
      const res = await fetch(`/api/v1/documents?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load documents");
      setDocs(body.documents ?? []);
    } catch (err) {
      setDocs([]);
      setLoadError(err instanceof Error && err.message ? err.message : "Couldn't load documents");
    } finally {
      setLoading(false);
    }
  }, [projectId, category]);

  useEffect(() => {
    load();
  }, [load]);

  // "Relates to" -- this project's own permits, RFIs and meetings, the same
  // three reads PROJEXA's own create screen and list make. Each is allowed
  // to fail on its own (Promise.allSettled): a permits list that does not
  // answer costs one group of options, never the rest of the screen.
  useEffect(() => {
    if (!projectId) {
      setRelatedOptions([]);
      setRelatedLabels({});
      return;
    }
    let cancelled = false;
    const scope = encodeURIComponent(projectId);
    (async () => {
      const [permits, rfis, moms] = await Promise.allSettled([
        fetch(`/api/v1/projexa/permits?projectId=${scope}&all=true`).then((r) => r.json()),
        fetch(`/api/v1/projexa/rfis?projectId=${scope}`).then((r) => r.json()),
        fetch(`/api/v1/projexa/veri-meetings?projectId=${scope}`).then((r) => r.json()),
      ]);
      if (cancelled) return;
      const opts: RelatesToOption[] = [];
      const labels: Record<string, string> = {};
      if (permits.status === "fulfilled") {
        for (const p of (permits.value.permits ?? []) as { id: string; name: string; permitNumber: string | null }[]) {
          const label = p.permitNumber ? `${p.name} (${p.permitNumber})` : p.name;
          opts.push({ type: "permit", id: p.id, label });
          labels[p.id] = label;
        }
      }
      if (rfis.status === "fulfilled") {
        for (const r of (rfis.value.rfis ?? []) as { id: string; number: number; subject: string }[]) {
          const label = `RFI ${r.number} — ${r.subject}`;
          opts.push({ type: "rfi", id: r.id, label });
          labels[r.id] = label;
        }
      }
      if (moms.status === "fulfilled") {
        for (const m of (moms.value.meetings ?? []) as { id: string; title: string }[]) {
          opts.push({ type: "mom", id: m.id, label: m.title });
          labels[m.id] = m.title;
        }
      }
      setRelatedOptions(opts);
      setRelatedLabels(labels);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const projectName = projects.find((p) => p.id === projectId)?.name;

  function relatesToText(d: Doc): string {
    if (!d.linkedEntityType) return "—";
    if (d.linkedEntityType === "project") return projectName ? `Project — ${projectName}` : "Project";
    const label = d.linkedEntityId ? relatedLabels[d.linkedEntityId] : undefined;
    return label ? `${relatesToWord(d.linkedEntityType)} — ${label}` : relatesToWord(d.linkedEntityType);
  }

  const visible = useMemo(
    () =>
      docs.filter((d) => {
        if (fileType && !(d.fileType ?? "").toLowerCase().includes(fileType.toLowerCase())) return false;
        const addedOn = d.createdAt.slice(0, 10);
        if (addedFrom && addedOn < addedFrom) return false;
        if (addedTo && addedOn > addedTo) return false;
        if (relatesTo && (d.linkedEntityType ?? "") !== relatesTo) return false;
        return true;
      }),
    [docs, fileType, addedFrom, addedTo, relatesTo]
  );
  const filtered = category !== "all" || !!fileType || !!addedFrom || !!addedTo || !!relatesTo;
  const fileTypes = useMemo(
    () => [...new Set(docs.map((d) => d.fileType).filter((t): t is string => !!t && !!t.trim()))].sort(),
    [docs]
  );

  function clearFilters() {
    setCategory("all");
    setFileType("");
    setAddedFrom("");
    setAddedTo("");
    setRelatesTo("");
  }

  function openUpload() {
    setFile(null);
    setUploadName("");
    setUploadCategory("other");
    setUploadRelatesTo(`project:${projectId}`);
    setUploadExpiry("");
    setEmailFrom("");
    setEmailReceivedOn("");
    setEmailSubject("");
    setOpen(true);
  }

  async function upload() {
    if (!file || !projectId) return;
    setUploading(true);
    try {
      const separator = uploadRelatesTo.indexOf(":");
      const relType = separator > 0 ? uploadRelatesTo.slice(0, separator) : "project";
      const relId = separator > 0 ? uploadRelatesTo.slice(separator + 1) : projectId;

      const formData = new FormData();
      formData.set("file", file);
      if (uploadName.trim()) formData.set("name", uploadName.trim());
      formData.set("category", uploadCategory);
      formData.set("linkedEntityType", relType);
      formData.set("linkedEntityId", relId);
      // R67 D-14: the project this document BELONGS to, independent of what
      // it is RELATED to -- how the project's own list still finds a
      // document filed against one of its permits/RFIs/meetings.
      formData.set("projectId", projectId);
      if (uploadExpiry) formData.set("expiryDate", new Date(uploadExpiry).toISOString());
      if (uploadCategory === "email") {
        if (emailFrom.trim()) formData.set("emailFrom", emailFrom.trim());
        if (emailReceivedOn.trim()) formData.set("emailReceivedOn", emailReceivedOn.trim());
        if (emailSubject.trim()) formData.set("emailSubject", emailSubject.trim());
      }

      const res = await fetch("/api/v1/documents", { method: "POST", body: formData });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed to upload document");
      toast.success(`Document ${(body.name as string | undefined) ?? ""} added`.trim());
      setOpen(false);
      if (body.id) router.push(`/px/documents/${body.id}`);
      else load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't upload document");
    } finally {
      setUploading(false);
    }
  }

  function exportVisible() {
    const csv = toCsv(
      ["Name", "Category", "Type", "Size", "Relates to", "Expiry", "Added"],
      visible.map((d) => [
        d.name,
        d.category ? categoryWords(d.category) : "",
        d.fileType ?? "",
        d.fileSize === null ? "" : formatSize(d.fileSize),
        relatesToText(d),
        d.expiryDate ? formatDate(d.expiryDate) : "",
        formatDate(d.createdAt),
      ])
    );
    downloadCsv(`documents-${projectId}.csv`, csv);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Documents</h1>
          <p className="text-sm text-ct-muted mt-1">
            Documents that belong to this project — the ones filed against the project itself and the ones filed
            against one of its permits, RFIs or meetings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={projectId} onValueChange={selectProject} disabled={projectsLoading || projects.length === 0}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder={projectsLoading ? "Loading projects…" : "Select a project"} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!projectsLoading && projects.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-2">
            <p>No projects yet -- documents are filed against a project.</p>
            <Link href="/projects" className="text-ct-teal underline underline-offset-2">
              Create a project
            </Link>
          </CardContent>
        </Card>
      ) : !projectId ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">
            Select a project above to see its documents.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFilterOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-ct-border px-2.5 py-1.5 text-[13px] text-ct-navy hover:bg-ct-cloud"
              >
                <Filter className="size-3.5" aria-hidden /> Filter
              </button>
              <button
                type="button"
                onClick={exportVisible}
                disabled={loading || visible.length === 0}
                title={loading ? "Still loading" : visible.length === 0 ? "Nothing to export" : undefined}
                className="inline-flex items-center gap-1.5 rounded-md border border-ct-border px-2.5 py-1.5 text-[13px] text-ct-navy hover:bg-ct-cloud disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="size-3.5" aria-hidden /> Export
              </button>
            </div>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={openUpload}>
              <Plus className="size-4" /> New Document
            </Button>
          </div>

          {filterOpen && (
            <div className="flex flex-wrap items-end gap-4 rounded-md border border-ct-border px-4 py-3">
              <div className="space-y-1">
                <Label className="text-xs text-ct-muted">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {DOCUMENT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {categoryWords(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-ct-muted">File type</Label>
                <select
                  value={fileType}
                  onChange={(e) => setFileType(e.target.value)}
                  className="rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
                >
                  <option value="">All</option>
                  {fileTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <span className="block text-xs text-ct-muted">Added between</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    aria-label="Added from"
                    value={addedFrom}
                    onChange={(e) => setAddedFrom(e.target.value)}
                    className="rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
                  />
                  <span className="text-xs text-ct-muted">and</span>
                  <input
                    type="date"
                    aria-label="Added to"
                    value={addedTo}
                    onChange={(e) => setAddedTo(e.target.value)}
                    className="rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-ct-muted">Relates to</Label>
                <select
                  value={relatesTo}
                  onChange={(e) => setRelatesTo(e.target.value)}
                  className="rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
                >
                  <option value="">All</option>
                  <option value="project">Project</option>
                  <option value="permit">Permit</option>
                  <option value="rfi">RFI</option>
                  <option value="mom">Minutes of Meeting</option>
                </select>
              </div>
              {filtered && (
                <div className="flex items-center gap-3 pb-1.5">
                  <span className="text-xs text-ct-muted">
                    Showing {visible.length} of {docs.length}
                  </span>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-xs text-ct-muted underline underline-offset-2 hover:text-ct-navy"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}

          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              {loading ? (
                <div className="grid h-40 place-items-center">
                  <Loader2 className="size-6 animate-spin text-ct-muted" />
                </div>
              ) : loadError ? (
                <p role="alert" className="p-6 text-sm text-ct-error">
                  {loadError}
                </p>
              ) : visible.length === 0 ? (
                <p className="py-10 text-center text-sm text-ct-muted">
                  {category !== "all"
                    ? `No ${categoryWords(category)} documents for ${projectName ?? "this project"}.`
                    : filtered
                      ? `No documents match this filter for ${projectName ?? "this project"}.`
                      : `No documents yet for ${projectName ?? "this project"}.`}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Relates to</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((d) => (
                      <TableRow
                        key={d.id}
                        className="cursor-pointer hover:bg-ct-cloud/40"
                        onClick={() => router.push(`/px/documents/${d.id}`)}
                      >
                        <TableCell className="font-medium text-ct-navy">
                          <span className="flex items-center gap-2">
                            <FileText className="size-4 text-ct-muted" /> {d.name}
                          </span>
                        </TableCell>
                        <TableCell>
                          {d.category ? <Badge variant="outline">{categoryWords(d.category)}</Badge> : <span className="text-ct-muted">—</span>}
                        </TableCell>
                        <TableCell className="text-ct-muted">{d.fileType ?? "—"}</TableCell>
                        <TableCell className="text-ct-muted">{formatSize(d.fileSize)}</TableCell>
                        <TableCell className="text-ct-muted">{relatesToText(d)}</TableCell>
                        <TableCell className="text-ct-muted">{d.expiryDate ? formatDate(d.expiryDate) : "—"}</TableCell>
                        <TableCell className="text-ct-muted">{formatDate(d.createdAt)}</TableCell>
                        <TableCell>
                          <Link
                            href={`/px/documents/${d.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="underline underline-offset-2 text-[13px]"
                          >
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Document</DialogTitle>
            <DialogDescription>Stored in the private document bucket, never publicly accessible.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">File</Label>
              <Input
                type="file"
                onChange={(e) => {
                  const chosen = e.target.files?.[0] ?? null;
                  setFile(chosen);
                  if (chosen && !uploadName.trim()) {
                    const dot = chosen.name.lastIndexOf(".");
                    setUploadName(dot > 0 ? chosen.name.slice(0, dot) : chosen.name);
                  }
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="Defaults to the file name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Category</Label>
                <Select value={uploadCategory} onValueChange={setUploadCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {categoryWords(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Relates to</Label>
              <Select value={uploadRelatesTo} onValueChange={setUploadRelatesTo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={`project:${projectId}`}>
                    {projectName ? `Project — ${projectName}` : "This project"}
                  </SelectItem>
                  {relatedOptions.map((o) => (
                    <SelectItem key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>
                      {o.type === "permit" ? "Permit" : o.type === "rfi" ? "RFI" : "Minutes of Meeting"} — {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Expiry date (optional)</Label>
              <Input type="date" value={uploadExpiry} onChange={(e) => setUploadExpiry(e.target.value)} />
            </div>
            {uploadCategory === "email" && (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">From</Label>
                  <Input value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Received on</Label>
                  <Input type="date" value={emailReceivedOn} onChange={(e) => setEmailReceivedOn(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Subject</Label>
                  <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
                </div>
              </div>
            )}
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
  );
}

export default function PxDocumentsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-ct-muted">Loading...</div>}>
      <PxDocumentsPageInner />
    </Suspense>
  );
}
