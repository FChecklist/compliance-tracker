"use client";

// Shared state between VeriComposer (bottom, always in the same spot) and
// VeriChatPanel (right side away from Home, merged into Home's center).
// Deliberately keeps two independent axes, validated in the prototype:
// `composerMode` answers "what am I about to DO" (drives the composer),
// `rightPanelView` answers "what am I currently LOOKING AT" (drives the
// panel's list) -- switching one must never disturb the other. Opening a
// specific task or conversation is the one thing that's shared, since
// continuing it genuinely requires both sides to agree on what's open.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

// "select" renders as a dropdown of fixed choices (a click, never typed
// text) -- used when one engine bundles several related functions (e.g.
// Basic Arithmetic Engine covers add/subtract/multiply/divide) so the user
// still never has to type something that could be spelled wrong. "number_list"
// is a comma-separated list of numbers, parsed server-side into number[].
export type CapabilityInputField = {
  key: string;
  label: string;
  type: "number" | "text" | "select" | "number_list";
  optional?: boolean;
  options?: { value: string; label: string }[];
};

export type CapabilityNode = {
  key: string;
  label: string;
  leaf: boolean;
  multi?: boolean;
  codeReference?: string | null;
  projectId?: string | null;
  // Set on VCEL calculator leaves (capability-tree-service.ts's Calculators
  // branch) -- identifies which computation_engines row to dispatch, paired
  // with inputFields describing what the composer must collect before send.
  engineKey?: string | null;
  inputFields?: CapabilityInputField[];
  // The real worker_agents.id to dispatch, when it differs from `key` (e.g.
  // an entity-scoped leaf like "Compliance Item X -> Mark completed", where
  // `key` must stay unique per item+action but the dispatchable agent is
  // shared across every such leaf). Falls back to `key` when unset, which is
  // how the plain worker-agent branch leaves (key IS the real agent id)
  // already work.
  agentId?: string | null;
  // Values already determined by the leaf's position in the tree (e.g. which
  // compliance item, which target status) -- sent through untouched, unlike
  // inputFields which the composer still has to prompt the user to type.
  fixedInputs?: Record<string, string>;
  // True when this leaf carries a real codeReference or engineKey -- the
  // selection is guaranteed to run as real software with zero AI
  // involvement, computed server-side in capability-tree-service.ts.
  deterministic?: boolean;
  children?: CapabilityNode[];
};

export type PathSegment = string | { multi: true; values: string[] };

export const FIXED_MODES = ["discuss", "chats", "todo"] as const;

type VeriChatState = {
  tree: CapabilityNode[];
  treeLoading: boolean;
  composerMode: string;
  setComposerMode: (mode: string) => void;
  activeTaskId: string | null;
  activeConversationId: string | null;
  openTask: (id: string) => void;
  openConversation: (id: string) => void;
  closeThread: () => void;
  rightPanelView: "overview" | "tasks" | "chats" | "todo";
  setRightPanelView: (v: "overview" | "tasks" | "chats" | "todo") => void;
  aiThreadId: string | null;
  refreshCounter: number;
  bumpRefresh: () => void;
  // Wave 148 (Phase4_Implementation_Plan.md, "multi-thread conversations"):
  // aiThreadId above stays the singleton default thread, unchanged --
  // activeAiThreadId is what the composer actually sends to, defaulting to
  // aiThreadId but switchable to any workflow thread the user opens/creates.
  activeAiThreadId: string | null;
  aiThreads: { id: string; title: string | null; workflowId: string | null; isPrimary: boolean }[];
  switchAiThread: (id: string) => void;
  // Priority 5 item E1 (10-priority5-software-orchestrator-tracker.yaml):
  // optional 3rd param threads a resolved Dynamic Chain selection through to
  // POST /api/conversations/workflow-thread -> createWorkflowThread(), same
  // plumbing task creation already has via VeriComposer's dispatchInstruction.
  // No caller sends this yet -- offering the existing Chain Selector
  // (VeriComposer's ChainRows) as a step before this call is a real UX
  // change to a live surface, deliberately deferred (see this dispatch's PR
  // description); this signature exists so that follow-on UI work has
  // somewhere to plug in without a second service-layer change.
  createNewAiThread: (title?: string, workflowId?: string, chainSelection?: { modePill: string; pathKeys: string[] }) => Promise<string | null>;
};

const VeriChatContext = createContext<VeriChatState | null>(null);

// D5.B7: the first path segment IS the route's module, matching this app's
// flat src/app/(app)/<module>/... layout -- there's no separate routes
// config to import from. capability-tree-service.ts's
// MODULE_SCOPE_TOP_LEVEL_KEYS is the single source of truth for which module
// strings actually narrow the tree server-side; any other value here is a
// safe no-op (server falls back to the full tree), so this stays a plain
// string derivation rather than a maintained allowlist that could drift out
// of sync with the server-side map.
function moduleFromPathname(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment || undefined;
}

