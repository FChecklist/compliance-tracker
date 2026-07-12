"use client";

// The persistent composer -- same DOM position on every page (mounted once
// in AppShell, never remounted on navigation). Mode pills answer "what am I
// about to do"; the cascading chain rows below them are pre-seeded from
// real capability-tree data (src/lib/services/capability-tree-service.ts),
// not a hardcoded taxonomy. Sending in a chain mode reuses the existing
// POST /api/tasks (task-service.ts:createTask, which already dispatches the
// real task-execution engine) -- no new task-creation logic was needed.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Send, Loader2, Paperclip, Plus, Link2 } from "lucide-react";
import { toast } from "sonner";
import { useAutoGrowTextarea } from "@/lib/use-autogrow-textarea";
import { useVeriChat, FIXED_MODES, type CapabilityNode, type PathSegment } from "./veri-chat-context";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HIGH_IMPACT_CATEGORY_GUIDANCE, type HighImpactCategory } from "@/lib/high-impact-action-detector";
// Priority 6 item 1: ChainRows and its path-display helpers now live in
// ChainSelector.tsx (shared with the new ChainSelectorDialog used by
// AiThreadSwitcher below) instead of being defined privately here.
import { ChainRows, pathSegmentDisplay, pathDisplayString, nodeChildrenAt, expandPathsForSend, ChainSelectorDialog, type ChainSelectorResult } from "./ChainSelector";

const FIXED_LABELS: Record<string, string> = { discuss: "Discuss", chats: "Chats", todo: "To Do" };

// Breadcrumb rendering for a capability-chain path — each segment is its own
// styled span with a chevron separator, replacing the old flat string.
function PathBreadcrumb({ path, chainComplete }: { path: PathSegment[]; chainComplete: boolean }) {
  if (!path.length) return null;
  const colorClass = chainComplete ? "text-emerald-700" : "text-ct-muted";
  return (
    <span className={`text-[11px] font-medium ${colorClass} inline-flex items-center gap-0.5`}>
      {!chainComplete && <span className="opacity-70">Building:</span>}
      {path.map((seg, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="opacity-50 text-[9px]" aria-hidden="true">›</span>}
          <span>{pathSegmentDisplay(seg)}</span>
        </span>
      ))}
    </span>
  );
}

