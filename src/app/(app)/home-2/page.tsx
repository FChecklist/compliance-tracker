"use client";

// force-dynamic: same rationale as every other client-only (app) page --
// prevents static prerender + the CDN-cache-bypasses-middleware gap.
export const dynamic = "force-dynamic";

// Home 2 (demo UX concept, 2026-07-06): a single minimalist, pastel screen
// that merges Home + VERI AI + VERI Chat around one idea -- VERIDIAN is your
// assistant, and it is already working for you. The whole layout is designed
// to break change-resistance: instead of "here's another dashboard to learn,"
// it opens with the assistant greeting the user by name, visibly reviewing
// their workspace ("someone is working for me"), then reporting back like a
// capable worker briefing their boss, and inviting a plain-language reply.
// Reuses the exact same conversations/messages + document-attachment plumbing
// as /veri-ai, so every message here is a real message to the real VERI AI
// thread -- nothing is faked.
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Send, Loader2, Paperclip, Sparkles, ArrowRight } from "lucide-react";
import { MessageContent } from "@/components/chat/MessageContent";
import { useAutoGrowTextarea } from "@/lib/use-autogrow-textarea";
import { cn } from "@/lib/utils";

type AiMessage = { id: string; senderId: string | null; content: string; createdAt: string };
type Stats = { total: number; overdue: number; dueThisWeek: number; completed: number; dueIn30Days?: number; safe?: number };

const POLL_MS = 6000;