export function VeriChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const moduleScope = moduleFromPathname(pathname);
  const [tree, setTree] = useState<CapabilityNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [composerMode, setComposerModeState] = useState("tasks");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [rightPanelView, setRightPanelView] = useState<"overview" | "tasks" | "chats" | "todo">("overview");
  const [aiThreadId, setAiThreadId] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [activeAiThreadId, setActiveAiThreadId] = useState<string | null>(null);
  const [aiThreads, setAiThreads] = useState<{ id: string; title: string | null; workflowId: string | null; isPrimary: boolean }[]>([]);

  // D5.B7: was a single mount-once effect with `tree` bundled in alongside
  // conversations -- split out so the tree can legitimately re-fetch on
  // `moduleScope` changes (i.e. real page-to-page navigation between
  // different top-level route segments) without also re-running the
  // unrelated one-shot conversations/AI-thread load below on every
  // navigation.
  useEffect(() => {
    setTreeLoading(true);
    const url = moduleScope ? `/api/capability-tree?module=${encodeURIComponent(moduleScope)}` : "/api/capability-tree";
    fetch(url)
      .then((r) => r.json())
      .then((d) => setTree(d.nodes ?? []))
      .catch(() => setTree([]))
      .finally(() => setTreeLoading(false));
  }, [moduleScope]);

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((d) => {
        const all: { id: string; isAiThread: boolean; title: string | null; workflowId: string | null; isPrimary: boolean }[] = d?.conversations ?? [];
        const ai = all.filter((c) => c.isAiThread);
        setAiThreads(ai.map((c) => ({ id: c.id, title: c.title, workflowId: c.workflowId, isPrimary: c.isPrimary })));
        const primary = ai.find((c) => c.isPrimary) ?? ai[0];
        if (primary) { setAiThreadId(primary.id); setActiveAiThreadId(primary.id); }
      })
      .catch(() => {});
  }, []);

  const switchAiThread = (id: string) => setActiveAiThreadId(id);

  const createNewAiThread = async (
    title?: string, workflowId?: string, chainSelection?: { modePill: string; pathKeys: string[] }
  ): Promise<string | null> => {
    try {
      const res = await fetch("/api/conversations/workflow-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, workflowId,
          modePill: chainSelection?.modePill, pathKeys: chainSelection?.pathKeys,
        }),
      });
      if (!res.ok) return null;
      const { id } = await res.json();
      setAiThreads((prev) => [...prev, { id, title: title ?? "New workflow", workflowId: workflowId ?? null, isPrimary: false }]);
      setActiveAiThreadId(id);
      return id;
    } catch {
      return null;
    }
  };

  const setComposerMode = (mode: string) => {
    setComposerModeState(mode);
    setActiveTaskId(null);
    setActiveConversationId(null);
    if (mode === "chats") setRightPanelView("chats");
    else if (mode === "todo") setRightPanelView("todo");
  };

  const openTask = (id: string) => {
    setActiveTaskId(id);
    setActiveConversationId(null);
    setComposerModeState("tasks");
  };

  const openConversation = (id: string) => {
    setActiveConversationId(id);
    setActiveTaskId(null);
    setComposerModeState("chats");
  };

  const closeThread = () => {
    setActiveTaskId(null);
    setActiveConversationId(null);
  };

  const bumpRefresh = () => setRefreshCounter((c) => c + 1);

  const value = useMemo<VeriChatState>(
    () => ({
      tree, treeLoading, composerMode, setComposerMode,
      activeTaskId, activeConversationId, openTask, openConversation, closeThread,
      rightPanelView, setRightPanelView, aiThreadId, refreshCounter, bumpRefresh,
      activeAiThreadId, aiThreads, switchAiThread, createNewAiThread,
    }),
    [tree, treeLoading, composerMode, activeTaskId, activeConversationId, rightPanelView, aiThreadId, refreshCounter, activeAiThreadId, aiThreads]
  );

  return <VeriChatContext.Provider value={value}>{children}</VeriChatContext.Provider>;
}

export function useVeriChat() {
  const ctx = useContext(VeriChatContext);
  if (!ctx) throw new Error("useVeriChat must be used within VeriChatProvider");
  return ctx;
}

// D5.B6 (persistent visibility panel): VeriChatProvider only mounts for
// veriChatV2Enabled orgs (AppShell.tsx), but the visibility panel is meant
// to render in the chrome for every org. A null-safe accessor lets that
// panel read activeTaskId when the provider happens to be present and fall
// back to a neutral "no task in context" state everywhere else, instead of
// either crashing (useVeriChat's throw) or forcing every org onto the
// VeriChatProvider tree just to support one unrelated panel.
export function useVeriChatOptional() {
  return useContext(VeriChatContext);
}
