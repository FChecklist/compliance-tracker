"use client";

// Priority 6 item 1 (VERI_CHAT_GOVERNANCE.md §5 / this session's tracker):
// the Chain Selector (mode pill + cascading path picker) used to live only
// as private, unexported code inside VeriComposer.tsx (ChainRows plus the
// pathSegmentDisplay/pathDisplayString/nodeChildrenAt/expandPathsForSend
// helpers it needs). Priority 5 deliberately deferred wiring a Chain
// Selector step into the new-conversation flow ("a real UX change to a
// live, actively-used messaging surface... deserves its own scoped wave" --
// VERI_CHAT_GOVERNANCE.md §5) and left createNewAiThread()'s 3rd param
// (chainSelection) unused specifically so this follow-on had somewhere to
// plug in (veri-chat-context.tsx:83-91).
//
// This file is that follow-on. It moves the existing chain-picking pieces
// out of VeriComposer.tsx into a shared module (VeriComposer now imports
// them from here instead of defining its own copies -- no duplicated
// logic), and adds one new component, ChainSelectorDialog, which offers
// the same picker as a pre-conversation step. Nothing about how a chain
// resolves changed: this still ends up calling createWorkflowThread() with
// the same {modePill, pathKeys} shape dispatchInstruction() has always
// sent for tasks (resolveDynamicChainId() in task-service.ts is the single
// place either path is actually resolved).
import { useState } from "react";
import { Zap } from "lucide-react";
import { FIXED_MODES, type CapabilityNode, type PathSegment } from "./veri-chat-context";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export function pathSegmentDisplay(seg: PathSegment): string {
  if (typeof seg === "string") return seg;
  return "[" + seg.values.join(" + ") + "]";
}

export function pathDisplayString(path: PathSegment[]): string {
  return path.map(pathSegmentDisplay).join("-");
}

// AI Suggested Calculations (VERIDIAN Review Framework gap closure,
// 2026-07-18): proactively surface a matching VCEL calculator leaf while
// the user is still typing in the existing chain-picker search box
// (VeriComposer's `pickerSearch`), instead of requiring them to already
// know which category/sub-category a calculator lives under. Deliberately
// reuses the same real capability tree the picker itself renders from
// (buildCapabilityTree() -> capability-tree-service.ts) -- this is a
// client-side filter over already-fetched data, not a new endpoint or a
// second source of truth for "which calculators exist."
export type CalculatorSuggestion = { path: string[]; label: string; category: string };

function collectCalculatorLeaves(
  nodes: CapabilityNode[], keyPath: string[], labelPath: string[], out: CalculatorSuggestion[]
): void {
  for (const node of nodes) {
    const nextKeyPath = [...keyPath, node.key];
    if (node.engineKey && node.deterministic) {
      out.push({ path: nextKeyPath, label: node.label, category: labelPath.join(" › ") || node.label });
    }
    if (node.children?.length) {
      collectCalculatorLeaves(node.children, nextKeyPath, [...labelPath, node.label], out);
    }
  }
}

// Requires >= 2 characters before matching (mirrors ChainRows' own
// filterQuery convention) so this never fires on an empty/near-empty
// search and dumps every calculator in the tree as a "suggestion."
export function findCalculatorSuggestions(tree: CapabilityNode[], query: string, limit = 4): CalculatorSuggestion[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 2) return [];
  const all: CalculatorSuggestion[] = [];
  collectCalculatorLeaves(tree, [], [], all);
  return all
    .filter((c) => c.label.toLowerCase().includes(trimmed) || c.category.toLowerCase().includes(trimmed))
    .slice(0, limit);
}

// Walk the tree following `path`; returns the node list for the NEXT row,
// or null once a leaf has been reached (path complete).
export function nodeChildrenAt(tree: CapabilityNode[], path: PathSegment[], depth: number): { children: CapabilityNode[] | null; isMulti: boolean } {
  let level = tree;
  for (let i = 0; i < depth; i++) {
    const seg = path[i];
    if (typeof seg === "string") {
      const found = level.find((n) => n.key === seg);
      if (!found) return { children: null, isMulti: false };
      if (found.leaf) return { children: null, isMulti: false };
      level = found.children ?? [];
    } else {
      const union = new Map<string, CapabilityNode>();
      for (const v of seg.values) {
        const found = level.find((n) => n.key === v);
        (found?.children ?? []).forEach((c) => union.set(c.key, c));
      }
      level = Array.from(union.values());
    }
  }
  return { children: level, isMulti: false };
}

// A multi-select segment (e.g. "[CustomerA + CustomerB]") expands into one
// concrete path per value -- used by task dispatch to fan a single chain
// selection out into several real tasks. The Chain Selector dialog below
// only needs the FIRST concrete expansion (a new conversation carries a
// single dynamicChainId, not one per fanned-out value), but the function
// itself is the same one VeriComposer.tsx already relies on for tasks.
export function expandPathsForSend(path: PathSegment[]): PathSegment[][] {
  const multiIdx = path.findIndex((s) => typeof s !== "string");
  if (multiIdx === -1) return [path];
  const seg = path[multiIdx] as { multi: true; values: string[] };
  return seg.values.map((v) => {
    const copy = [...path];
    copy[multiIdx] = v;
    return copy;
  });
}