// Wave 148 (Phase4_Implementation_Plan.md, "multi-thread conversations"):
// lets the user switch which AI thread "Discuss" mode sends to, or spin up
// a new workflow-specific one. Only rendered in discuss mode -- doesn't
// touch task/chain dispatch, which is unaffected by which AI thread is
// "active" (they don't use activeAiThreadId at all).
//
// Priority 6 item 1 (VERI_CHAT_GOVERNANCE.md §5): "New thread" used to be a
// bare window.prompt() for a title only. It now opens ChainSelectorDialog
// first, offering the same Chain Selector (mode pill + path picker) task
// dispatch already uses, so a new workflow thread can start with a
// dynamicChainId already resolved -- exactly the plug-in point
// createNewAiThread()'s 3rd param (chainSelection) was left unused for
// (veri-chat-context.tsx:83-91). Picking "Skip" preserves the exact old
// behavior (title-only thread, no chain). This does not touch
// ensureAiThread() or the default singleton VERI AI thread at all -- only
// this "start a NEW workflow thread" action changed.
function AiThreadSwitcher() {
  const { tree, aiThreads, activeAiThreadId, switchAiThread, createNewAiThread } = useVeriChat();
  const [pickerOpen, setPickerOpen] = useState(false);

  async function handleConfirm(result: ChainSelectorResult) {
    setPickerOpen(false);
    const chainSelection = result.modePill && result.pathKeys?.length
      ? { modePill: result.modePill, pathKeys: result.pathKeys }
      : undefined;
    await createNewAiThread(result.title || undefined, undefined, chainSelection);
  }

  if (aiThreads.length === 0) return null;

  return (
    <div className="flex items-center gap-2 mb-2">
      <Select value={activeAiThreadId ?? undefined} onValueChange={switchAiThread}>
        <SelectTrigger className="h-8 w-[220px] text-xs">
          <SelectValue placeholder="VERI" />
        </SelectTrigger>
        <SelectContent>
          {aiThreads.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.isPrimary ? "VERI (default)" : (t.title || "Untitled workflow")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-ct-saffron hover:text-ct-saffron/80"
        title="Start a new workflow thread"
      >
        <Plus className="size-3.5" /> New thread
      </button>
      <ChainSelectorDialog tree={tree} open={pickerOpen} onOpenChange={setPickerOpen} onConfirm={handleConfirm} />
    </div>
  );
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

export default function VeriComposer({ connectedConnectorsCount = 0 }: { connectedConnectorsCount?: number }) {
  const { tree, treeLoading, composerMode, setComposerMode, activeTaskId, activeConversationId, closeThread, aiThreadId, activeAiThreadId, bumpRefresh } = useVeriChat();

  const [selectedPath, setSelectedPath] = useState<PathSegment[]>([]);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [queue, setQueue] = useState<{ path: PathSegment[]; text: string; display: string }[]>([]);
  const [engineInputValues, setEngineInputValues] = useState<Record<string, string>>({});
  const textareaRef = useAutoGrowTextarea(value, 160);
  // Wave 146 (VERIDIAN.docx joint implementation plan, Phase 2, High-Impact
  // Action Confirmation Gate): set when POST /api/tasks responds with
  // needsConfirmation -- holds the exact same body dispatchInstruction sent,
  // so confirming resubmits it verbatim plus `confirmed: true` rather than
  // re-deriving it. Cleared (and its promise resolved false) on cancel.
  // Wave 161 (VERI_CHAT_GOVERNANCE.md, "VERI-Assisted Communication
  // Protocol"): resolve now carries an optional savePreference alongside
  // confirmed, instead of a bare boolean -- "Always Approve" both confirms
  // this one and tells the server to skip asking next time for this
  // category (task-service.ts checks approval_preferences before re-asking).
  type ConfirmationResolution = { confirmed: boolean; savePreference?: "always_approve" };
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    category: string | null; categoryLabel: string | null; matchedPhrase: string | null; resolve: (resolution: ConfirmationResolution) => void
  } | null>(null);
  // Wave 161 (VERIDIAN_DMP_DCF_CONSTITUTION.md §15, "My Option Is Not
  // Available"): set when the user picks the fallback option in ChainRows
  // instead of a real leaf. While set, send() routes to VERI FDE's real
  // missing-capability pipeline (submitFdeRequest, non-passive) instead of
  // creating a task -- the same governance flow the /fde page already uses,
  // just reachable from the point where a user actually gets stuck.
  const [fdeFallback, setFdeFallback] = useState<{ path: PathSegment[] } | null>(null);
  // tree4-unified U-D5.B2.S3 ("search... minimize clicks"): filters only the
  // deepest (currently-being-picked) row's options -- earlier rows already
  // show a made selection and stay untouched, since they're re-selection
  // controls, not something to search through. Reset on every selectedPath
  // change (below) so a stale query never silently hides options at a row
  // the user has already moved past.
  const [pickerSearch, setPickerSearch] = useState("");

  function requestHighImpactConfirmation(category: string | null, categoryLabel: string | null, matchedPhrase: string | null): Promise<ConfirmationResolution> {
    return new Promise((resolve) => setPendingConfirmation({ category, categoryLabel, matchedPhrase, resolve }));
  }

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
    setFdeFallback(null);
    setPickerSearch("");
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

  async function dispatchInstruction(path: PathSegment[], text: string, engineInputs?: Record<string, string>) {
    // D8/D5.B4.S2 minimum 2-level chain gate -- mirrors task-service.ts's
    // createTask() server-side check so the user sees a clear message
    // immediately instead of only after a rejected round-trip. This is the
    // single function every send path (plain send, calculator-input send,
    // queued sends) funnels through, so one check here covers all of them.
    if (path.length < 2) {
      toast.error("Select at least 2 levels — a category and a sub-option — before sending.");
      return;
    }
    const displayCrumb = pathDisplayString(path);
    const concretePaths = expandPathsForSend(path);
    for (const p of concretePaths) {
      const crumb = pathDisplayString(p);
      const leaf = resolveLeaf(tree, p);
      // Wave 161 (VERIDIAN_DMP_DCF_CONSTITUTION.md, Dynamic Chain ID Phase
      // 1): the resolved chain path is now sent alongside the task so
      // createTask() can persist it to dynamic_chains and link
      // tasks.dynamicChainId. Path segments already double as their own
      // display labels in this UI (see pathSegmentDisplay/PathBreadcrumb
      // above -- no separate label lookup exists today), so pathLabels
      // reuses the same values rather than inventing a second lookup.
      const body: Record<string, unknown> = {
        title: crumb, description: text, projectId: leaf?.projectId ?? undefined,
        modePill: p.length ? pathSegmentDisplay(p[0]) : undefined,
        chainPathKeys: p.length ? p : undefined,
        chainPathLabels: p.length ? p.map(pathSegmentDisplay) : undefined,
      };
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
        let res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const json = await res.json();
          // Wave 146: the gate never creates/executes anything on this first
          // response -- ask the user, then resubmit the SAME body with
          // confirmed: true only if they say yes. Saying no skips this one
          // task without affecting any other concrete path in this loop.
          if (json?.needsConfirmation) {
            const resolution = await requestHighImpactConfirmation(json.category ?? null, json.categoryLabel ?? null, json.matchedPhrase ?? null);
            if (!resolution.confirmed) {
              toast(`Skipped — ${crumb}`);
              continue;
            }
            res = await fetch("/api/tasks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...body, confirmed: true,
                ...(resolution.savePreference ? { savePreference: resolution.savePreference, highImpactCategory: json.category } : {}),
              }),
            });
            if (resolution.savePreference === "always_approve") toast.success(`Got it — I won't ask again for ${json.categoryLabel ?? "this type of action"}.`);
          }
        }
        if (!res.ok) throw new Error();
      } catch {
        toast.error(`Couldn't create task for ${crumb}`);
      }
    }
    if (concretePaths.length > 1) toast.success(`Working on ${concretePaths.length} tasks — see them in VERI Chat`);
    else toast.success(`New task started — ${displayCrumb}`);
    bumpRefresh();
  }

  // VERIDIAN_DMP_DCF_CONSTITUTION.md §15: capture the requirement, route it
  // through the real existing FDE governance pipeline (find-similar ->
  // propose-new-capability -> approvalRequests) -- POST /api/fde/requests
  // is the exact endpoint the dedicated /fde page already uses, called here
  // non-passively (no `passive` flag sent, matching an explicit user ask).
  async function submitFdeFallback(text: string) {
    const partialCrumb = fdeFallback && fdeFallback.path.length ? pathDisplayString(fdeFallback.path) : null;
    const requestText = partialCrumb ? `[${partialCrumb}] ${text}` : text;
    setSending(true);
    try {
      const res = await fetch("/api/fde/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestText }),
      });
      if (!res.ok) throw new Error();
      toast.success("Got it — VERI is looking into this and will route it for approval if it's genuinely new.");
      setValue("");
      setFdeFallback(null);
    } catch {
      toast.error("Couldn't submit your request — please try again");
    } finally {
      setSending(false);
    }
  }

  async function send() {
    if (sending) return;
    if (fdeFallback) {
      const text = value.trim();
      if (!text) return;
      await submitFdeFallback(text);
      return;
    }
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
        // Wave 148: sends to whichever AI thread is active -- the singleton
        // default thread unless the user has switched to (or created) a
        // workflow-specific one via the thread switcher.
        const targetThreadId = activeAiThreadId ?? aiThreadId;
        if (!targetThreadId) { toast.error("VERI AI isn't ready yet — try again in a moment"); return; }
        const res = await fetch(`/api/conversations/${targetThreadId}/messages`, {
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
    // Same D8/D5.B4.S2 gate as dispatchInstruction() -- checked here too so
    // a <2-level path never even makes it into the queue (dispatchInstruction
    // would reject it later anyway, but silently from the queuer's point of
    // view since sendAllQueued() doesn't surface which item failed).
    if (selectedPath.length < 2) {
      toast.error("Select at least 2 levels — a category and a sub-option — before queuing.");
      return;
    }
    setQueue((q) => [...q, { path: selectedPath, text, display: pathDisplayString(selectedPath) }]);
    setValue("");
    setSelectedPath(preseedKeyForMode(composerMode) ? [preseedKeyForMode(composerMode)!] : []);
  }

  async function sendAllQueued() {
    for (const item of queue) await dispatchInstruction(item.path, item.text);
    setQueue([]);
  }

  const disabled = !fdeFallback && !isThreadOpen && composerMode !== "discuss" && composerMode !== "chats" && !(isChainMode && chainComplete) && !needsEngineInputs;
  const placeholder = fdeFallback
    ? "Describe what you need — VERI will look for a match or propose it for approval…"
    : isThreadOpen
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
    <>
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

        {composerMode === "discuss" && !isThreadOpen && (
          <AiThreadSwitcher />
        )}

        {isChainMode && !isThreadOpen && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 mb-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] font-semibold text-ct-navy">Select the task you want me to do.</span>
              <PathBreadcrumb path={selectedPath} chainComplete={chainComplete} />
            </div>
            {!chainComplete && (
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
              tree={tree} selectedPath={selectedPath} onToggleSingle={toggleSingle} onToggleMulti={toggleMulti}
              filterQuery={pickerSearch}
              onFdeFallback={(depth) => {
                setFdeFallback({ path: selectedPath.slice(0, depth) });
                setValue("");
                textareaRef.current?.focus();
              }}
            />
            {fdeFallback && (
              <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-white/70 border border-amber-200 px-2.5 py-1.5">
                <span className="text-[11px] text-ct-muted">Describe what you need below — this goes to VERI for review, not straight to a task.</span>
                <button type="button" onClick={() => setFdeFallback(null)} className="text-[11px] font-medium text-ct-navy shrink-0">Cancel</button>
              </div>
            )}
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
        <div className="flex items-center justify-between mt-1.5 px-1">
          <p className="text-[11px] text-ct-muted">
            {isThreadOpen ? "Enter sends" : isChainMode ? (chainComplete ? "Enter sends, chain resets after each message" : "Complete the chain above to start typing") : composerMode === "discuss" ? "Enter sends — ask anything, no task selection needed" : "Pick a conversation on the right to start typing"}
          </p>
          {/* Connectors.docx wave (2026-07-10): minimal discovery affordance
              -- most users never open the sidebar's ADMIN section, so VERI
              Connect (13 one-click OAuth toolkits) was effectively
              undiscoverable. Plain link to /connectors, not a popover --
              real data-ingestion through these connections isn't built yet,
              so there's nothing to preview inline here. */}
          <Link href="/connectors" className="inline-flex items-center gap-1 text-[11px] font-medium text-ct-muted hover:text-ct-saffron transition-colors shrink-0" title="Connect your tools">
            <Link2 className="size-3.5" />
            {connectedConnectorsCount > 0 && <span className="font-semibold">{connectedConnectorsCount}</span>}
          </Link>
        </div>

        {isThreadOpen && (
          <button type="button" onClick={closeThread} className="text-[11.5px] font-semibold text-ct-saffron mt-1">
            Back
          </button>
        )}
      </div>
    </div>

    {/* Wave 146: High-Impact Action Confirmation Gate -- VERIDIAN.docx CSV
        205 §26's Human-in-Control Rules require explicit confirmation
        before Delete/Payment/Approval/Rejection/Compliance-Submission/
        Access-Change/Data-Export/Configuration-Change intents execute. */}
    <AlertDialog open={pendingConfirmation !== null} onOpenChange={(open) => { if (!open) pendingConfirmation?.resolve({ confirmed: false }); setPendingConfirmation(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm {pendingConfirmation?.categoryLabel ?? "this action"}</AlertDialogTitle>
          <AlertDialogDescription>
            {/* Wave 155 (TaskDocx_Evaluation.md): per-category polite guidance
                (why it's flagged + what to do) instead of one generic sentence
                for every category -- predefined text, not generated. */}
            {pendingConfirmation?.category && pendingConfirmation.category in HIGH_IMPACT_CATEGORY_GUIDANCE
              ? HIGH_IMPACT_CATEGORY_GUIDANCE[pendingConfirmation.category as HighImpactCategory]
              : "VERI never runs actions like this without your explicit go-ahead. Continue?"}
            {pendingConfirmation?.matchedPhrase && (
              <span className="block mt-1.5 text-xs text-ct-muted">Matched: &quot;{pendingConfirmation.matchedPhrase}&quot;</span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => { pendingConfirmation?.resolve({ confirmed: false }); setPendingConfirmation(null); }}>Cancel</AlertDialogCancel>
          {/* Wave 161: the "Simplified Approval Experience" quick-action set
              (VERI_CHAT_GOVERNANCE.md) -- Approve Once and Always Approve.
              "Always Reject" is deliberately not offered here: silently
              blocking a whole category from a dialog the user is actively
              engaging with is a confusing UX, not a useful shortcut; that
              path stays available to saveApprovalPreference() directly
              (e.g. a future Settings page) without a button here. */}
          <button
            type="button"
            onClick={() => { pendingConfirmation?.resolve({ confirmed: true, savePreference: "always_approve" }); setPendingConfirmation(null); }}
            className="inline-flex items-center justify-center rounded-md border border-ct-border2 bg-white px-3 py-2 text-sm font-medium text-ct-navy hover:bg-ct-cloud"
          >
            Always Approve
          </button>
          <AlertDialogAction onClick={() => { pendingConfirmation?.resolve({ confirmed: true }); setPendingConfirmation(null); }}>Approve Once</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
