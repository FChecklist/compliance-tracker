"use client";

// The persistent composer -- same DOM position on every page (mounted once
// in AppShell, never remounted on navigation). Mode pills answer "what am I
// about to do"; the cascading chain rows below them are pre-seeded from
// real capability-tree data (src/lib/services/capability-tree-service.ts),
// not a hardcoded taxonomy. Sending in a chain mode reuses the existing
// POST /api/tasks (task-service.ts:createTask, which already dispatches the
// real task-execution engine) -- no new task-creation logic was needed.
import { useEffect, useState } from "react";
import { Send, Loader2, Paperclip, Zap } from "lucide-react";
import { toast } from "sonner";
import { useAutoGrowTextarea } from "@/lib/use-autogrow-textarea";
import { useVeriChat, FIXED_MODES, type CapabilityNode, type PathSegment } from "./veri-chat-context";

const FIXED_LABELS: Record<string, string> = { discuss: "Discuss", chats: "Chats", todo: "To Do" };

function pathSegmentDisplay(seg: PathSegment): string {
  if (typeof seg === "string") return seg;
  return "[" + seg.values.join(" + ") + "]";
}
function pathDisplayString(path: PathSegment[]): string {
  return path.map(pathSegmentDisplay).join("-");
}

// Walk the tree following `path`; returns the node list for the NEXT row,
// or null once a leaf has been reached (path complete).
function nodeChildrenAt(tree: CapabilityNode[], path: PathSegment[], depth: number): { children: CapabilityNode[] | null; isMulti: boolean } {
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

// Walks a fully-concrete path (post multi-expansion, every segment a plain
// key) to the leaf CapabilityNode it resolves to -- used to pull real
// dispatch data (e.g. a Project's real id) off the leaf rather than relying
// on breadcrumb text alone.
function resolveLeaf(tree: CapabilityNode[], path: PathSegment[]): CapabilityNode | null {
  let level = tree;
  let node: CapabilityNode | null = null;
  for (const seg of path) {
    if (typeof seg !== "string") return null;
    const found = level.find((n) => n.key === seg);
    if (!found) return null;
    node = found;
    level = found.children ?? [];
  }
  return node;
}

function expandPathsForSend(path: PathSegment[]): PathSegment[][] {
  const multiIdx = path.findIndex((s) => typeof s !== "string");
  if (multiIdx === -1) return [path];
  const seg = path[multiIdx] as { multi: true; values: string[] };
  return seg.values.map((v) => {
    const copy = [...path];
    copy[multiIdx] = v;
    return copy;
  });
}

export default function VeriComposer() {
  const { tree, treeLoading, composerMode, setComposerMode, activeTaskId, activeConversationId, closeThread, aiThreadId, bumpRefresh } = useVeriChat();

  const [selectedPath, setSelectedPath] = useState<PathSegment[]>([]);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [queue, setQueue] = useState<{ path: PathSegment[]; text: string; display: string }[]>([]);
  const [engineInputValues, setEngineInputValues] = useState<Record<string, string>>({});
  const textareaRef = useAutoGrowTextarea(value, 160);

  const chainModes = tree.filter((n) => !FIXED_MODES.includes(n.key as never)).map((n) => n.key);
  const preseedKeyForMode = (mode: string): string | null => {
    if (mode === "tasks") return null;
    const node = tree.find((n) => n.key === mode);
    return node ? node.key : null;
  };
  const isChainMode = chainModes.includes(composerMode) || composerMode === "tasks";

  // Re-seed the chain whenever the mode changes (mirrors the validated
  // prototype's applyComposerMode/resetChain behavior).
  useEffect(() => {
    const preseed = preseedKeyForMode(composerMode);
    setSelectedPath(preseed ? [preseed] : []);
    setEngineInputValues({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerMode]);

  // Opening a specific task pre-fills nothing here (the task's own title
  // already encodes the breadcrumb) -- the composer just becomes a plain
  // "add another message to this task" box, same contract as the chat
  // append endpoint below.

  const { children: currentChildren } = tree.length ? nodeChildrenAt(tree, selectedPath, selectedPath.length) : { children: [] };
  const chainComplete = !treeLoading && !activeTaskId && (currentChildren === null || (currentChildren?.length ?? 0) === 0) && selectedPath.length > 0;
  const isThreadOpen = Boolean(activeTaskId || activeConversationId);
  const completedLeaf = chainComplete && tree.length ? resolveLeaf(tree, selectedPath) : null;
  const needsEngineInputs = Boolean(completedLeaf?.inputFields?.length);
  const engineInputsFilled = !needsEngineInputs || (completedLeaf!.inputFields!.every((f) => f.optional || engineInputValues[f.key]?.trim()));

  function toggleSingle(depth: number, key: string) {
    setSelectedPath((prev) => {
      const atDepth = prev[depth];
      if (typeof atDepth === "string" && atDepth === key) return prev.slice(0, depth);
      return [...prev.slice(0, depth), key];
    });
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

  async function dispatchInstruction(path: PathSegment[], text: string, engineInputs?: Record<string, string>) {
    const displayCrumb = pathDisplayString(path);
    const concretePaths = expandPathsForSend(path);
    for (const p of concretePaths) {
      const crumb = pathDisplayString(p);
      const leaf = resolveLeaf(tree, p);
      const body: Record<string, unknown> = { title: crumb, description: text, projectId: leaf?.projectId ?? undefined };
      // Structured (non-LLM) dispatch: a worker-agent leaf carries its real
      // dispatchable id (agentId when set -- e.g. an entity-scoped leaf like
      // "Compliance Item X -> Mark completed", where `key` must stay unique
      // per item+action but the real agent is shared; otherwise `key` itself
      // IS the real id, as with the plain worker-agent branch leaves), and a
      // calculator leaf carries its engineKey -- passing either through
      // means task-execution-engine.ts can skip LLM planning entirely
      // instead of re-guessing intent from the breadcrumb text.
      if (leaf?.codeReference) {
        body.workerAgentId = leaf.agentId ?? leaf.key;
        const merged = { ...leaf.fixedInputs, ...engineInputs };
        if (Object.keys(merged).length > 0) body.agentInputs = merged;
      }
      // Gap closure, 2026-07-10: this used to only fire when engineInputs
      // was truthy, so an engine leaf with zero typed fields (everything
      // derived from fixedInputs, e.g. GST return validation's returnPeriodId)
      // could never actually reach dispatchEngine() -- it silently fell back
      // to the free-text AI path despite carrying a real engineKey. Always
      // send engineKey once the leaf carries one; fixedInputs alone can be
      // the whole payload.
      if (leaf?.engineKey) {
        const merged = { ...leaf.fixedInputs, ...engineInputs };
        body.engineKey = leaf.engineKey;
        body.engineInputs = merged;
      }
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error();
      } catch {
        toast.error(`Couldn't create task for ${crumb}`);
      }
    }
    if (concretePaths.length > 1) toast.success(`Working on ${concretePaths.length} tasks — see them in VERI Chat`);
    else toast.success(`New task started — ${displayCrumb}`);
    bumpRefresh();
  }

  async function send() {
    if (sending) return;
    // Calculator leaves: the structured inputs ARE the instruction -- free
    // text is optional context, not required, unlike every other chain mode.
    if (isChainMode && chainComplete && needsEngineInputs) {
      if (!engineInputsFilled) return;
      setSending(true);
      try {
        await dispatchInstruction(selectedPath, value.trim(), engineInputValues);
        setValue("");
        setEngineInputValues({});
        setSelectedPath(preseedKeyForMode(composerMode) ? [preseedKeyForMode(composerMode)!] : []);
      } catch {
        toast.error("Failed to send — please try again");
      } finally {
        setSending(false);
      }
      return;
    }

    const text = value.trim();
    if (!text) return;
    setSending(true);
    try {
      if (activeTaskId) {
        const res = await fetch(`/api/tasks/${activeTaskId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        });
        if (!res.ok) throw new Error();
        setValue("");
        bumpRefresh();
      } else if (activeConversationId) {
        const res = await fetch(`/api/conversations/${activeConversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        });
        if (!res.ok) throw new Error();
        setValue("");
        bumpRefresh();
      } else if (composerMode === "discuss") {
        if (!aiThreadId) { toast.error("VERI AI isn't ready yet — try again in a moment"); return; }
        const res = await fetch(`/api/conversations/${aiThreadId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        });
        if (!res.ok) throw new Error();
        setValue("");
        bumpRefresh();
      } else if (isChainMode && chainComplete) {
        await dispatchInstruction(selectedPath, text);
        setValue("");
        setSelectedPath(preseedKeyForMode(composerMode) ? [preseedKeyForMode(composerMode)!] : []);
      }
    } catch {
      toast.error("Failed to send — please try again");
    } finally {
      setSending(false);
    }
  }

  function queueCurrent() {
    const text = value.trim();
    if (!text || !chainComplete) return;
    setQueue((q) => [...q, { path: selectedPath, text, display: pathDisplayString(selectedPath) }]);
    setValue("");
    setSelectedPath(preseedKeyForMode(composerMode) ? [preseedKeyForMode(composerMode)!] : []);
  }

  async function sendAllQueued() {
    for (const item of queue) await dispatchInstruction(item.path, item.text);
    setQueue([]);
  }

  const disabled = !isThreadOpen && composerMode !== "discuss" && composerMode !== "chats" && !(isChainMode && chainComplete) && !needsEngineInputs;
  const placeholder = isThreadOpen
    ? "Message…"
    : composerMode === "discuss"
      ? "Ask me anything — no task selection needed…"
      : composerMode === "chats"
        ? "Pick a conversation in VERI Chat to start typing"
        : needsEngineInputs
          ? "Anything else? (optional)"
          : chainComplete
            ? "Tell your AI Assistant what to do…"
            : "Select a task above to begin…";

  return (
    <div className="shrink-0 border-t border-ct-border bg-white/95 backdrop-blur px-6 py-3">
      <div className="w-full max-w-5xl mx-auto">
        {/* Mode pills */}
        <div className="inline-flex flex-wrap gap-0.5 rounded-full bg-ct-cloud p-1 mb-2">
          {[...FIXED_MODES.filter((m) => m !== "todo" || true)].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setComposerMode(m)}
              className={`text-xs font-medium px-2.5 py-1.5 rounded-full whitespace-nowrap ${composerMode === m && !isThreadOpen ? "bg-white text-ct-navy shadow-sm" : "text-ct-muted"}`}
            >
              {FIXED_LABELS[m]}
            </button>
          ))}
          {tree.filter((n) => !FIXED_MODES.includes(n.key as never)).map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => setComposerMode(n.key)}
              className={`text-xs font-medium px-2.5 py-1.5 rounded-full whitespace-nowrap ${composerMode === n.key && !isThreadOpen ? "bg-white text-ct-navy shadow-sm" : "text-ct-muted"}`}
            >
              {n.label}
            </button>
          ))}
        </div>

        {isChainMode && !isThreadOpen && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 mb-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] font-semibold text-ct-navy">Select the task you want me to do.</span>
              <span className={`text-[11px] font-medium ${chainComplete ? "text-emerald-700" : "text-ct-muted"}`}>
                {selectedPath.length ? (chainComplete ? "" : "Building: ") + pathDisplayString(selectedPath) : ""}
              </span>
            </div>
            <ChainRows tree={tree} selectedPath={selectedPath} onToggleSingle={toggleSingle} onToggleMulti={toggleMulti} />
          </div>
        )}

        {needsEngineInputs && !isThreadOpen && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 mb-2">
            <span className="text-[13px] font-semibold text-ct-navy">{completedLeaf!.label} — enter the details</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {completedLeaf!.inputFields!.map((field) => (
                <div key={field.key}>
                  <label className="text-[10.5px] text-ct-muted">{field.label}</label>
                  {field.type === "select" ? (
                    <select
                      value={engineInputValues[field.key] ?? ""}
                      onChange={(e) => setEngineInputValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="mt-0.5 w-full rounded-lg border border-ct-border2 bg-white px-2.5 py-1.5 text-[13px] text-ct-navy focus:outline-none focus:ring-2 focus:ring-ct-navy/20"
                    >
                      <option value="" disabled>Choose…</option>
                      {(field.options ?? []).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      value={engineInputValues[field.key] ?? ""}
                      onChange={(e) => setEngineInputValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.type === "number_list" ? "e.g. 4, 8, 15, 16" : undefined}
                      className="mt-0.5 w-full rounded-lg border border-ct-border2 bg-white px-2.5 py-1.5 text-[13px] text-ct-navy focus:outline-none focus:ring-2 focus:ring-ct-navy/20"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {chainComplete && !isThreadOpen && completedLeaf && !completedLeaf.deterministic && (
          <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-1.5 mb-2 text-[11.5px] text-ct-slate">
            This will be handled by your AI Assistant, not run as a fixed calculation.
          </div>
        )}

        {queue.length > 0 && isChainMode && !isThreadOpen && (
          <div className="rounded-xl border border-ct-border bg-ct-cloud/50 px-3 py-2 mb-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-ct-slate">Queued</span>
              <button type="button" onClick={sendAllQueued} className="text-[11px] font-semibold text-ct-saffron">Send all ({queue.length})</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {queue.map((item, idx) => (
                <span key={idx} className="inline-flex items-center gap-1.5 rounded-full border border-ct-border bg-white px-2.5 py-1 text-[11px]">
                  {item.display} — {item.text.slice(0, 24)}{item.text.length > 24 ? "…" : ""}
                  <button type="button" onClick={() => setQueue((q) => q.filter((_, i) => i !== idx))} className="text-ct-muted hover:text-red-500">×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-ct-border bg-white shadow-sm px-4 pt-3 pb-2.5">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={placeholder}
            disabled={disabled}
            className="w-full bg-transparent text-[15px] text-ct-navy placeholder:text-ct-muted focus:outline-none resize-none max-h-[160px] overflow-y-auto disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-between mt-2">
            <button type="button" className="grid size-9 place-items-center rounded-lg text-ct-muted hover:bg-ct-cloud hover:text-ct-slate transition-colors" title="Attach a document">
              <Paperclip className="size-[18px]" />
            </button>
            <div className="flex items-center gap-2">
              {isChainMode && !isThreadOpen && (
                <button type="button" onClick={queueCurrent} disabled={!chainComplete || !value.trim()} title="Stage this and start another instruction"
                  className="px-3 h-9 rounded-lg text-[12.5px] font-semibold text-ct-slate border border-ct-border hover:bg-ct-cloud disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  + Add another
                </button>
              )}
              <button type="button" onClick={send} disabled={disabled || sending || (needsEngineInputs ? !engineInputsFilled : !value.trim())}
                className="grid size-9 place-items-center rounded-lg bg-ct-saffron text-white hover:bg-ct-saffron-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-[18px]" />}
              </button>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-ct-muted mt-1.5 px-1">
          {isThreadOpen ? "Enter sends" : isChainMode ? (chainComplete ? "Enter sends, chain resets after each message" : "Complete the chain above to start typing") : composerMode === "discuss" ? "Enter sends — ask anything, no task selection needed" : "Pick a conversation on the right to start typing"}
        </p>

        {isThreadOpen && (
          <button type="button" onClick={closeThread} className="text-[11.5px] font-semibold text-ct-saffron mt-1">
            Back
          </button>
        )}
      </div>
    </div>
  );
}

// Mirrors the validated prototype's renderChain() walk exactly: `isMulti`
// for a row is carried forward from the PARENT node's own `multi` flag
// (set once, e.g. on "Customer"), not re-derived per row after the fact.
function ChainRows({
  tree, selectedPath, onToggleSingle, onToggleMulti,
}: {
  tree: CapabilityNode[];
  selectedPath: PathSegment[];
  onToggleSingle: (depth: number, key: string) => void;
  onToggleMulti: (depth: number, key: string) => void;
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

  return (
    <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
      {rows.map((row) => (
        <div key={row.depth} className="flex items-center gap-1.5 flex-wrap">
          {row.depth > 0 && (
            <span className="text-[10.5px] text-ct-muted shrink-0">
              {row.parentLabel}{row.isMulti ? " (pick one or more)" : ""}:
            </span>
          )}
          {row.options.map((opt) => {
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
        </div>
      ))}
    </div>
  );
}
