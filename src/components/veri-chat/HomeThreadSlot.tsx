"use client";

// AppShellFrame's `homeThreadSlot` -- the inline AI-assistant conversation
// shown on /home in place of the right panel (the mockup's actual merge
// idea: on Home, VERI Chat isn't a side panel, it's the center of the
// page). Real, confirmed drift closed here: before this migration, /home
// for veriChatV2Enabled orgs rendered a composer with no visible thread at
// all -- VeriChatPanel was (correctly) hidden there, but nothing replaced
// it, so a returning user couldn't see their own conversation history.
// Reuses the same /api/conversations/:id/messages endpoint the legacy
// (pre-veriChatV2) Home page and VeriChatPanel's own ConvoThread already
// poll -- no new backend.
import { useState } from "react";
import { ThreadView, type ThreadMessage } from "@fchecklist/veridian-ui-kit/panel";
import { useVeriChat } from "./veri-chat-context";
import { useResilientPoll } from "@/lib/use-resilient-poll";

export type RawMessage = {
  id: string;
  senderId: string | null;
  content: string;
  createdAt: string;
  confidenceLabel: "high" | "medium" | "low" | null;
};

// GAP-VERI-CHAT-NO-VISIBLE-DETERMINISTIC-VS-AI-SIGNAL: the shared
// ThreadView (@fchecklist/veridian-ui-kit/panel) has no per-message
// metadata slot to render a badge into, and extending it would mean a
// cross-repo package release just for this one surface -- so the signal is
// folded into `content` as its own leading line instead. `confidenceLabel`
// is set if and only if a real LLM call produced this reply
// (deriveConfidenceLabel in floor-tier-escalation.ts always returns a
// non-null label for a genuine AI reply, and is never called for a
// deterministic/scripted/gated reply) -- reused here only for that
// null-vs-non-null presence check, not for its high/medium/low value, so
// this does not inherit GAP-VERI-CHAT-CONFIDENCE-LABEL-NO-REFUSAL-DETECTION's
// separate tier-accuracy issue.
export function withSourceTypeLabel(m: RawMessage): string {
  if (m.senderId !== null) return m.content; // the org's own user, never labeled
  return m.confidenceLabel !== null ? `✨ AI-generated reply\n${m.content}` : m.content;
}

export default function HomeThreadSlot() {
  const { aiThreadId, activeAiThreadId } = useVeriChat();
  const threadId = activeAiThreadId ?? aiThreadId;
  const [messages, setMessages] = useState<ThreadMessage[]>([]);

  useResilientPoll(async () => {
    if (!threadId) return true;
    const res = await fetch(`/api/conversations/${threadId}/messages`);
    if (!res.ok) return false;
    const data = await res.json();
    const raw: RawMessage[] = data.messages ?? [];
    setMessages(
      raw.map((m) => ({
        id: m.id,
        isUser: m.senderId !== null,
        content: withSourceTypeLabel(m),
        createdAt: m.createdAt,
      }))
    );
    return true;
  }, 6000);

  if (!threadId) return null;
  return (
    <div className="max-w-3xl mx-auto px-6">
      <ThreadView messages={messages} assistantLabel="V" emptyHint="Tell your AI Assistant what to do below." />
    </div>
  );
}
