"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { MismatchBubble, type MismatchInfo } from "./MismatchBubble";

type ChatMessage = {
  id: string;
  senderId: string | null;
  content: string;
  isInstruction: boolean;
  createdAt: string;
  commitment: { status: string; assigneeId: string; dueDate: string | null } | null;
  mismatch: MismatchInfo | null;
};

type ConversationSummary = {
  id: string;
  isAiThread: boolean;
  title: string | null;
  otherParticipants: { id: string; name: string }[];
};

const POLL_MS = 6000;

export function ThreadView({
  conversation, currentUserId, highlightMismatchId,
}: {
  conversation: ConversationSummary;
  currentUserId: string;
  highlightMismatchId?: string | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [isInstruction, setIsInstruction] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const hasScrolledToHighlight = useRef(false);

  function load() {
    fetch(`/api/conversations/${conversation.id}/messages`)
      .then((r) => r.json())
      .then((data) => setMessages(data.messages ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    fetch(`/api/conversations/${conversation.id}/read`, { method: "PATCH" }).catch(() => {});
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [conversation.id]);

  useEffect(() => {
    if (highlightMismatchId && !hasScrolledToHighlight.current && highlightRef.current) {
      hasScrolledToHighlight.current = true;
      highlightRef.current.scrollIntoView({ block: "center" });
      return;
    }
    if (!highlightMismatchId) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages.length, highlightMismatchId]);

  async function send() {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: trimmed,
          isInstruction: isInstruction || undefined,
          assigneeId: isInstruction ? conversation.otherParticipants[0]?.id : undefined,
          dueDate: isInstruction && dueDate ? dueDate : undefined,
        }),
      });
      if (res.ok) {
        setContent("");
        setIsInstruction(false);
        setDueDate("");
        await load();
      }
    } finally {
      setSending(false);
    }
  }

  const otherName = conversation.otherParticipants[0]?.name;
  const title = conversation.isAiThread ? "VERIDIAN AI" : conversation.title || otherName || "Conversation";

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-ct-border flex items-center gap-2">
        {conversation.isAiThread && <Bot className="size-4 text-ct-saffron" />}
        <h2 className="font-heading text-sm text-ct-navy">{title}</h2>
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        {loading ? (
          <p className="text-sm text-ct-muted">Loading...</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-ct-muted">No messages yet. Say hello.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} ref={m.mismatch?.id === highlightMismatchId ? highlightRef : undefined}>
              <MessageBubble message={m} currentUserId={currentUserId} />
              {m.mismatch && (
                <MismatchBubble
                  mismatch={m.mismatch}
                  onResolved={(updated) =>
                    setMessages((prev) => prev.map((mm) => (mm.id === m.id ? { ...mm, mismatch: updated } : mm)))
                  }
                />
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </ScrollArea>

      <div className="border-t border-ct-border p-3 space-y-2">
        {!conversation.isAiThread && conversation.otherParticipants.length > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-2 text-ct-slate">
              <Switch checked={isInstruction} onCheckedChange={setIsInstruction} />
              Assign as instruction {isInstruction && `to ${otherName}`}
            </label>
            {isInstruction && (
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-7 w-[150px] text-xs"
              />
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={isInstruction ? "Describe the instruction..." : "Type a message..."}
            className="min-h-[44px] max-h-[120px] resize-none text-sm"
          />
          <Button onClick={send} disabled={sending || !content.trim()} size="icon" className="shrink-0">
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message, currentUserId }: { message: ChatMessage; currentUserId: string }) {
  const isMe = message.senderId === currentUserId;
  const isAi = message.senderId === null;

  return (
    <div className={cn("flex my-1.5", isMe ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-xl px-3.5 py-2 text-sm relative",
          isAi
            ? "bg-ct-teal/10 border border-ct-teal/30 text-ct-navy"
            : isMe
              ? "bg-ct-navy text-white"
              : "bg-ct-cloud text-ct-navy"
        )}
      >
        {isAi && (
          <div className="flex items-center gap-1 mb-1">
            <Bot className="size-3.5 text-ct-teal" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-ct-teal">VERIDIAN AI</span>
          </div>
        )}
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        {message.isInstruction && message.commitment && (
          <span
            className={cn(
              "inline-block mt-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              message.commitment.status === "drifted"
                ? "bg-red-100 text-red-700"
                : message.commitment.status === "done_as_asked"
                  ? "bg-ct-teal/20 text-ct-teal"
                  : "bg-ct-saffron/20 text-ct-saffron"
            )}
          >
            Instruction · {message.commitment.status.replace(/_/g, " ")}
          </span>
        )}
      </div>
    </div>
  );
}