// The visible "I'm working for you" sequence shown on first load. Each line is
// something a real assistant would actually be doing on the user's behalf --
// the point is the human *sees* work happening before the briefing lands.
const WORKING_STEPS = [
  "Looking over everything for you…",
  "Checking what's due and what's overdue…",
  "Pulling together what needs your attention…",
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function Home2Page() {
  const [firstName, setFirstName] = useState<string>("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);

  // The "working" reveal: cycles the steps above, then shows the briefing.
  const [workingStep, setWorkingStep] = useState(0);
  const [briefingReady, setBriefingReady] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useAutoGrowTextarea(content, 180);

  // Load who the user is + their real numbers + their AI thread.
  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => {
      if (d?.name) setFirstName(String(d.name).split(" ")[0]);
    }).catch(() => {});
    fetch("/api/compliance/stats").then((r) => r.json()).then(setStats).catch(() => {});
    fetch("/api/conversations").then((r) => r.json()).then((d) => {
      const ai = (d?.conversations ?? []).find((c: { id: string; isAiThread: boolean }) => c.isAiThread);
      if (ai) setConversationId(ai.id);
    }).catch(() => {});
  }, []);

  // Run the working animation once. Deliberately paced (~0.8s/step) so it reads
  // as genuine effort, not a fake spinner -- then reveals the briefing.
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      if (i >= WORKING_STEPS.length) {
        clearInterval(t);
        setBriefingReady(true);
      } else {
        setWorkingStep(i);
      }
    }, 850);
    return () => clearInterval(t);
  }, []);

  const loadMessages = useCallback((id: string) => {
    fetch(`/api/conversations/${id}/messages`).then((r) => r.json())
      .then((d) => setMessages(d.messages ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    loadMessages(conversationId);
    const interval = setInterval(() => loadMessages(conversationId), POLL_MS);
    return () => clearInterval(interval);
  }, [conversationId, loadMessages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  async function send(text?: string) {
    const trimmed = (text ?? content).trim();
    if (!trimmed || sending || !conversationId) return;
    setSending(true);
    try {
      await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      setContent("");
      loadMessages(conversationId);
    } finally { setSending(false); }
  }

  async function handleFile(file: File) {
    if (!conversationId || attaching) return;
    setAttaching(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const up = await fetch("/api/documents", { method: "POST", body: form });
      if (!up.ok) return;
      const doc = await up.json();
      await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() || `Here's a document for you: ${doc.name}` }),
      });
      setContent("");
      loadMessages(conversationId);
    } finally { setAttaching(false); }
  }

  const overdue = stats?.overdue ?? 0;
  const dueSoon = stats?.dueIn30Days ?? stats?.dueThisWeek ?? 0;
  const safe = stats?.safe ?? stats?.completed ?? 0;

  // The briefing, phrased as the assistant reporting to the user (their boss).
  const briefingLine = overdue > 0
    ? `I've gone through everything. ${overdue} ${overdue === 1 ? "thing needs" : "things need"} your attention — I've flagged them for you. The rest is on track, and I'm keeping an eye on it.`
    : `I've gone through everything and you're in good shape — nothing overdue. I'll keep watch and let you know the moment anything needs you.`;

  const suggestions = [
    "What should I focus on today?",
    "Show me what's overdue",
    "Summarise this week for me",
    "Draft a reply to my latest notice",
  ];

  return (
    <div className="min-h-full bg-gradient-to-b from-[#FFFBF5] via-white to-[#FBF7FF]">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        {/* Assistant greeting */}
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-ct-saffron/90 to-[#F5A623] text-white shadow-sm">
            <Sparkles className="size-5" />
          </div>
          <div className="pt-0.5">
            <h1 className="font-heading text-2xl text-ct-navy tracking-tight">
              {greeting()}{firstName ? `, ${firstName}` : ""}.
            </h1>
            <p className="text-sm text-ct-muted mt-0.5">I&apos;m VERIDIAN, your AI assistant. Here&apos;s where things stand.</p>
          </div>
        </div>

        {/* Working -> briefing card */}
        <div className="mt-6 rounded-2xl border border-ct-border bg-white/70 backdrop-blur px-5 py-4 shadow-sm">
          {!briefingReady ? (
            <div className="flex items-center gap-3 text-sm text-ct-slate">
              <Loader2 className="size-4 animate-spin text-ct-saffron" />
              <span className="transition-opacity">{WORKING_STEPS[workingStep]}</span>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[15px] leading-relaxed text-ct-navy">{briefingLine}</p>
              <div className="flex flex-wrap gap-2">
                <Link href="/compliance?status=overdue" className="group inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                  {overdue} needs you <ArrowRight className="size-3 opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                </Link>
                <Link href="/compliance" className="group inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors">
                  {dueSoon} coming up <ArrowRight className="size-3 opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                </Link>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {safe} on track
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Composer -- the one place you talk to VERIDIAN */}
        <div className="mt-6 rounded-2xl border border-ct-border bg-white shadow-sm px-4 pt-3 pb-2.5">
          <textarea
            ref={textareaRef}
            rows={1}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Tell your AI Assistant what to do…"
            className="w-full bg-transparent text-[15px] text-ct-navy placeholder:text-ct-muted focus:outline-none resize-none max-h-[180px] overflow-y-auto"
          />
          <div className="flex items-center justify-between mt-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={attaching || !conversationId}
              title="Attach a document"
              className="grid size-8 place-items-center rounded-lg text-ct-muted hover:bg-ct-cloud hover:text-ct-slate transition-colors disabled:opacity-50"
            >
              {attaching ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={sending || !content.trim()}
              className="grid size-8 place-items-center rounded-lg bg-ct-saffron text-white hover:bg-ct-saffron-hover disabled:opacity-50 transition-colors"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        </div>

        {/* Gentle nudges -- how a helpful assistant offers to start */}
        {messages.length === 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                disabled={sending || !conversationId}
                className="rounded-full border border-ct-border bg-white/60 px-3.5 py-1.5 text-[13px] text-ct-slate hover:border-ct-saffron/40 hover:text-ct-navy transition-colors disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* The ongoing conversation -- so it feels like a relationship, not a form */}
        {messages.length > 0 && (
          <div className="mt-8 space-y-4">
            {messages.slice(-12).map((m) => {
              const isAi = m.senderId === null;
              return (
                <div key={m.id} className={cn("flex gap-3", isAi ? "" : "flex-row-reverse")}>
                  <div className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-xl text-white text-xs font-bold",
                    isAi ? "bg-gradient-to-br from-ct-saffron/90 to-[#F5A623]" : "bg-ct-navy"
                  )}>
                    {isAi ? <Sparkles className="size-4" /> : (firstName?.[0] ?? "You")}
                  </div>
                  <div className={cn(
                    "rounded-2xl px-4 py-2.5 max-w-[80%] text-[14px] leading-relaxed",
                    isAi ? "bg-white border border-ct-border text-ct-navy" : "bg-ct-navy text-white"
                  )}>
                    {isAi ? <MessageContent content={m.content} /> : m.content}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}

        <p className="mt-10 text-center text-[11px] text-ct-muted/70">
          VERIDIAN is working in the background across your whole business — Finance, People, Operations, Sales, and Governance.
        </p>
      </div>
    </div>
  );
}
