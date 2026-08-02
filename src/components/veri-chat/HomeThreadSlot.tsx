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

type RawMessage = { id: string; senderId: string | null; content: string; createdAt: string };

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
    setMessages(raw.map((m) => ({ id: m.id, isUser: m.senderId !== null, content: m.content, createdAt: m.createdAt })));
    return true;
  }, 6000);

  if (!threadId) return null;
  return (
    <div className="max-w-3xl mx-auto px-6">
      <ThreadView messages={messages} assistantLabel="V" emptyHint="Tell your AI Assistant what to do below." />
    </div>
  );
}
