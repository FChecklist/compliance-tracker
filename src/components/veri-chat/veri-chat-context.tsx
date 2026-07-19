"use client";

// Compliance-tracker's own thin wrapper around
// @fchecklist/veridian-ui-kit/context's createVeriChatContext() factory --
// the shared package owns the two-axis state machine (composerMode /
// activeView, task/conversation "what's open" tracking, capability-tree
// fetch-on-module-change), ported verbatim from what used to be this exact
// file. What stays real, product-side state here (per the package's own
// README scope boundary -- "multi-thread AI conversation switching... stays
// in each product's own service layer"): the AI-thread switcher
// (aiThreadId/activeAiThreadId/aiThreads/switchAiThread/createNewAiThread)
// and the wider rightPanelView union (this repo's real Meetings/Approvals/
// Voice tabs on top of the package's baseline Overview/Tasks/Chats/To Do).
// Composed as a second, inner context rather than forking the factory, so
// the shared state-machine logic itself (composerMode<->activeView
// interactions, task/conversation open/close) has exactly one
// implementation across every consuming product.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createVeriChatContext, FIXED_MODES } from "@fchecklist/veridian-ui-kit/context";
import type { CapabilityNode, CapabilityInputField, PathSegment } from "@fchecklist/veridian-ui-kit/context";

export type { CapabilityNode, CapabilityInputField, PathSegment };
export { FIXED_MODES };

// Priority 18a (VERI Chat second-screen unification): Meetings/Approvals/
// Voice are this repo's real extra panel tabs, layered on the package's
// baseline 4 exactly as its own types.ts documents products may do.
export type RightPanelView = "overview" | "tasks" | "chats" | "todo" | "meetings" | "approvals" | "voice";

// D5.B7: the first path segment IS the route's module, matching this app's
// flat src/app/(app)/<module>/... layout.
function moduleFromPathname(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment || undefined;
}

async function fetchCapabilityTree(moduleScope: string | undefined): Promise<CapabilityNode[]> {
  const url = moduleScope ? `/api/capability-tree?module=${encodeURIComponent(moduleScope)}` : "/api/capability-tree";
  const res = await fetch(url);
  const data = await res.json();
  return data.nodes ?? [];
}

const base = createVeriChatContext<RightPanelView>({
  fetchTree: fetchCapabilityTree,
  defaultView: "overview",
  defaultComposerMode: "tasks",
});

// Wave 148 (Phase4_Implementation_Plan.md, "multi-thread conversations"):
// aiThreadId is the singleton default thread; activeAiThreadId is what the
// composer actually sends to, defaulting to aiThreadId but switchable to any
// workflow thread the user opens/creates. Real business logic (which thread
// is "active", spinning up a new workflow thread) -- not a generic shell
// concern, so it lives here rather than in the shared factory.
type AiThreadSummary = { id: string; title: string | null; workflowId: string | null; isPrimary: boolean };

type AiThreadState = {
  aiThreadId: string | null;
  activeAiThreadId: string | null;
  aiThreads: AiThreadSummary[];
  switchAiThread: (id: string) => void;
  createNewAiThread: (
    title?: string,
    workflowId?: string,
    chainSelection?: { modePill: string; pathKeys: string[] },
    skippedChainSelector?: boolean
  ) => Promise<string | null>;
};

const AiThreadContext = createContext<AiThreadState | null>(null);

function AiThreadProvider({ children }: { children: ReactNode }) {
  const [aiThreadId, setAiThreadId] = useState<string | null>(null);
  const [activeAiThreadId, setActiveAiThreadId] = useState<string | null>(null);
  const [aiThreads, setAiThreads] = useState<AiThreadSummary[]>([]);

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((d) => {
        const all: { id: string; isAiThread: boolean; title: string | null; workflowId: string | null; isPrimary: boolean }[] = d?.conversations ?? [];
        const ai = all.filter((c) => c.isAiThread);
        setAiThreads(ai.map((c) => ({ id: c.id, title: c.title, workflowId: c.workflowId, isPrimary: c.isPrimary })));
        const primary = ai.find((c) => c.isPrimary) ?? ai[0];
        if (primary) {
          setAiThreadId(primary.id);
          setActiveAiThreadId(primary.id);
        }
      })
      .catch(() => {});
  }, []);

  const switchAiThread = (id: string) => setActiveAiThreadId(id);

  const createNewAiThread = async (
    title?: string, workflowId?: string, chainSelection?: { modePill: string; pathKeys: string[] }, skippedChainSelector?: boolean
  ): Promise<string | null> => {
    try {
      const res = await fetch("/api/conversations/workflow-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, workflowId,
          modePill: chainSelection?.modePill, pathKeys: chainSelection?.pathKeys,
          skippedChainSelector,
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

  const value = useMemo<AiThreadState>(
    () => ({ aiThreadId, activeAiThreadId, aiThreads, switchAiThread, createNewAiThread }),
    [aiThreadId, activeAiThreadId, aiThreads]
  );

  return <AiThreadContext.Provider value={value}>{children}</AiThreadContext.Provider>;
}

export function VeriChatProvider({ children }: { children: ReactNode }) {
  return (
    <base.VeriChatProvider>
      <AiThreadProvider>{children}</AiThreadProvider>
    </base.VeriChatProvider>
  );
}

export function useVeriChat() {
  const state = base.useVeriChat();
  const aiThread = useContext(AiThreadContext);
  if (!aiThread) throw new Error("useVeriChat must be used within VeriChatProvider");
  return {
    ...state,
    ...aiThread,
    // rightPanelView/setRightPanelView alias the base factory's generic
    // activeView/setActiveView -- kept under their original name here so
    // every existing call site (VeriComposer.tsx, VeriChatPanel.tsx) reads
    // unchanged.
    rightPanelView: state.activeView,
    setRightPanelView: state.setActiveView,
  };
}

// D5.B6 (persistent visibility panel): VeriChatProvider only mounts for
// veriChatV2Enabled orgs (AppShell.tsx), but the visibility panel is meant
// to render in the chrome for every org. A null-safe accessor lets that
// panel read activeTaskId when the provider happens to be present and fall
// back to a neutral "no task in context" state everywhere else, instead of
// either crashing (useVeriChat's throw) or forcing every org onto the
// VeriChatProvider tree just to support one unrelated panel.
export function useVeriChatOptional() {
  const state = base.useVeriChatOptional();
  const aiThread = useContext(AiThreadContext);
  if (!state || !aiThread) return null;
  return { ...state, ...aiThread, rightPanelView: state.activeView, setRightPanelView: state.setActiveView };
}
