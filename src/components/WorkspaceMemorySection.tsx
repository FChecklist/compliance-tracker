"use client";

// Priority 21, Layer 2 Workspace Memory -- entry point matching
// ApiKeySection.tsx's shape (ai-os/priority21_workspace_memory_design.md
// §3.5), extended per the Owner directive "have all 3 options for the
// user" (ai-os/priority21_workspace_memory_design.md §4 named 3 real
// cross-device sync-transport options and left the choice open -- this
// builds all 3 as real, named, distinct user-facing choices rather than
// defaulting to the design doc's own "start with Option 1" recommendation).
// Every import path below (manual upload, Drive import, VERIDIAN pull) ends
// up at the exact same additive-only importWorkspaceMemory() function --
// see workspace-memory-service.ts -- so SEC-04's "never silently overwrite"
// guarantee is identical no matter which option a user picks.
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Download,
  Upload,
  Brain,
  ArrowDownToLine,
  ArrowUpFromLine,
  HardDrive,
  RefreshCw,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type CapsuleEvent = {
  id: string;
  direction: "export" | "import";
  fileSizeBytes: number;
  itemCounts: { savedReports?: number; conversations?: number; messages?: number };
  status: string;
  syncMethod?: "manual" | "google_drive" | "veridian_pull" | null;
  createdAt: string;
};

