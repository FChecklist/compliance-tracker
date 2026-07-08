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

export type CapabilityInputField = { key: string; label: string; type: "number" | "text" };

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

  useEffect(() => {
    fetch("/api/capability-tree")
      .then((r) => r.json())
      .then((d) => setTree(d.nodes ?? []))
      .catch(() => setTree([]))
      .finally(() => setTreeLoading(false));
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((d) => {
        const ai = (d?.conversations ?? []).find((c: { isAiThread: boolean }) => c.isAiThread);
        if (ai) setAiThreadId(ai.id);
      })
      .catch(() => {});
  }, []);

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
    }),
    [tree, treeLoading, composerMode, activeTaskId, activeConversationId, rightPanelView, aiThreadId, refreshCounter]
  );

  return <VeriChatContext.Provider value={value}>{children}</VeriChatContext.Provider>;
}

export function useVeriChat() {
  const ctx = useContext(VeriChatContext);
  if (!ctx) throw new Error("useVeriChat must be used within VeriChatProvider");
  return ctx;
}
