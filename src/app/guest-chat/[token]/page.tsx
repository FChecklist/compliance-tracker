"use client";

// Intentionally outside (app)/ and outside middleware's protected-route
// allowlist -- the one write-capable public page in this codebase (Wave 36,
// PLATFORM_STRATEGY.md §17.8-17.9). Mirrors /shared/conversation/[token]'s
// pattern, extended with a reply form since a guest is meant to actually
// participate, not just read. Never move this under (app)/.
import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { Loader2, Send } from "lucide-react";
import { useAutoGrowTextarea } from "@/lib/use-autogrow-textarea";

const POLL_MS = 5000;

type GuestMessage = { senderId: string | null; isGuestMessage: boolean; content: string; createdAt: string };
type GuestConversation = { title: string | null; guestName: string; messages: GuestMessage[] };

export default function GuestChatPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<GuestConversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useAutoGrowTextarea(draft, 160);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/guest-chat/${params.token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "This guest link is invalid or has expired");
      } else {
        setData(await res.json());
        setError(null);
      }
    } catch {
      setError("This guest link is invalid or has expired");
    } finally {
      setLoading(false);
    }
  }, [params.token]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages.length]);

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/guest-chat/${params.token}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setDraft("");
        await load();
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-ct-cream flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-ct-border bg-white shadow-card overflow-hidden flex flex-col h-[80vh]">
        <div className="bg-gradient-navy px-5 py-4 flex items-center gap-3">
          <Image src="/logo-mark.svg" alt="VERIDIAN AI" width={28} height={28} unoptimized />
          <div>
            <p className="text-white text-sm font-semibold">{data?.title || "Guest Conversation"}</p>
            <p className="text-white/60 text-[11px]">
              {data ? `You're joining as ${data.guestName}` : "Invited via VERI Chat guest access"}
            </p>
          </div>
        </div>
        <div className="flex-1 min-h-0 p-5 space-y-3 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : error ? (
            <p className="text-sm text-ct-error">{error}</p>
          ) : (
            <>
              {data?.messages.map((m, i) => (
                <div key={i} className={m.isGuestMessage ? "text-right" : "text-left"}>
                  <div className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.isGuestMessage ? "bg-ct-teal text-white" : "bg-ct-cloud text-ct-navy"}`}>
                    {m.content}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>
        {!error && !loading && (
          <div className="border-t border-ct-border p-3 flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type a message..."
              rows={1}
              className="flex-1 min-h-[36px] max-h-[160px] py-2 px-3 rounded-lg border border-ct-border text-sm resize-none overflow-y-auto"
            />
            <button
              onClick={send}
              disabled={!draft.trim() || sending}
              className="h-9 w-9 flex items-center justify-center rounded-lg bg-ct-teal text-white disabled:opacity-50"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