const SYNC_METHOD_LABEL: Record<string, string> = {
  manual: "Download/Upload",
  google_drive: "Google Drive",
  veridian_pull: "VERIDIAN",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Shared by every "download bytes from a signed URL, then hand them to the existing import route" flow (Option 3, and any client-side re-use). Never a second parsing/writing code path -- just fetch bytes, POST to the same route the manual file picker already posts to. */
async function importFromSignedUrl(signedUrl: string, fileName: string) {
  const fileRes = await fetch(signedUrl);
  if (!fileRes.ok) throw new Error("Failed to download the capsule");
  const blob = await fileRes.blob();
  const formData = new FormData();
  formData.append("file", new File([blob], fileName, { type: "application/octet-stream" }));
  const res = await fetch("/api/workspace-memory/import", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to import");
  return data;
}

export default function WorkspaceMemorySection() {
  const [events, setEvents] = useState<CapsuleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [driveExporting, setDriveExporting] = useState(false);
  const [driveImporting, setDriveImporting] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchEvents = useCallback(() => {
    setLoading(true);
    fetch("/api/workspace-memory")
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((data) => setEvents(data.events ?? []))
      .catch(() => toast.error("Failed to load workspace memory history"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // ─── Option 1: manual download / upload ─────────────────────────────────

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/workspace-memory/export", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to export");
      // Trigger the browser download via the short-lived signed URL --
      // the .mv2 bytes never pass back through this app's own response body.
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = "workspace-memory.mv2";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(
        `Exported ${data.itemCounts.savedReports} saved reports and ${data.itemCounts.conversations} conversations`
      );
      fetchEvents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export workspace memory");
    } finally {
      setExporting(false);
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/workspace-memory/import", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to import");
      toast.success(
        `Imported ${data.itemCounts.savedReports} saved reports (added as new); ${data.itemCounts.conversations} conversations available to view`
      );
      fetchEvents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import workspace memory");
    } finally {
      setImporting(false);
    }
  };

  // ─── Option 2: sync via Google Drive ────────────────────────────────────

  const handleDriveExport = async () => {
    setDriveExporting(true);
    try {
      const res = await fetch("/api/workspace-memory/drive-export", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to sync to Google Drive");
      toast.success(`Saved to Google Drive (VERIDIAN Workspace Memory folder)`);
      fetchEvents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to sync to Google Drive");
    } finally {
      setDriveExporting(false);
    }
  };

  const handleDriveImport = async () => {
    setDriveImporting(true);
    try {
      const res = await fetch("/api/workspace-memory/drive-import", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to sync from Google Drive");
      toast.success(
        `Imported ${data.itemCounts.savedReports} saved reports from Google Drive (added as new)`
      );
      fetchEvents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to sync from Google Drive");
    } finally {
      setDriveImporting(false);
    }
  };

  // ─── Option 3: sync via VERIDIAN (first-party pull-latest) ──────────────

  const handleSyncNow = async () => {
    setSyncingNow(true);
    try {
      const latestRes = await fetch("/api/workspace-memory/latest");
      const latest = await latestRes.json();
      if (!latestRes.ok) throw new Error(latest.error || "Nothing to sync yet");
      const data = await importFromSignedUrl(latest.signedUrl, "workspace-memory.mv2");
      toast.success(
        `Synced ${data.itemCounts.savedReports} saved reports from your last export (added as new)`
      );
      fetchEvents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to sync");
    } finally {
      setSyncingNow(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ct-navy flex items-center gap-2">
          <Brain className="size-4" />
          Workspace Memory
        </h3>
        <p className="text-xs text-ct-muted mt-1">
          A portable capsule (.mv2) of your own saved report definitions and
          recent AI-thread conversations, so you can carry them to another
          device. This never includes other people&apos;s data or live
          compliance/financial records. Importing always adds your saved
          reports as new entries (never overwrites existing ones) and makes
          imported conversations viewable read-only.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Option 1 -- manual download/upload */}
        <div className="rounded-lg border border-ct-border bg-ct-cloud p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ct-navy">
            <Download className="size-3.5" />
            Download a file
          </div>
          <p className="text-[11px] text-ct-muted">
            Save the .mv2 file yourself and carry it however you like (USB
            drive, personal cloud folder, email to self).
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mv2"
            className="hidden"
            onChange={handleFileSelected}
          />
          <div className="flex flex-col gap-1.5">
            <Button
              size="sm"
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white text-xs h-8 w-full"
              onClick={handleExport}
              disabled={exporting}
            >
              <Download className="size-3.5 mr-1" />
              {exporting ? "Exporting..." : "Export"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 w-full"
              onClick={handleImportClick}
              disabled={importing}
            >
              <Upload className="size-3.5 mr-1" />
              {importing ? "Importing..." : "Import"}
            </Button>
          </div>
        </div>

        {/* Option 2 -- Google Drive auto-sync */}
        <div className="rounded-lg border border-ct-border bg-ct-cloud p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ct-navy">
            <HardDrive className="size-3.5" />
            Sync via Google Drive
          </div>
          <p className="text-[11px] text-ct-muted">
            Auto-saves to a &quot;VERIDIAN Workspace Memory&quot; folder in
            your connected Drive. Requires Google Drive connected in{" "}
            <a href="/connectors" className="underline text-ct-teal inline-flex items-center gap-0.5">
              Connectors <Link2 className="size-2.5" />
            </a>
            .
          </p>
          <div className="flex flex-col gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 w-full"
              onClick={handleDriveExport}
              disabled={driveExporting}
            >
              <ArrowUpFromLine className="size-3.5 mr-1" />
              {driveExporting ? "Saving..." : "Export to Drive"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 w-full"
              onClick={handleDriveImport}
              disabled={driveImporting}
            >
              <ArrowDownToLine className="size-3.5 mr-1" />
              {driveImporting ? "Importing..." : "Import latest from Drive"}
            </Button>
          </div>
        </div>

        {/* Option 3 -- first-party VERIDIAN sync */}
        <div className="rounded-lg border border-ct-border bg-ct-cloud p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ct-navy">
            <RefreshCw className="size-3.5" />
            Sync via VERIDIAN
          </div>
          <p className="text-[11px] text-ct-muted">
            Pulls your last export straight from VERIDIAN&apos;s own storage
            onto this device -- no file to save or upload yourself.
          </p>
          <div className="flex flex-col gap-1.5">
            <Button
              size="sm"
              className="bg-ct-teal hover:bg-ct-teal-hover text-white text-xs h-8 w-full"
              onClick={handleSyncNow}
              disabled={syncingNow}
            >
              <RefreshCw className={`size-3.5 mr-1 ${syncingNow ? "animate-spin" : ""}`} />
              {syncingNow ? "Syncing..." : "Sync now"}
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-6 bg-ct-cloud rounded-lg">
          <Brain className="size-7 text-ct-border mx-auto mb-2" />
          <p className="text-sm text-ct-muted">No exports or imports yet.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {events.map((ev) => (
            <div
              key={ev.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-white border border-ct-border"
            >
              {ev.direction === "export" ? (
                <ArrowDownToLine className="size-4 text-ct-teal shrink-0" />
              ) : (
                <ArrowUpFromLine className="size-4 text-ct-saffron shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-ct-navy capitalize">{ev.direction}</span>
                  <span className="text-[10px] font-mono text-ct-muted bg-ct-cloud px-1.5 py-0.5 rounded">
                    {formatBytes(ev.fileSizeBytes)}
                  </span>
                  {ev.syncMethod && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                      {SYNC_METHOD_LABEL[ev.syncMethod] ?? ev.syncMethod}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-ct-muted mt-0.5">
                  {ev.itemCounts.savedReports ?? 0} reports, {ev.itemCounts.conversations ?? 0} conversations
                  {" · "}
                  {new Date(ev.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
