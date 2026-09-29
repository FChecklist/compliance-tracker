"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge (2026-09-29): port of PROJEXA's Document object page
// (src/app/(app)/documents/[id]/page.tsx + DocumentObjectClient.tsx there)
// into compliance-tracker. See ../page.tsx's header comment for why this
// lives at px/documents (not documents), and for the real deviation in
// which API prefix each half of the module actually uses.
//
// This detail page's own reads/writes DO all live under the
// /api/v1/projexa/documents/[id]/** prefix the task asked for -- it is only
// the LIST+CREATE half (../page.tsx) that has to reach compliance-tracker's
// root /api/v1/documents instead.
//
// Real gap versus PROJEXA's real object page, NOT invented here because the
// backend does not expose it on this surface: Retention policy (days) and
// Legal Hold both have a real PATCH under the INTERNAL
// /api/documents/[id]/retention route only (session-cookie requireAuth(),
// used by compliance-tracker's own native /documents page) -- nothing under
// /api/v1/projexa/documents/[id] exposes either. Dispose still works fully:
// disposeDocument() only READS retentionPeriodDays/legalHold/disposalDate,
// which this page's own GET response already carries, so the button and its
// disabled-reason text are real, just not settable from here.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Download, History, Loader2, Pencil, ShieldOff } from "lucide-react";

// Same list as ../page.tsx's DOCUMENT_CATEGORIES -- kept as its own const per
// this repo's single-file-page convention (recruitment/page.tsx keeps its own
// STAGE_ORDER/STAGE_LABEL rather than importing a shared module).
const DOCUMENT_CATEGORIES = ["permit", "drawing", "contract", "certificate", "license", "site_photo", "email", "other"] as const;

