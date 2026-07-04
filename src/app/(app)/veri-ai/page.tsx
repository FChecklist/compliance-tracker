"use client";

// force-dynamic: prevents static prerendering (and the CDN-cache-bypasses-
// middleware gap confirmed live in Wave 29-31 -- see orchestra_changes.md
// #79). Every new client-only page in (app)/ gets this proactively now.
export const dynamic = "force-dynamic";

// Wave 37 (VERI Chat Intelligence Engine, PLATFORM_STRATEGY.md §18): VERI
// AI's own dedicated surface, split out of the generic VERI Chat
// conversation list where it used to be just one pinned row. Same
// underlying conversations/messages tables and the same MessageContent
// renderer as VERI Chat (src/components/chat) -- "nearly identical
// features, only the way it's used differs," per the user's framing.
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Bot, Send, Loader2, RotateCcw, Paperclip, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageContent } from "@/components/chat/MessageContent";
import { useAutoGrowTextarea } from "@/lib/use-autogrow-textarea";
import { cn } from "@/lib/utils";

const POLL_MS = 6000;

type AiMessage = { id: string; senderId: string | null; content: string; createdAt: string };

export default function VeriAiPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useAutoGrowTextarea(content, 200);

  const loadMessages = useCallback((convoId: string) => {
    fetch(`/api/conversations/${convoId}/messages`)
      .then((r) => r.json())
      .then((data) => setMessages(data.messages ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => {
        const aiThread = (data.conversations ?? []).find((c: { id: string; isAiThread: boolean }) => c.isAiThread);
        if (aiThread) {
          setConversationId(aiThread.id);
          fetch(`/api/conversations/${aiThread.id}/read`, { method: "PATCH" }).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    loadMessages(conversationId);
    const interval = setInterval(() => loadMessages(conversationId), POLL_MS);
    return () => clearInterval(interval);
  }, [conversationId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(overrideContent?: string): Promise<string | null> {
    if (!conversationId) return null;
    const trimmed = (overrideContent ?? content).trim();
    if (!trimmed) return null;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      setContent("");
      loadMessages(conversationId);
      return data.message?.id ?? null;
    } finally {
      setSending(false);
    }
  }

  async function regenerate() {
    if (!conversationId || regenerating) return;
    setRegenerating(true);
    try {
      await fetch(`/api/conversations/${conversationId}/regenerate`, { method: "POST" });
      loadMessages(conversationId);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleFilePicked(file: File) {
    if (!conversationId || attaching) return;
    setAttaching(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await fetch("/api/documents", { method: "POST", body: form });
      if (!uploadRes.ok) return;
      const doc = await uploadRes.json();

      const messageId = await send(content.trim() || `Shared a document: ${doc.name}`);
      if (messageId) {
        await fetch(`/api/veri-chat/messages/${messageId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: doc.id }),
        }).catch(() => {});
      }
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const lastMessage = messages[messages.length - 1];
  const canRegenerate = lastMessage && lastMessage.senderId === null && !sending;

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bot className="size-5 text-ct-saffron" />
          <h1 className="font-heading text-xl text-ct-navy">VERI AI</h1>
        </div>
        {/* Wave 42 (VERI FDE, PLATFORM_STRATEGY.md §23): VERI AI is where a
            user already talks to the system -- "I want this functionality"
            requests are routed to VERI FDE's own page rather than a second
            conversational entry point invented inside this one. */}
        <Link href="/fde">
          <Button size="sm" variant="outline">
            <Sparkles className="size-3.5 mr-1.5" /> Request a capability
          </Button>
        </Link>
      </div>

      <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-ct-border bg-white overflow-hidden">
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-ct-muted">Ask VERIDIAN AI anything about your compliance workspace.</p>
          ) : (
            messages.map((m) => <AiMessageBubble key={m.id} message={m} />)
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-ct-border p-3 space-y-2">
          {canRegenerate && (
            <Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating}>
              {regenerating ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <RotateCcw className="size-3.5 mr-1" />}
              Regenerate
            </Button>
          )}
          <div className="flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFilePicked(e.target.files[0])}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="shrink-0"
              disabled={attaching || !conversationId}
              onClick={() => fileInputRef.current?.click()}
              title="Attach a document for VERI AI to read"
            >
              {attaching ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
            </Button>
            <Textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Message VERI AI..."
              rows={1}
              className="min-h-[44px] max-h-[200px] resize-none text-sm overflow-y-auto"
            />
            <Button onClick={() => send()} disabled={sending || !content.trim()} size="icon" className="shrink-0">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AiMessageBubble({ message }: { message: AiMessage }) {
  const isAi = message.senderId === null;
  return (
    <div className={cn("flex my-1.5", isAi ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[80%] rounded-xl px-3.5 py-2 relative",
          isAi ? "bg-ct-teal/10 border border-ct-teal/30 text-ct-navy" : "bg-ct-navy text-white"
        )}
      >
        {isAi && (
          <div className="flex items-center gap-1 mb-1">
            <Bot className="size-3.5 text-ct-teal" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-ct-teal">VERI AI</span>
          </div>
        )}
        <MessageContent content={message.content} />
      </div>
    </div>
  );
}
