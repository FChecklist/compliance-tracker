"use client";

// force-dynamic: same rationale as every other client-only (app) page --
// prevents static prerender + the CDN-cache-bypasses-middleware gap.
export const dynamic = "force-dynamic";

// Home 2 (demo UX concept, 2026-07-06): a single minimalist, pastel screen
// that merges Home + VERI AI + VERI Chat around one idea -- VERIDIAN is your
// assistant, and it is already working for you. Two resizable columns (drag
// the divider, Claude-Desktop-style, widths persisted): the assistant on the
// left/centre, your people (VERI Chat) on the right. The whole layout is
// designed to break change-resistance: instead of "here's another dashboard
// to learn," it opens with the assistant greeting the user by name, visibly
// reviewing their workspace, then reporting back like a capable worker
// briefing their boss, and inviting a plain-language reply. Reuses the exact
// same conversations/messages + document-attachment plumbing as /veri-ai, so
// every message here is a real message to the real thread -- nothing faked.
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Send, Loader2, Paperclip, Sparkles, ArrowRight, MessageSquare } from "lucide-react";
import { MessageContent } from "@/components/chat/MessageContent";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useAutoGrowTextarea } from "@/lib/use-autogrow-textarea";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/queries/use-me";
import { useComplianceStats } from "@/lib/queries/use-compliance-stats";
// AchievementCard was built in an earlier session wave but never wired into
// any render tree — rendered here on the home page alongside the briefing
// stats so users see their compliance progress at a glance.
import AchievementCard from "@/components/home/AchievementCard";
// Wave 113 (VERI Treasure): points/streaks teaser, placed next to
// AchievementCard so both at-a-glance cards sit together.
import VeriTreasureWidget from "@/components/home/VeriTreasureWidget";

type AiMessage = { id: string; senderId: string | null; content: string; createdAt: string };
type Conversation = {
  id: string;
  isAiThread: boolean;
  title: string | null;
  otherParticipants: { id: string; name: string }[];
  lastMessage: { content: string; createdAt: string; senderId: string | null } | null;
  unreadCount: number;
};

const POLL_MS = 6000;

const WORKING_STEPS = [
  "Looking over everything for you…",
  "Checking what's due and what's overdue…",
  "Pulling together what needs your attention…",
];

