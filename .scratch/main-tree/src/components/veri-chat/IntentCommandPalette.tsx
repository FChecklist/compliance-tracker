"use client";

// Spotlight-style command palette for VeriComposer -- Owner spec 2026-07-14
// (CONTROLLER.yaml PALETTE-01, task 2): press "/" or Tab in the empty chat
// box to recall a previous workflow (mode pill + chain path + chat text)
// and restore it in one click. Anchored dropdown above the composer, not a
// full-screen modal -- this is a chat-composer accessory, not a global
// command surface, so it stays in visual context with the input it affects
// (same reasoning VeriComposer already applies to its own inline "Search
// options…" picker).
//
// Blends two sources, browser cache first: the local IndexedDB store
// (browser-intent-cache.ts, instant, offline, zero AI cost -- exactly the
// Owner's spec) is queried first; only when it comes back EMPTY for the
// current mode does this fall back to GET /api/dynamic-chains/my-library,
// the already-shipped server-side per-user chain library
// (chain-usage-ranking.ts) that was built but never wired into any UI.
// This gives a fresh browser/device a real "your workflows" first
// experience instead of an empty palette, at zero extra engineering cost --
// that endpoint already existed, this is its first caller.
import { useEffect, useRef, useState } from "react";
import { Pin, Star, Trash2, Search } from "lucide-react";
import {
  queryIntents, deleteIntent, toggleField, runExpirationSweep,
  type CachedIntent,
} from "@/lib/browser-intent-cache";

// Shape returned by GET /api/dynamic-chains/my-library (chain-usage-ranking.ts's
// PersonalChainLibraryEntry) -- normalized into the same row shape the
// palette renders so one list/keyboard-nav implementation serves both
// sources without a second code path.
type ServerLibraryChain = { id: string; modePill: string; pathKeys: unknown; pathLabels: unknown; description: string | null };

type PaletteRow = { key: string; displayLabel: string; chatMessage: string; source: "local" | "server"; intent?: CachedIntent; serverChain?: ServerLibraryChain };

export function IntentCommandPalette({
  open, composerMode, onClose, onSelect,
}: {
  open: boolean;
  composerMode: string;
  onClose: () => void;
  onSelect: (row: { source: "local"; intent: CachedIntent } | { source: "server"; chain: ServerLibraryChain }) => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PaletteRow[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    runExpirationSweep();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const local = await queryIntents({ composerMode, searchText: query, limit: 12 });
      if (cancelled) return;

      if (local.length > 0) {
        setRows(local.map((intent) => ({ key: `local:${intent.intentId}`, displayLabel: intent.displayLabel, chatMessage: intent.chatMessage, source: "local", intent })));
        setLoading(false);
        return;
      }

      // Local cache empty for this mode -- fall back to the server's
      // already-built per-user library rather than showing nothing.
      try {
        const res = await fetch("/api/dynamic-chains/my-library");
        if (cancelled) return;
        if (!res.ok) { setRows([]); setLoading(false); return; }
        const data = await res.json();
        const chains: ServerLibraryChain[] = Array.isArray(data?.chains) ? data.chains : [];
        const q = query.trim().toLowerCase();
        const filtered = chains
          .filter((c) => c.modePill === composerMode)
          .filter((c) => !q || (Array.isArray(c.pathLabels) ? c.pathLabels.join(" ") : "").toLowerCase().includes(q))
          .slice(0, 12);
        setRows(filtered.map((c) => ({
          key: `server:${c.id}`,
          displayLabel: Array.isArray(c.pathLabels) ? c.pathLabels.join(" › ") : c.modePill,
          chatMessage: c.description ?? "",
          source: "server",
          serverChain: c,
        })));
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, composerMode, query]);

  useEffect(() => {
    if (activeIndex >= rows.length) setActiveIndex(Math.max(0, rows.length - 1));
  }, [rows, activeIndex]);

  function pick(row: PaletteRow) {
    if (row.source === "local" && row.intent) onSelect({ source: "local", intent: row.intent });
    else if (row.source === "server" && row.serverChain) onSelect({ source: "server", chain: row.serverChain });
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(rows.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); return; }
    if (e.key === "Enter") { e.preventDefault(); const row = rows[activeIndex]; if (row) pick(row); return; }
  }

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      onKeyDown={onKeyDown}
      className="absolute bottom-full left-0 right-0 mb-2 z-30 rounded-2xl border border-ct-border bg-white shadow-lg overflow-hidden"
      role="listbox"
      aria-label="Previous workflows"
    >
      <div className="flex items-center gap-2 border-b border-ct-border px-3.5 py-2.5">
        <Search className="size-4 text-ct-muted shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search previous workflows…"
          className="w-full bg-transparent text-sm text-ct-navy placeholder:text-ct-muted focus:outline-none"
        />
        <span className="text-[10.5px] text-ct-muted shrink-0">Esc to close</span>
      </div>

      <div className="max-h-72 overflow-y-auto py-1">
        {loading && rows.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-ct-muted">Searching…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-ct-muted">
            No previous workflows for this mode yet — they&apos;ll appear here after you send a task.
          </div>
        )}
        {rows.map((row, idx) => (
          <div
            key={row.key}
            role="option"
            aria-selected={idx === activeIndex}
            onMouseEnter={() => setActiveIndex(idx)}
            onClick={() => pick(row)}
            className={`flex items-center justify-between gap-3 px-3.5 py-2.5 cursor-pointer ${idx === activeIndex ? "bg-ct-cloud" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {row.intent?.pinned && <Pin className="size-3 text-ct-saffron shrink-0" />}
                {row.intent?.favorite && <Star className="size-3 text-ct-saffron shrink-0" />}
                <span className="truncate text-[13px] font-medium text-ct-navy">{row.displayLabel}</span>
              </div>
              {row.chatMessage && (
                <p className="truncate text-[11.5px] text-ct-muted mt-0.5">{row.chatMessage}</p>
              )}
            </div>
            {row.source === "local" && row.intent && (
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  title={row.intent.pinned ? "Unpin" : "Pin"}
                  onClick={async () => { await toggleField(row.intent!.intentId, "pinned"); setRows((r) => r.map((x) => x.key === row.key && x.intent ? { ...x, intent: { ...x.intent, pinned: !x.intent.pinned } } : x)); }}
                  className="grid size-6 place-items-center rounded hover:bg-white text-ct-muted hover:text-ct-saffron"
                >
                  <Pin className="size-3.5" />
                </button>
                <button
                  type="button"
                  title="Remove"
                  onClick={async () => { await deleteIntent(row.intent!.intentId); setRows((r) => r.filter((x) => x.key !== row.key)); }}
                  className="grid size-6 place-items-center rounded hover:bg-white text-ct-muted hover:text-red-500"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )}
            {row.source === "server" && (
              <span className="text-[10px] text-ct-muted shrink-0" title="From your account history, not yet used on this device">synced</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