// Mirrors the validated prototype's renderChain() walk exactly: `isMulti`
// for a row is carried forward from the PARENT node's own `multi` flag
// (set once, e.g. on "Customer"), not re-derived per row after the fact.
export function ChainRows({
  tree, selectedPath, onToggleSingle, onToggleMulti, onFdeFallback, filterQuery,
}: {
  tree: CapabilityNode[];
  selectedPath: PathSegment[];
  onToggleSingle: (depth: number, key: string) => void;
  onToggleMulti: (depth: number, key: string) => void;
  // Wave 161: fires with the path selected so far (not yet including this
  // row's own depth) when the user picks "My Option Is Not Available"
  // instead of a real leaf at this row. Optional here -- the new-
  // conversation Chain Selector doesn't offer the FDE fallback path (a new
  // thread with no chain at all is already "skip and start plain", so
  // there's no stuck state that needs an escape hatch the way task
  // dispatch has).
  onFdeFallback?: (depth: number) => void;
  // tree4-unified U-D5.B2.S3 ("search"): applied only to the deepest row
  // (the one currently being picked from) -- earlier rows show already-made
  // selections, not something a search should hide.
  filterQuery?: string;
}) {
  const rows: { depth: number; parentLabel: string; isMulti: boolean; options: CapabilityNode[] }[] = [];

  let options: CapabilityNode[] = tree;
  let isMulti = false;
  let parentLabel = "";

  for (let depth = 0; ; depth++) {
    if (!options || options.length === 0) break;
    rows.push({ depth, options, isMulti, parentLabel });

    const sel = selectedPath[depth];
    if (sel === undefined) break;

    if (typeof sel === "string") {
      const found = options.find((o) => o.key === sel);
      if (!found || found.leaf) break;
      options = found.children ?? [];
      isMulti = found.multi === true;
      parentLabel = found.label;
    } else {
      const union = new Map<string, CapabilityNode>();
      sel.values.forEach((v) => {
        const found = options.find((o) => o.key === v);
        (found?.children ?? []).forEach((c) => union.set(c.key, c));
      });
      options = Array.from(union.values());
      isMulti = false;
      parentLabel = "[" + sel.values.join(" + ") + "]";
    }
  }

  const normalizedFilter = filterQuery?.trim().toLowerCase() ?? "";

  return (
    <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
      {rows.map((row) => {
        const isDeepestRow = row.depth === rows.length - 1;
        const visibleOptions = isDeepestRow && normalizedFilter
          ? row.options.filter((o) => o.label.toLowerCase().includes(normalizedFilter))
          : row.options;
        return (
        <div key={row.depth} className="flex items-center gap-1.5 flex-wrap">
          {row.depth > 0 && (
            <span className="text-[10.5px] text-ct-muted shrink-0">
              {row.parentLabel}{row.isMulti ? " (pick one or more)" : ""}:
            </span>
          )}
          {isDeepestRow && normalizedFilter && visibleOptions.length === 0 && (
            <span className="text-[11px] text-ct-muted italic">No matches{onFdeFallback ? " — try \"My Option Is Not Available\" below." : "."}</span>
          )}
          {visibleOptions.map((opt) => {
            const sel = selectedPath[row.depth];
            const isSelected = row.isMulti
              ? Boolean(sel && typeof sel !== "string" && sel.values.includes(opt.key))
              : sel === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => (row.isMulti ? onToggleMulti(row.depth, opt.key) : onToggleSingle(row.depth, opt.key))}
                title={opt.leaf ? (opt.deterministic ? "Runs instantly — no AI guessing" : "This will be handled by your AI Assistant, not run as a fixed calculation") : undefined}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                  isSelected
                    ? opt.leaf ? "bg-emerald-700 border-emerald-700 text-white" : "bg-ct-navy border-ct-navy text-white"
                    : "bg-white border-ct-border2 text-ct-navy"
                }`}
              >
                {opt.leaf && opt.deterministic && <Zap className="size-3 shrink-0" fill="currentColor" />}
                {opt.label}
              </button>
            );
          })}
          {/* Wave 161 (VERIDIAN_DMP_DCF_CONSTITUTION.md §15): only on the
              currently-active (deepest) row -- a user who already picked
              something at an earlier depth isn't "stuck" there anymore. */}
          {onFdeFallback && row.depth === rows.length - 1 && (
            <button
              type="button"
              onClick={() => onFdeFallback(row.depth)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-ct-border2 px-2.5 py-1 text-xs text-ct-muted hover:text-ct-navy hover:border-ct-navy"
            >
              My Option Is Not Available
            </button>
          )}
        </div>
        );
      })}
    </div>
  );
}

export type ChainSelectorResult = { title: string; modePill?: string; pathKeys?: string[] };

// The new component this wave actually adds: a pre-conversation step that
// offers the same ChainRows picker used everywhere else, then hands back
// {title, modePill, pathKeys} for the caller to pass straight into
// createNewAiThread()'s existing 3rd param. Depth 0 of ChainRows (fed the
// tree with FIXED_MODES excluded) doubles as the "mode pill" row -- the
// same convention dispatchInstruction() already uses when it computes
// modePill from the FIRST path segment (VeriComposer.tsx:
// `modePill: p.length ? pathSegmentDisplay(p[0]) : undefined`).
//
// Deliberately does NOT touch ensureAiThread() or the default singleton
// VERI AI thread -- this dialog only ever feeds into createNewAiThread(),
// the existing "start a new workflow thread" action, never the default
// 1:1 thread's creation path.
export function ChainSelectorDialog({
  tree, open, onOpenChange, onConfirm,
}: {
  tree: CapabilityNode[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (result: ChainSelectorResult) => void;
}) {
  const [title, setTitle] = useState("");
  const [selectedPath, setSelectedPath] = useState<PathSegment[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");

  const chainTree = tree.filter((n) => !FIXED_MODES.includes(n.key as never));

  function toggleSingle(depth: number, key: string) {
    setSelectedPath((prev) => {
      const atDepth = prev[depth];
      if (typeof atDepth === "string" && atDepth === key) return prev.slice(0, depth);
      return [...prev.slice(0, depth), key];
    });
    setPickerSearch("");
  }
  function toggleMulti(depth: number, key: string) {
    setSelectedPath((prev) => {
      const atDepth = prev[depth];
      const current = atDepth && typeof atDepth !== "string" ? atDepth.values : [];
      const has = current.includes(key);
      const nextVals = has ? current.filter((v) => v !== key) : [...current, key];
      const base = prev.slice(0, depth);
      return nextVals.length ? [...base, { multi: true, values: nextVals }] : base;
    });
  }

  const { children: currentChildren } = chainTree.length
    ? nodeChildrenAt(chainTree, selectedPath, selectedPath.length)
    : { children: null };
  const chainComplete = selectedPath.length > 0 && (currentChildren === null || (currentChildren?.length ?? 0) === 0);

  function reset() {
    setTitle("");
    setSelectedPath([]);
    setPickerSearch("");
  }

  function confirmWithChain() {
    const resolvedTitle = title.trim() || "New workflow";
    if (!chainComplete) {
      onConfirm({ title: resolvedTitle });
      reset();
      return;
    }
    // A new conversation carries one dynamicChainId -- if the user picked a
    // multi-select value at some depth, take the first concrete expansion
    // (matches how a single task from a multi-select chain would resolve;
    // fanning a new *conversation* out into several threads isn't offered
    // here, unlike task dispatch's expandPathsForSend loop).
    const [concrete] = expandPathsForSend(selectedPath);
    onConfirm({
      title: resolvedTitle,
      modePill: concrete.length ? pathSegmentDisplay(concrete[0]) : undefined,
      pathKeys: concrete.length ? concrete.map((s) => (typeof s === "string" ? s : s.values.join("+"))) : undefined,
    });
    reset();
  }

  function skip() {
    onConfirm({ title: title.trim() || "New workflow" });
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Start a new workflow thread</DialogTitle>
          <DialogDescription>
            Name it, and optionally tell VERI what it&apos;s about — related tasks get linked to the same chain automatically. Skip this if you just want a plain thread.
          </DialogDescription>
        </DialogHeader>

        <div>
          <label className="text-[11px] font-medium text-ct-muted" htmlFor="new-thread-title">Thread name</label>
          <input
            id="new-thread-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='e.g. "Setting up payroll"'
            className="mt-1 w-full rounded-lg border border-ct-border2 bg-white px-3 py-2 text-sm text-ct-navy placeholder:text-ct-muted focus:outline-none focus:ring-2 focus:ring-ct-navy/20"
            autoFocus
          />
        </div>

        {chainTree.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] font-semibold text-ct-navy">What&apos;s this about? (optional)</span>
              <span className={`text-[11px] font-medium ${chainComplete ? "text-emerald-700" : "text-ct-muted"}`}>
                {pathDisplayString(selectedPath) || "Nothing selected yet"}
              </span>
            </div>
            {!chainComplete && selectedPath.length > 0 && (
              <input
                type="text"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search options…"
                aria-label="Search chain options"
                className="mb-1.5 w-full rounded-full border border-ct-border2 bg-white px-3 py-1 text-xs text-ct-navy placeholder:text-ct-muted focus:outline-none focus:ring-1 focus:ring-ct-navy"
              />
            )}
            <ChainRows
              tree={chainTree}
              selectedPath={selectedPath}
              onToggleSingle={toggleSingle}
              onToggleMulti={toggleMulti}
              filterQuery={pickerSearch}
            />
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={skip}
            className="inline-flex items-center justify-center rounded-md border border-ct-border2 bg-white px-3 py-2 text-sm font-medium text-ct-navy hover:bg-ct-cloud"
          >
            Skip — just start
          </button>
          <button
            type="button"
            onClick={confirmWithChain}
            disabled={!title.trim() && !chainComplete}
            className="inline-flex items-center justify-center rounded-md bg-ct-saffron px-3 py-2 text-sm font-semibold text-white hover:bg-ct-saffron-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {chainComplete ? "Start with this chain" : "Start thread"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