// Day one (first-minute experience, 2026-07-06): a brand-new org has nothing
// due or overdue, so the compliance-scan language above would ring hollow.
// For a first run the assistant narrates its own onboarding instead — the
// same promise the landing page sells ("50+ modules, run by your assistant").
const FIRST_RUN_STEPS = [
  "Setting up your workspace…",
  "Switching on your 50+ modules…",
  "Your assistant is reporting for duty…",
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function convoName(c: Conversation): string {
  if (c.title) return c.title;
  if (c.otherParticipants.length) return c.otherParticipants.map((p) => p.name).join(", ");
  return "Conversation";
}

export default function HomePage() {
  // Shared react-query cache -- previously its own /api/me and
  // /api/compliance/stats fetch-on-mount here, duplicating the same
  // requests AppShell, AppTopbar, HealthRibbon and AchievementCard were
  // independently making too.
  const { data: me } = useMe();
  const firstName = me?.name ? String(me.name).split(" ")[0] : "";
  // veriChatV2Enabled orgs get the persistent global composer (AppShell) +
  // independent VERI Chat panel everywhere, Home included -- this page's
  // own bespoke two-column assistant/chat layout below is only rendered for
  // orgs still on the previous flow, so the two composers never double up.
  const veriChatV2Enabled = Boolean(me?.veriChatV2Enabled);

  const { data: stats, isError: statsError } = useComplianceStats();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);

  const [workingStep, setWorkingStep] = useState(0);
  const [briefingReady, setBriefingReady] = useState(false);
  const [messagesLoaded, setMessagesLoaded] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useAutoGrowTextarea(content, 180);

  useEffect(() => {
    fetch("/api/conversations").then((r) => r.json()).then((d) => {
      const all: Conversation[] = d?.conversations ?? [];
      const ai = all.find((c) => c.isAiThread);
      if (ai) setConversationId(ai.id);
      setChats(all.filter((c) => !c.isAiThread));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      if (i >= WORKING_STEPS.length) { clearInterval(t); setBriefingReady(true); }
      else setWorkingStep(i);
    }, 850);
    return () => clearInterval(t);
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/conversations/${id}/messages`);
      if (!r.ok) return false;
      const d = await r.json();
      setMessages(d.messages ?? []);
      setMessagesLoaded(true);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Wave 146 gap-closure fix: this used to be loadMessages(id) +
  // setInterval(..., POLL_MS) with no in-flight guard and no backoff --
  // during a backend outage it kept firing a new request every 6s
  // regardless of whether the previous one had resolved. Now each poll
  // waits for the previous to settle and backs off (capped) on repeated
  // failures, recovering to the normal 6s cadence the moment a call
  // succeeds -- same pattern as AppShell.tsx's chat poll.
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let delay = POLL_MS;

    async function tick() {
      if (cancelled) return;
      const ok = await loadMessages(conversationId!);
      if (cancelled) return;
      delay = ok ? POLL_MS : Math.min(delay * 2, 120_000);
      timer = setTimeout(tick, delay);
    }

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
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
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() || `Here's a document for you: ${doc.name}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.message?.id) {
        await fetch(`/api/veri-chat/messages/${data.message.id}/attachments`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: doc.id }),
        }).catch(() => {});
      }
      setContent("");
      loadMessages(conversationId);
    } finally { setAttaching(false); }
  }

  const overdue = stats?.overdue ?? 0;
  const dueSoon = stats?.dueIn30Days ?? stats?.dueThisWeek ?? 0;
  const safe = stats?.safe ?? stats?.completed ?? 0;

  // First-minute experience: a brand-new user has an empty org and only the
  // seeded welcome message (senderId null) in their thread. For them the
  // whole screen speaks day-one language — the assistant introduces itself
  // and offers first tasks — instead of a compliance briefing full of zeros.
  const firstRun =
    messagesLoaded &&
    messages.length <= 1 &&
    messages.every((m) => m.senderId === null) &&
    stats !== undefined &&
    stats.total === 0;

  // Wave 111 finding: a failed /api/compliance/stats fetch used to leave
  // `stats` null, which fed the exact same `overdue ?? 0` path as a genuine
  // zero-overdue org -- silently telling the user "you're in good shape"
  // when the system had actually failed to check. In a compliance product
  // that false reassurance is worse than no answer at all, so a fetch
  // failure now gets its own honest, distinct message instead.
  const briefingLine = statsError
    ? `I couldn't check what's overdue just now — the connection dropped partway through. I don't want to tell you "you're all clear" without actually knowing, so please refresh in a moment.`
    : firstRun
      ? `All set — your complete office is live. Finance, sales, CRM, HR, operations, compliance: one system, and I run it for you. Tell me what you need in plain words, or pick something below to see me work.`
      : overdue > 0
        ? `I've gone through everything. ${overdue} ${overdue === 1 ? "thing needs" : "things need"} your attention — I've flagged them for you. The rest is on track, and I'm keeping an eye on it.`
        : `I've gone through everything and you're in good shape — nothing overdue. I'll keep watch and let you know the moment anything needs you.`;

  const suggestions = firstRun
    ? [
        "Give me a 2-minute tour",
        "What can you take off my plate today?",
        "Add my first customer",
        "Help me raise my first invoice",
      ]
    : [
        "What should I focus on today?",
        "Show me what's overdue",
        "Summarise this week for me",
        "Draft a reply to my latest notice",
      ];

  // The AppShell-level VeriComposer + VeriChatPanel already provide the
  // composer/thread/chat-list experience for these orgs -- this page only
  // needs to contribute the greeting/briefing card above it, not its own
  // parallel composer.
  if (veriChatV2Enabled) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-ct-saffron/90 to-[#F5A623] text-white shadow-sm">
            <Sparkles className="size-5" />
          </div>
          <div className="pt-0.5">
            <h1 className="font-heading text-2xl text-ct-navy tracking-tight">
              {greeting()}{firstName ? `, ${firstName}` : ""}.
            </h1>
            <p className="text-sm text-ct-muted mt-0.5">I&apos;m VERI, your assistant — tell me what you need in VERI Chat below, and I&apos;ll do it for you.</p>
          </div>
        </div>
        {!statsError && stats && (
          <div className="mt-6 rounded-2xl border border-ct-border bg-white/70 backdrop-blur px-5 py-4 shadow-sm">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">{stats.overdue} needs you</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{stats.dueIn30Days ?? stats.dueThisWeek} coming up</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{stats.safe ?? stats.completed} on track</span>
            </div>
          </div>
        )}
        <div className="mt-4 space-y-3">
          <AchievementCard />
          <VeriTreasureWidget />
        </div>
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId="home2-panels"
      className="h-[calc(100vh-190px)] min-h-[540px] rounded-2xl border border-ct-border overflow-hidden bg-white"
    >
      {/* ── Assistant (centre) ─────────────────────────────────────────── */}
      <ResizablePanel defaultSize={64} minSize={42}>
        <div className="h-full overflow-y-auto bg-gradient-to-b from-[#FFFBF5] via-white to-[#FBF7FF]">
          <div className="mx-auto max-w-2xl px-6 py-8">
            {/* Greeting */}
            <div className="flex items-start gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-ct-saffron/90 to-[#F5A623] text-white shadow-sm">
                <Sparkles className="size-5" />
              </div>
              <div className="pt-0.5">
                <h1 className="font-heading text-2xl text-ct-navy tracking-tight">
                  {greeting()}{firstName ? `, ${firstName}` : ""}.
                </h1>
                <p className="text-sm text-ct-muted mt-0.5">I&apos;m VERI, your assistant — tell me what you need and I&apos;ll do it for you. Here&apos;s where things stand.</p>
              </div>
            </div>

            {/* Working -> briefing */}
            <div className="mt-6 rounded-2xl border border-ct-border bg-white/70 backdrop-blur px-5 py-4 shadow-sm">
              {!briefingReady ? (
                <div className="flex items-center gap-3 text-sm text-ct-slate">
                  <Loader2 className="size-4 animate-spin text-ct-saffron" />
                  <span>{(firstRun ? FIRST_RUN_STEPS : WORKING_STEPS)[workingStep]}</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[15px] leading-relaxed text-ct-navy">{briefingLine}</p>
                  {firstRun ? (
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        50+ modules live
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-ct-saffron/10 px-3 py-1 text-xs font-semibold text-ct-saffron">
                        <Sparkles className="size-3" /> Your assistant: on duty
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-ct-cloud px-3 py-1 text-xs font-semibold text-ct-slate">
                        You approve everything
                      </span>
                    </div>
                  ) : (
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
                  )}
                </div>
              )}
            </div>

            {/* AchievementCard: compliance progress card, placed here between
                the briefing stats and the composer so users see their
                completion rate at a glance before engaging with the assistant. */}
            <div className="mt-4 space-y-3">
              <AchievementCard />
              <VeriTreasureWidget />
            </div>

            {/* Composer */}
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
                  className="grid size-9 place-items-center rounded-lg text-ct-muted hover:bg-ct-cloud hover:text-ct-slate transition-colors disabled:opacity-50"
                >
                  {attaching ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-[18px]" />}
                </button>
                <input ref={fileInputRef} type="file" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
                <button
                  type="button"
                  onClick={() => send()}
                  disabled={sending || !content.trim()}
                  className="grid size-9 place-items-center rounded-lg bg-ct-saffron text-white hover:bg-ct-saffron-hover disabled:opacity-50 transition-colors"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-[18px]" />}
                </button>
              </div>
            </div>

            {/* Suggested openers — also shown on first run, where the only
                message is the assistant's seeded welcome and these chips are
                the user's first commands. */}
            {(messages.length === 0 || firstRun) && (
              <div className="mt-4 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} disabled={sending || !conversationId}
                    className="rounded-full border border-ct-border bg-white/60 px-3.5 py-1.5 text-[13px] text-ct-slate hover:border-ct-saffron/40 hover:text-ct-navy transition-colors disabled:opacity-50">
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Ongoing conversation */}
            {messages.length > 0 && (
              <div className="mt-8 space-y-4">
                {messages.slice(-12).map((m) => {
                  const isAi = m.senderId === null;
                  return (
                    <div key={m.id} className={cn("flex gap-3", isAi ? "" : "flex-row-reverse")}>
                      <div className={cn("grid size-8 shrink-0 place-items-center rounded-xl text-white text-xs font-bold",
                        isAi ? "bg-gradient-to-br from-ct-saffron/90 to-[#F5A623]" : "bg-ct-navy")}>
                        {isAi ? <Sparkles className="size-4" /> : (firstName?.[0] ?? "Y")}
                      </div>
                      <div className={cn("rounded-2xl px-4 py-2.5 max-w-[80%] text-[14px] leading-relaxed",
                        isAi ? "bg-white border border-ct-border text-ct-navy" : "bg-ct-navy text-white")}>
                        {isAi ? <MessageContent content={m.content} /> : m.content}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle className="bg-ct-border" />

      {/* ── VERI Chat (right) ──────────────────────────────────────────── */}
      <ResizablePanel defaultSize={36} minSize={22}>
        <div className="flex h-full flex-col bg-white">
          <div className="flex items-center justify-between border-b border-ct-border px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-ct-saffron" />
              <span className="font-heading text-[15px] text-ct-navy">VERI Chat</span>
            </div>
            <Link href="/chat" className="text-[11px] font-semibold text-ct-saffron hover:underline">Open all</Link>
          </div>
          <div className="flex-1 overflow-y-auto">
            {chats.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <MessageSquare className="mx-auto size-6 text-ct-muted/50" />
                <p className="mt-3 text-sm text-ct-muted">No team conversations yet.</p>
                <Link href="/chat" className="mt-2 inline-block text-[13px] font-semibold text-ct-saffron hover:underline">Start a chat →</Link>
              </div>
            ) : (
              chats.map((c) => (
                <Link key={c.id} href="/chat" className="flex items-start gap-3 px-4 py-3 border-b border-ct-border/60 hover:bg-ct-cream/60 transition-colors">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-ct-navy text-white text-xs font-bold">
                    {convoName(c).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-semibold text-ct-navy">{convoName(c)}</p>
                      {c.unreadCount > 0 && (
                        <span className="shrink-0 rounded-full bg-ct-saffron px-1.5 py-0.5 text-[10px] font-bold text-white">{c.unreadCount}</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-ct-muted mt-0.5">
                      {c.lastMessage?.content ?? "No messages yet"}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
