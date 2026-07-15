"use client";

// Priority 21, Layer 2 Workspace Memory -- entry point matching
// ApiKeySection.tsx's shape exactly (ai-os/priority21_workspace_memory_design.md
// §3.5): a primary action, a history list, toasts. No new UI paradigm.
import { useEffect, useState, useCallback, useRef } from "react";
import { Download, Upload, Brain, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type CapsuleEvent = {
  id: string;
  direction: "export" | "import";
  fileSizeBytes: number;
  itemCounts: { savedReports?: number; conversations?: number; messages?: number };
  status: string;
  createdAt: string;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function WorkspaceMemorySection() {
  const [events, setEvents] = useState<CapsuleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-ct-navy flex items-center gap-2">
          <Brain className="size-4" />
          Workspace Memory
        </h3>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mv2"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={handleImportClick}
            disabled={importing}
          >
            <Upload className="size-3.5 mr-1" />
            {importing ? "Importing..." : "Import"}
          </Button>
          <Button
            size="sm"
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white text-xs h-8"
            onClick={handleExport}
            disabled={exporting}
          >
            <Download className="size-3.5 mr-1" />
            {exporting ? "Exporting..." : "Export My Workspace Memory"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-ct-muted bg-ct-cloud rounded-lg p-3">
        Download a portable file (.mv2) containing your own saved report
        definitions and your recent AI-thread conversations, so you can carry
        them to another device. This never includes other people&apos;s data
        or live compliance/financial records. Importing a capsule adds your
        saved reports as new entries (never overwrites existing ones) and
        makes imported conversations viewable read-only.
      </p>

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
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ct-navy capitalize">{ev.direction}</span>
                  <span className="text-[10px] font-mono text-ct-muted bg-ct-cloud px-1.5 py-0.5 rounded">
                    {formatBytes(ev.fileSizeBytes)}
                  </span>
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
