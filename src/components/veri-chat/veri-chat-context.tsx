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
  createNewAiThread: (title?: string, workflowId?: string) => Promise<string | null>;
};

const VeriChatContext = createContext<VeriChatState | null>(null);

export function VeriChatProvider({ children }: { children: ReactNode }) {
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

  useEffect(() => {
    fetch("/api/capability-tree")
      .then((r) => r.json())
      .then((d) => setTree(d.nodes ?? []))
      .catch(() => setTree([]))
      .finally(() => setTreeLoading(false));
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

  const createNewAiThread = async (title?: string, workflowId?: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/conversations/workflow-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, workflowId }),
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
