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
import Stage0SignupForm from "@/components/Stage0SignupForm";

const POLL_MS = 5000;

type GuestMessage = { senderId: string | null; isGuestMessage: boolean; content: string; createdAt: string };
type GuestConversation = { title: string | null; guestName: string; ticketStatus: string | null; messages: GuestMessage[] };

export default function GuestChatPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<GuestConversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useAutoGrowTextarea(draft, 160);

  // Wave 81 (Customer Service enhancements): CSAT/NPS survey, shown once the
  // underlying ticket is resolved/closed -- reuses this same guest token
  // rather than a second invite mechanism.
  const [csatScore, setCsatScore] = useState<number | null>(null);
  const [surveyComment, setSurveyComment] = useState("");
  const [submittingSurvey, setSubmittingSurvey] = useState(false);
  const [surveySubmitted, setSurveySubmitted] = useState(false);

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

  async function submitSurvey() {
    if (csatScore == null) return;
    setSubmittingSurvey(true);
    try {
      const res = await fetch(`/api/guest-chat/${params.token}/survey`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csatScore, comment: surveyComment.trim() || undefined }),
      });
      if (res.ok) setSurveySubmitted(true);
    } finally {
      setSubmittingSurvey(false);
    }
  }

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
              {/* Priority 18b (Owner directive 2026-07-15): "Sign up free
                  (Stage 0)" CTA next to the guest's own read/write access --
                  the natural landing spot per the design doc, since a guest
                  already sees the org/conversation context before deciding. */}
              <Stage0SignupForm token={params.token} />
              {data?.messages.map((m, i) => (
                <div key={i} className={m.isGuestMessage ? "text-right" : "text-left"}>
                  <div className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.isGuestMessage ? "bg-ct-teal text-white" : "bg-ct-cloud text-ct-navy"}`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {(data?.ticketStatus === "resolved" || data?.ticketStatus === "closed") && (
                <div className="rounded-lg border border-ct-border bg-ct-cloud/50 p-3 space-y-2">
                  {surveySubmitted ? (
                    <p className="text-xs text-ct-teal font-medium">Thanks for your feedback!</p>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-ct-navy">How was your support experience?</p>
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            onClick={() => setCsatScore(n)}
                            className={`size-8 rounded-md text-sm font-medium ${csatScore === n ? "bg-ct-teal text-white" : "bg-white border border-ct-border text-ct-muted"}`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <input
                        value={surveyComment}
                        onChange={(e) => setSurveyComment(e.target.value)}
                        placeholder="Any additional comments (optional)"
                        className="w-full h-8 text-xs rounded-md border border-ct-border px-2"
                      />
                      <button
                        onClick={submitSurvey}
                        disabled={csatScore == null || submittingSurvey}
                        className="h-8 px-3 rounded-md bg-ct-saffron text-white text-xs font-medium disabled:opacity-50"
                      >
                        {submittingSurvey ? "Submitting..." : "Submit"}
                      </button>
                    </>
                  )}
                </div>
              )}
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