function categoryWords(category: string): string {
  return category.replace(/_/g, " ");
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
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

type DocVersion = { id: string; name: string; versionNumber: number; createdAt: string; fileType: string | null };
type DocDetail = {
  id: string;
  name: string;
  category: string | null;
  fileType: string | null;
  fileSize: number | null;
  expiryDate: string | null;
  versionNumber: number;
  createdAt: string;
  isDisposed: boolean;
  legalHold: boolean;
  disposalDate: string | null;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  isExternalLink: boolean;
  versions: DocVersion[];
  signedUrl: string | null;
  expiresInSeconds: number;
};

/** Same reasons PROJEXA's DocumentObjectClient.disposeDisabledReason gives, in a person's language. */
function disposeDisabledReason(doc: Pick<DocDetail, "isDisposed" | "legalHold" | "disposalDate">, disposing: boolean, today: string): string | undefined {
  if (doc.isDisposed) return "Already disposed";
  if (doc.legalHold) return "On legal hold — cannot be disposed";
  if (!doc.disposalDate) return "Cannot dispose — no retention policy is set for this document.";
  if (doc.disposalDate > today) return `Kept until ${formatDate(doc.disposalDate)} under the retention policy`;
  return disposing ? "Disposing…" : undefined;
}

/** A PDF or image can be shown inline; anything else (or a disposed document) gets the link alone. */
function previewKind(doc: Pick<DocDetail, "fileType" | "isDisposed" | "signedUrl">): "pdf" | "image" | null {
  if (doc.isDisposed || !doc.signedUrl) return null;
  const type = (doc.fileType ?? "").toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  return null;
}

export default function PxDocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  const [expiryDate, setExpiryDate] = useState("");
  const [replacement, setReplacement] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [disposing, setDisposing] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewRetried, setPreviewRetried] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/v1/projexa/documents/${id}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load this document");
      setDoc(body);
      setPreviewFailed(false);
    } catch (err) {
      setDoc(null);
      setLoadError(err instanceof Error && err.message ? err.message : "Couldn't load this document");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function handlePreviewError() {
    if (previewRetried) {
      setPreviewFailed(true);
      return;
    }
    // A signed URL is valid for 5 minutes; the first failure on a page left
    // open longer than that means "re-sign it", not "this file cannot be shown".
    setPreviewRetried(true);
    void load();
  }

  function startEdit() {
    if (!doc) return;
    setName(doc.name);
    setCategory(doc.category ?? "other");
    setExpiryDate(doc.expiryDate ? doc.expiryDate.slice(0, 10) : "");
    setReplacement(null);
    setEditing(true);
  }

  async function save() {
    if (!doc || !name.trim()) return;
    setSaving(true);
    try {
      if (replacement) {
        const formData = new FormData();
        formData.set("file", replacement);
        const res = await fetch(`/api/v1/projexa/documents/${id}/versions`, { method: "POST", body: formData });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? "Failed to replace this document's file");
        toast.success(`File replaced — version ${body.versionNumber ?? ""}`.trim());
        setEditing(false);
        setReplacement(null);
        // The replacement is a NEW row -- follow it, or this page would keep
        // showing the superseded version.
        router.replace(`/px/documents/${body.id}`);
        return;
      }

      const res = await fetch(`/api/v1/projexa/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), category, expiryDate: expiryDate || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed to save document");
      toast.success("Saved");
      setEditing(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't save document");
    } finally {
      setSaving(false);
    }
  }

  async function dispose() {
    if (!doc) return;
    setDisposing(true);
    try {
      const res = await fetch(`/api/v1/projexa/documents/${id}/dispose`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed to dispose document");
      toast.success(`${doc.name} disposed`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't dispose document");
    } finally {
      setDisposing(false);
    }
  }

  if (loading) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-ct-muted" />
      </div>
    );
  }

  if (loadError || !doc) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-ct-error">
          {loadError ?? "Couldn't load this document"}
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const disposeReason = disposeDisabledReason(doc, disposing, today);
  const preview = previewFailed ? null : previewKind(doc);
  const earlierVersions = doc.versions.filter((v) => v.id !== doc.id);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.push("/px/documents")}>
        <ArrowLeft className="size-4" /> Back to Documents
      </Button>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">{doc.name}</h1>
          <p className="text-sm text-ct-muted mt-1 flex items-center gap-2">
            Version {doc.versionNumber}
            {doc.isDisposed ? (
              <Badge className="bg-ct-error/10 text-ct-error border-ct-error/20 text-xs">disposed</Badge>
            ) : doc.legalHold ? (
              <Badge className="bg-ct-navy/10 text-ct-navy border-ct-navy/20 text-xs">legal hold</Badge>
            ) : doc.category ? (
              <Badge variant="outline" className="text-xs">
                {categoryWords(doc.category)}
              </Badge>
            ) : null}
          </p>
        </div>
        {!doc.isDisposed && !editing && (
          <Button variant="outline" onClick={startEdit}>
            <Pencil className="size-4" /> Edit
          </Button>
        )}
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-4 space-y-4">
          {preview === "pdf" && (
            <iframe
              src={doc.signedUrl ?? undefined}
              title={doc.name}
              className="h-[480px] w-full rounded-md border border-ct-border"
              onError={handlePreviewError}
            />
          )}
          {preview === "image" && (
            // A short-lived signed storage URL cannot go through next/image's
            // optimizer -- a plain <img> is correct here (this repo's eslint
            // config has @next/next/no-img-element off, confirmed by the
            // lint run for this PR).
            <img
              src={doc.signedUrl ?? undefined}
              alt={doc.name}
              className="h-[480px] w-full rounded-md border border-ct-border object-contain"
              onError={handlePreviewError}
            />
          )}

          {doc.signedUrl && !doc.isDisposed && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <a
                href={doc.signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 text-ct-teal inline-flex items-center gap-1"
              >
                <Download className="size-3.5" /> View / Download this document
              </a>
              {!doc.isExternalLink && (
                <>
                  <span className="text-xs text-ct-muted">
                    Link valid for {Math.max(1, Math.round(doc.expiresInSeconds / 60))}{" "}
                    {Math.round(doc.expiresInSeconds / 60) === 1 ? "minute" : "minutes"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="text-xs text-ct-muted underline underline-offset-2 hover:text-ct-navy"
                  >
                    Refresh link
                  </button>
                </>
              )}
            </p>
          )}
          {doc.isDisposed && <p className="text-sm text-ct-muted">This document has been disposed — the file is no longer retrievable.</p>}

          {editing ? (
            <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Category</Label>
                <Select value={category} onValueChange={setCategory}>
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
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Expiry date</Label>
                <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Replace file</Label>
                <Input type="file" onChange={(e) => setReplacement(e.target.files?.[0] ?? null)} />
                <p className="text-xs text-ct-muted">
                  {replacement
                    ? `${replacement.name} will become version ${doc.versionNumber + 1}`
                    : "Keeps this document and its history; the new file becomes the latest version."}
                </p>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-3 text-sm max-w-md">
              <div>
                <dt className="text-ct-muted">Category</dt>
                <dd className="text-ct-navy">{doc.category ? categoryWords(doc.category) : "—"}</dd>
              </div>
              <div>
                <dt className="text-ct-muted">Type</dt>
                <dd className="text-ct-navy">{doc.fileType ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ct-muted">Size</dt>
                <dd className="text-ct-navy">{formatSize(doc.fileSize)}</dd>
              </div>
              <div>
                <dt className="text-ct-muted">Relates to</dt>
                <dd className="text-ct-navy">{relatesToWord(doc.linkedEntityType)}</dd>
              </div>
              <div>
                <dt className="text-ct-muted">Expiry date</dt>
                <dd className="text-ct-navy">{doc.expiryDate ? formatDate(doc.expiryDate) : "—"}</dd>
              </div>
              <div>
                <dt className="text-ct-muted">Added</dt>
                <dd className="text-ct-navy">{formatDate(doc.createdAt)}</dd>
              </div>
            </dl>
          )}

          {earlierVersions.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-ct-border">
              <p className="text-xs font-semibold text-ct-muted uppercase flex items-center gap-1.5">
                <History className="size-3" /> Earlier versions
              </p>
              <ul className="text-sm text-ct-muted space-y-0.5">
                {earlierVersions.map((v) => (
                  <li key={v.id}>
                    v{v.versionNumber} — {formatDate(v.createdAt)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {editing && (
            <div className="flex items-center gap-2 pt-2">
              <Button onClick={save} disabled={saving || !name.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Save
              </Button>
              <Button variant="outline" onClick={() => { setReplacement(null); setEditing(false); }}>
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!doc.isDisposed && (
        <Card className="rounded-xl border-ct-error/30 bg-ct-error/5 shadow-none">
          <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-ct-navy">Dispose removes the stored file. This cannot be undone.</p>
            <Button variant="destructive" size="sm" disabled={!!disposeReason} title={disposeReason} onClick={dispose}>
              {disposing ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />} Dispose
            </Button>
          </CardContent>
          {disposeReason && !disposing && (
            <CardContent className="pt-0 pb-3">
              <p className="text-xs text-ct-muted">{disposeReason}</p>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
