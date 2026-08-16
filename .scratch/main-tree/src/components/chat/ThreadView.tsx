"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAutoGrowTextarea } from "@/lib/use-autogrow-textarea";
import { cn } from "@/lib/utils";
import { MismatchBubble, type MismatchInfo } from "./MismatchBubble";
import { MessageContent } from "./MessageContent";

type ChatMessage = {
  id: string;
  senderId: string | null;
  content: string;
  isInstruction: boolean;
  createdAt: string;
  isGuestMessage?: boolean;
  guestName?: string | null;
  commitment: { status: string; assigneeId: string; dueDate: string | null } | null;
  mismatch: MismatchInfo | null;
  // REVIEW-FRAMEWORK-WAVE4 (AI Interaction Efficiency, "AI Confidence Score"
  // / "Communicates AI Limitations Honestly"): honest heuristic proxy from
  // floor-tier-escalation.ts's hedging-detection signal, null for every
  // non-AI message and every AI message from before this change.
  confidenceLabel?: "high" | "medium" | "low" | null;
};

type ConversationSummary = {
  id: string;
  isAiThread: boolean;
  title: string | null;
  otherParticipants: { id: string; name: string }[];
};

const POLL_MS = 6000;

// Phase 2 (VERIDIAN.docx Study 30.3/32.9 "AI Thinking" pattern): an explicit
// alternative to a plain spinner -- VERI narrates what it's doing while the
// user waits for a reply. Rotated through every ~1.2s by the effect below.
const THINKING_PHASES = [
  "VERI is understanding...",
  "Building context...",
  "Preparing a reply...",
];

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
  const textareaRef = useAutoGrowTextarea(content, 200);
  const [isInstruction, setIsInstruction] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [sending, setSending] = useState(false);
  const [thinkingPhase, setThinkingPhase] = useState(0);
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

  // Phase 2: rotate the "VERI is thinking" phase text while we wait for an
  // AI reply. Only active in AI threads, and only while a send is in flight.
  const showThinking = sending && conversation.isAiThread;
  useEffect(() => {
    if (!showThinking) {
      setThinkingPhase(0);
      return;
    }
    const id = setInterval(() => {
      setThinkingPhase((p) => (p + 1) % THINKING_PHASES.length);
    }, 1200);
    return () => clearInterval(id);
  }, [showThinking]);

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
  const title = conversation.isAiThread ? "VERI" : conversation.title || otherName || "Conversation";

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
        {showThinking && (
          <div className="flex justify-start my-1.5">
            <div className="flex items-center gap-1.5 rounded-xl border border-ct-teal/30 bg-ct-teal/10 px-3.5 py-2">
              <Bot className="size-3.5 text-ct-teal" />
              <span className="text-xs text-ct-teal">{THINKING_PHASES[thinkingPhase]}</span>
            </div>
          </div>
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
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={isInstruction ? "Describe the instruction..." : "Type a message..."}
            rows={1}
            className="min-h-[44px] max-h-[200px] resize-none text-sm overflow-y-auto"
          />
          <Button onClick={send} disabled={sending || !content.trim()} size="icon" className="shrink-0">
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// REVIEW-FRAMEWORK-WAVE4: labeled honestly as a heuristic proxy (title
// tooltip), never presented as a calibrated model confidence score -- see
// floor-tier-escalation.ts's deriveConfidenceLabel() for what actually
// computes this.
const CONFIDENCE_BADGE: Record<"high" | "medium" | "low", { label: string; className: string }> = {
  high: { label: "High confidence", className: "bg-emerald-100 text-emerald-700" },
  medium: { label: "Medium confidence", className: "bg-amber-100 text-amber-700" },
  low: { label: "Low confidence", className: "bg-red-100 text-red-700" },
};

function MessageBubble({ message, currentUserId }: { message: ChatMessage; currentUserId: string }) {
  const isMe = message.senderId === currentUserId;
  // Wave 37: a guest-authored message also has senderId === null (same
  // convention as "the AI replied") -- guestAccessId/isGuestMessage is what
  // actually distinguishes the two, so this must be checked first.
  const isGuest = Boolean(message.isGuestMessage);
  const isAi = message.senderId === null && !isGuest;
  const confidenceBadge = isAi && message.confidenceLabel ? CONFIDENCE_BADGE[message.confidenceLabel] : null;

  return (
    <div className={cn("flex my-1.5", isMe ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-xl px-3.5 py-2 relative",
          isAi
            ? "bg-ct-teal/10 border border-ct-teal/30 text-ct-navy"
            : isGuest
              ? "bg-ct-saffron/10 border border-ct-saffron/30 text-ct-navy"
              : isMe
                ? "bg-ct-navy text-white"
                : "bg-ct-cloud text-ct-navy"
        )}
      >
        {isAi && (
          <div className="flex items-center gap-1.5 mb-1">
            <Bot className="size-3.5 text-ct-teal" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-ct-teal">VERI</span>
            {confidenceBadge && (
              <span
                className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", confidenceBadge.className)}
                title="A heuristic proxy from VERI's own reply, not a calibrated confidence score"
              >
                {confidenceBadge.label}
              </span>
            )}
          </div>
        )}
        {isGuest && (
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-ct-saffron">{message.guestName || "Guest"} (external)</span>
          </div>
        )}
        <MessageContent content={message.content} />
        {/* REVIEW-FRAMEWORK-WAVE4 ("Communicates AI Limitations Honestly" --
            was a governance/documentation practice only, never a verified
            end-user chat behavior). Fires only on a real low-confidence
            signal, not on every message -- an honest, specific disclosure
            rather than a blanket disclaimer nobody reads. */}
        {isAi && message.confidenceLabel === "low" && (
          <p className="mt-1.5 text-[11px] italic text-ct-muted border-t border-ct-teal/20 pt-1.5">
            VERI wasn&apos;t fully confident in this answer — worth double-checking before you rely on it.
          </p>
        )}
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
