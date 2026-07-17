"use client";

// Independent right-panel view -- its own view tabs, never driven by
// composerMode. Overview mixes real data across Tasks/Chats/To Do (and, as
// of Priority 18a, flagged email intelligence) so navigating to any page
// always lands on something genuinely useful, instead of whatever list
// happened to be active last. Tasks/Chats reuse the existing /api/tasks and
// /api/conversations endpoints; To Do reuses /api/veri-todo as-is (zero new
// backend for that view).
//
// Priority 18a (VERI Chat second-screen unification, control/CONTROLLER.yaml):
// added Meetings and Approvals tabs. Both reuse existing services end-to-end
// (veri-meeting-service.ts / approval-workflow-service.ts / communication-
// drafting-service.ts / erp-selling-service.ts / construction-change-order-
// service.ts) -- the only new backend is a thin read-only aggregator
// (/api/veri-chat/approvals) that normalizes 5 independently-built "waiting
// on a decision" mechanisms into one feed, plus one small cross-meeting query
// (listMyMeetingActionItems) that didn't exist before. Every actual decision
// still goes through each mechanism's own existing route -- this panel is a
// glance-and-act surface, not a rebuild of /veri-meetings or /approvals.
import { useEffect, useState } from "react";
import { Loader2, MessageSquare, CheckCircle2 } from "lucide-react";
import { MessageContent } from "@/components/chat/MessageContent";
import { toast } from "sonner";
import { useVeriChat } from "./veri-chat-context";

type TaskSummary = { id: string; title: string; description: string | null; status: string; createdAt: string };
type TaskDetail = TaskSummary & { chat: { id: string; role: string; content: string; createdAt: string }[] };
type ConvoSummary = { id: string; isAiThread: boolean; title: string | null; otherParticipants: { id: string; name: string }[]; lastMessage: { content: string; createdAt: string; senderId: string | null } | null; unreadCount: number };
type TodoItem = { id: string; source: string; title: string; status: string; dueDate: string | null; href: string };

type MeetingSummary = { id: string; title: string; meetingType: string; scheduledAt: string; status: string; systemId: string | null };
type MeetingActionItemSummary = { id: string; meetingId: string; meetingTitle: string; task: { id: string; title: string; status: string; dueDate: string | null } };
type MeetingDetail = MeetingSummary & {
  agenda: string[]; attendees: string[]; minutes: string | null;
  aiSummary: string | null; aiKeyDecisions: string[] | null;
  actionItems: { id: string; task: { id: string; title: string; status: string; dueDate: string | null } }[];
};

type ApprovalItem = {
  id: string; kind: "approval_request" | "workflow_step" | "drafted_communication" | "quotation" | "change_order";
  title: string; sub: string; createdAt: string;
  // change_order items come back with actionable: false -- their real
  // approval only happens via e-signature completion now (see
  // api/veri-chat/approvals/route.ts's own comment for why); this panel
  // must not offer a decision it can't actually enforce.
  actionable?: boolean;
};

type SuggestedWorkItem = { title: string; category: string; assignee: string | null; dueDateHint: string | null };
type VoiceMemoSummary = { id: string; status: string; transcript: string | null; createdAt: string };
type EmailItem = { id: string; subject: string; senderEmail: string | null; status: string; aiSummary: string | null; aiSuggestedWorkItems: SuggestedWorkItem[]; createdAt: string };

const STATUS_LABEL: Record<string, string> = { pending: "Pending", in_progress: "In progress", completed: "Done", failed: "Failed", cancelled: "Cancelled" };
const STATUS_COLOR: Record<string, string> = { pending: "text-amber-600", in_progress: "text-ct-saffron", completed: "text-emerald-600", failed: "text-red-600", cancelled: "text-ct-muted" };

function convoName(c: ConvoSummary): string {
  return c.title || c.otherParticipants.map((p) => p.name).join(", ") || "Conversation";
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || "Request failed");
  }
  return res.json();
}

export default function VeriChatPanel() {
  const { rightPanelView, setRightPanelView, activeTaskId, activeConversationId, openTask, openConversation, closeThread, refreshCounter, bumpRefresh } = useVeriChat();

  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [conversations, setConversations] = useState<ConvoSummary[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [meetingActionItems, setMeetingActionItems] = useState<MeetingActionItemSummary[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [voiceMemos, setVoiceMemos] = useState<VoiceMemoSummary[]>([]);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [convoMessages, setConvoMessages] = useState<{ id: string; senderId: string | null; content: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Local to this panel, unlike activeTaskId/activeConversationId -- those
  // live in veri-chat-context.tsx because VeriComposer's mode has to agree
  // with them. Meetings/email items are pure glance-and-act views with no
  // composer-mode counterpart, so they don't need to be shared state.
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [meetingDetail, setMeetingDetail] = useState<MeetingDetail | null>(null);
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/tasks").then((r) => r.json()).then((d) => setTasks(d.tasks ?? [])).catch(() => {}),
      fetch("/api/conversations").then((r) => r.json()).then((d) => setConversations((d.conversations ?? []).filter((c: ConvoSummary) => !c.isAiThread))).catch(() => {}),
      fetch("/api/veri-todo").then((r) => r.json()).then((d) => setTodos(d.items ?? [])).catch(() => {}),
      fetch("/api/veri-meetings").then((r) => r.json()).then((d) => setMeetings(d.meetings ?? [])).catch(() => {}),
      fetch("/api/veri-chat/meetings/action-items").then((r) => r.json()).then((d) => setMeetingActionItems(d.items ?? [])).catch(() => {}),
      fetch("/api/veri-chat/approvals").then((r) => r.json()).then((d) => setApprovals(d.items ?? [])).catch(() => {}),
      fetch("/api/veri-chat/voice-tickets").then((r) => r.json()).then((d) => setVoiceMemos(d.voiceMemos ?? [])).catch(() => {}),
      fetch("/api/email-intelligence").then((r) => r.json()).then((d) => setEmails((d.items ?? []).filter((e: EmailItem) => e.status === "proposed"))).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [refreshCounter]);

  useEffect(() => {
    if (!activeTaskId) { setTaskDetail(null); return; }
    fetch(`/api/tasks/${activeTaskId}`).then((r) => r.json()).then(setTaskDetail).catch(() => {});
  }, [activeTaskId, refreshCounter]);

  useEffect(() => {
    if (!activeConversationId) { setConvoMessages([]); return; }
    fetch(`/api/conversations/${activeConversationId}/messages`).then((r) => r.json()).then((d) => setConvoMessages(d.messages ?? [])).catch(() => {});
  }, [activeConversationId, refreshCounter]);

  useEffect(() => {
    if (!activeMeetingId) { setMeetingDetail(null); return; }
    fetch(`/api/veri-meetings/${activeMeetingId}`).then((r) => r.json()).then(setMeetingDetail).catch(() => {});
  }, [activeMeetingId, refreshCounter]);

  async function markTaskDone(id: string) {
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) throw new Error();
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: "completed" } : t)));
      if (taskDetail?.id === id) setTaskDetail({ ...taskDetail, status: "completed" });
    } catch {
      toast.error("Couldn't mark that task done — please try again");
    }
  }

  function closeAllThreads() {
    closeThread();
    setActiveMeetingId(null);
    setActiveEmailId(null);
  }

  function openTaskHere(id: string) { setActiveMeetingId(null); setActiveEmailId(null); openTask(id); }
  function openConvoHere(id: string) { setActiveMeetingId(null); setActiveEmailId(null); openConversation(id); }
  function openMeetingHere(id: string) { closeThread(); setActiveEmailId(null); setActiveMeetingId(id); }
  function openEmailHere(id: string) { closeThread(); setActiveMeetingId(null); setActiveEmailId(id); }

  // One decision handler for the 4 real approval sources -- each branch
  // calls that mechanism's own existing, unchanged route (see the header
  // note). change_order is deliberately NOT one of these branches anymore
  // (see ApprovalsList's own comment) -- this function is never called for
  // a non-actionable item, ApprovalsList doesn't render a decision control
  // for one.
  async function decideApproval(item: ApprovalItem, decision: "approve" | "reject") {
    try {
      if (item.kind === "approval_request") {
        const rejectionReason = decision === "reject" ? window.prompt("Reason for rejection:") : undefined;
        if (decision === "reject" && !rejectionReason?.trim()) return;
        const res = await fetch(`/api/approvals/${item.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, rejectionReason }),
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      } else if (item.kind === "workflow_step") {
        const comment = decision === "reject" ? window.prompt("Reason for rejection:") ?? undefined : undefined;
        await postJson(`/api/approval-workflows/steps/${item.id}/decide`, { decision: decision === "approve" ? "approved" : "rejected", comment });
      } else if (item.kind === "drafted_communication") {
        if (decision === "approve") {
          await postJson(`/api/drafted-communications/${item.id}/approve`, {});
        } else {
          const reason = window.prompt("Reason for rejection:");
          if (!reason?.trim()) return;
          await postJson(`/api/drafted-communications/${item.id}/reject`, { reason });
        }
      } else if (item.kind === "quotation") {
        const res = await fetch(`/api/v1/projexa/quotations/${item.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: decision === "approve" ? "approved" : "draft" }),
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      }
      setApprovals((prev) => prev.filter((a) => a.id !== item.id || a.kind !== item.kind));
      toast.success(decision === "approve" ? "Approved" : "Rejected");
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't process that decision");
    }
  }

  const waitingCount = tasks.filter((t) => t.status === "pending").length;
  const unreadChatCount = conversations.filter((c) => c.unreadCount > 0).length;
  const todoCount = todos.filter((t) => t.status !== "completed" && t.status !== "done_as_asked" && t.status !== "resolved").length;
  const meetingsAttentionCount = meetings.filter((m) => m.status !== "published").length + meetingActionItems.length;

  const activeTask = activeTaskId ? tasks.find((t) => t.id === activeTaskId) : null;
  const activeConvo = activeConversationId ? conversations.find((c) => c.id === activeConversationId) : null;
  const activeEmail = activeEmailId ? emails.find((e) => e.id === activeEmailId) : null;

  return (
    <aside className="border-l border-ct-border bg-white flex flex-col h-full">
      <div className="border-b border-ct-border px-4 py-3">
        <div className="flex items-center gap-2 mb-2.5">
          <MessageSquare className="size-4 text-ct-saffron" />
          <span className="font-heading text-[15px] text-ct-navy">VERI Chat</span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {([
            { key: "overview", label: "Overview", count: 0 },
            { key: "tasks", label: "Tasks", count: waitingCount },
            { key: "chats", label: "Chats", count: unreadChatCount },
            { key: "meetings", label: "Meetings", count: meetingsAttentionCount },
            { key: "approvals", label: "Approvals", count: approvals.length },
            { key: "voice", label: "Voice", count: 0 },
            { key: "todo", label: "To Do", count: todoCount },
          ] as const).map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => { closeAllThreads(); setRightPanelView(v.key); }}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${
                rightPanelView === v.key && !activeTaskId && !activeConversationId && !activeMeetingId && !activeEmailId ? "bg-amber-50 text-amber-800 border border-amber-200" : "text-ct-muted hover:bg-ct-cloud"
              }`}
            >
              {v.label}
              {v.count > 0 && <span className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9.5px] font-bold">{v.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid place-items-center h-32"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
        ) : activeTask ? (
          <TaskThread task={activeTask} detail={taskDetail} onBack={closeAllThreads} onMarkDone={markTaskDone} />
        ) : activeConvo ? (
          <ConvoThread convo={activeConvo} messages={convoMessages} onBack={closeAllThreads} />
        ) : activeMeetingId ? (
          <MeetingThread meetingId={activeMeetingId} detail={meetingDetail} onBack={closeAllThreads} onChanged={bumpRefresh} />
        ) : activeEmail ? (
          <EmailThread item={activeEmail} onBack={closeAllThreads} onChanged={bumpRefresh} />
        ) : rightPanelView === "tasks" ? (
          <TaskList tasks={tasks} onOpen={openTaskHere} onMarkDone={markTaskDone} />
        ) : rightPanelView === "chats" ? (
          <ChatList conversations={conversations} onOpen={openConvoHere} />
        ) : rightPanelView === "meetings" ? (
          <MeetingsList meetings={meetings} actionItems={meetingActionItems} onOpen={openMeetingHere} />
        ) : rightPanelView === "approvals" ? (
          <ApprovalsList approvals={approvals} onDecide={decideApproval} />
        ) : rightPanelView === "voice" ? (
          <VoiceList voiceMemos={voiceMemos} />
        ) : rightPanelView === "todo" ? (
          <TodoList todos={todos} />
        ) : (
          <Overview
            tasks={tasks} conversations={conversations} todos={todos} emails={emails}
            onOpenTask={openTaskHere} onOpenConvo={openConvoHere} onOpenEmail={openEmailHere}
            onGoToTodo={() => { closeAllThreads(); setRightPanelView("todo"); }}
          />
        )}
      </div>
    </aside>
  );
}

function TaskList({ tasks, onOpen, onMarkDone }: { tasks: TaskSummary[]; onOpen: (id: string) => void; onMarkDone: (id: string) => void }) {
  if (tasks.length === 0) return <EmptyState text="No tasks given to your assistant yet." />;
  return (
    <div>
      {tasks.map((t) => (
        <button key={t.id} type="button" onClick={() => onOpen(t.id)} className="block w-full text-left px-4 py-3 border-b border-ct-border/60 hover:bg-ct-cream/60 transition-colors">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-ct-navy truncate flex-1">{t.title}</span>
            <span className={`text-[11px] shrink-0 ${STATUS_COLOR[t.status] ?? "text-ct-muted"}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
            {t.status !== "completed" && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onMarkDone(t.id); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onMarkDone(t.id); } }}
                title="Mark done"
                className="grid place-items-center size-5 rounded-full border border-ct-border2 text-ct-muted hover:border-emerald-500 hover:text-emerald-600 shrink-0"
              >
                <CheckCircle2 className="size-3" />
              </span>
            )}
          </div>
          {t.description && <p className="truncate text-xs text-ct-muted mt-0.5">{t.description}</p>}
        </button>
      ))}
    </div>
  );
}

function ChatList({ conversations, onOpen }: { conversations: ConvoSummary[]; onOpen: (id: string) => void }) {
  if (conversations.length === 0) return <EmptyState text="No team conversations yet." />;
  return (
    <div>
      {conversations.map((c) => (
        <button key={c.id} type="button" onClick={() => onOpen(c.id)} className="flex items-start gap-3 w-full text-left px-4 py-3 border-b border-ct-border/60 hover:bg-ct-cream/60 transition-colors">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-ct-navy text-white text-xs font-bold">{convoName(c).slice(0, 2).toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[13px] font-semibold text-ct-navy">{convoName(c)}</p>
              {c.unreadCount > 0 && <span className="shrink-0 rounded-full bg-ct-saffron px-1.5 py-0.5 text-[10px] font-bold text-white">{c.unreadCount}</span>}
            </div>
            <p className="truncate text-xs text-ct-muted mt-0.5">{c.lastMessage?.content ?? "No messages yet"}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

function TodoList({ todos }: { todos: TodoItem[] }) {
  if (todos.length === 0) return <EmptyState text="Nothing on your to-do list right now." />;
  return (
    <div>
      {todos.map((d) => (
        <a key={d.id} href={d.href} className="block px-4 py-3 border-b border-ct-border/60 hover:bg-ct-cream/60 transition-colors">
          <p className="text-[13px] text-ct-navy">{d.title}</p>
          <p className="text-[11px] text-ct-muted mt-0.5">{d.source === "task" ? "Task" : d.source === "instruction" ? "Assigned to you" : "Project issue"}{d.dueDate ? ` · due ${new Date(d.dueDate).toLocaleDateString()}` : ""}</p>
        </a>
      ))}
    </div>
  );
}

function VoiceList({ voiceMemos }: { voiceMemos: VoiceMemoSummary[] }) {
  if (voiceMemos.length === 0) {
    return (
      <div className="p-4 space-y-3">
        <EmptyState text="No voice memos yet." />
        <a href="/voice-tickets" className="block text-center text-xs font-medium text-ct-saffron hover:underline">
          Record or upload a voice memo &rarr;
        </a>
      </div>
    );
  }
  return (
    <div className="p-2 space-y-1">
      {voiceMemos.slice(0, 8).map((m) => (
        <a
          key={m.id}
          href="/voice-tickets"
          className="block px-3 py-2.5 rounded-lg hover:bg-ct-cloud transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-ct-navy truncate">{m.transcript ? m.transcript.slice(0, 60) : "Voice memo"}</span>
            <span className="text-[10px] text-ct-muted shrink-0">{m.status}</span>
          </div>
          <span className="text-xs text-ct-muted">{new Date(m.createdAt).toLocaleString()}</span>
        </a>
      ))}
      <a href="/voice-tickets" className="block text-center text-xs font-medium text-ct-saffron hover:underline py-2">
        Open Voice Tickets &rarr;
      </a>
    </div>
  );
}

function MeetingsList({ meetings, actionItems, onOpen }: { meetings: MeetingSummary[]; actionItems: MeetingActionItemSummary[]; onOpen: (id: string) => void }) {
  if (meetings.length === 0 && actionItems.length === 0) return <EmptyState text="No meetings yet." />;
  return (
    <div>
      {actionItems.length > 0 && (
        <>
          <p className="px-4 pt-3 pb-1 text-[10.5px] font-bold text-ct-muted uppercase tracking-wide">Action items assigned to you</p>
          {actionItems.map((ai) => (
            <button key={ai.id} type="button" onClick={() => onOpen(ai.meetingId)} className="block w-full text-left px-4 py-2.5 border-b border-ct-border/60 hover:bg-ct-cream/60 transition-colors">
              <p className="text-[13px] font-semibold text-ct-navy truncate">{ai.task.title}</p>
              <p className="text-[11px] text-ct-muted mt-0.5 truncate">from {ai.meetingTitle}{ai.task.dueDate ? ` · due ${new Date(ai.task.dueDate).toLocaleDateString()}` : ""}</p>
            </button>
          ))}
        </>
      )}
      {meetings.length > 0 && (
        <>
          <p className="px-4 pt-3 pb-1 text-[10.5px] font-bold text-ct-muted uppercase tracking-wide">Meetings</p>
          {meetings.map((m) => (
            <button key={m.id} type="button" onClick={() => onOpen(m.id)} className="block w-full text-left px-4 py-3 border-b border-ct-border/60 hover:bg-ct-cream/60 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ct-navy truncate flex-1">{m.title}</span>
                <span className={`text-[11px] shrink-0 ${m.status === "published" ? "text-emerald-600" : "text-amber-600"}`}>{m.status === "published" ? "Published" : "Draft"}</span>
              </div>
              <p className="text-xs text-ct-muted mt-0.5">{new Date(m.scheduledAt).toLocaleString()} · {m.meetingType.replace(/_/g, " ")}</p>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function ApprovalsList({ approvals, onDecide }: { approvals: ApprovalItem[]; onDecide: (item: ApprovalItem, decision: "approve" | "reject") => void }) {
  if (approvals.length === 0) return <EmptyState text="Nothing waiting on your decision right now." />;
  return (
    <div>
      {approvals.map((a) => (
        <div key={`${a.kind}-${a.id}`} className="px-4 py-3 border-b border-ct-border/60">
          <p className="text-[13px] font-semibold text-ct-navy truncate capitalize">{a.title}</p>
          <p className="text-[12px] text-ct-muted truncate mt-0.5">{a.sub}</p>
          {a.actionable === false ? (
            // change_order: real approval only happens via e-signature
            // completion now -- a Approve/Reject button here would be a
            // fake one-click override with no signature behind it (the
            // exact bypass this panel used to have, since closed). `sub`
            // above already carries the real signature progress.
            <p className="text-[11px] text-ct-muted mt-1.5 italic">Decided via e-signature, not here</p>
          ) : (
            <div className="flex gap-3 mt-1.5">
              <button type="button" onClick={() => onDecide(a, "approve")} className="text-[11.5px] font-semibold text-emerald-600">Approve</button>
              <button type="button" onClick={() => onDecide(a, "reject")} className="text-[11.5px] font-semibold text-red-600">Reject</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TaskThread({ task, detail, onBack, onMarkDone }: { task: TaskSummary; detail: TaskDetail | null; onBack: () => void; onMarkDone: (id: string) => void }) {
  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-center justify-between rounded-lg bg-ct-cloud px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] text-ct-slate min-w-0">
          <span className="font-semibold text-ct-navy truncate">{task.title}</span>
          <span className={`text-[11px] shrink-0 ${STATUS_COLOR[task.status] ?? "text-ct-muted"}`}>{STATUS_LABEL[task.status] ?? task.status}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {task.status !== "completed" && <button type="button" onClick={() => onMarkDone(task.id)} className="text-[11.5px] font-semibold text-emerald-600">Mark done</button>}
          <button type="button" onClick={onBack} className="text-[11.5px] font-semibold text-ct-saffron">Back</button>
        </div>
      </div>
      <div className="space-y-3">
        {(detail?.chat ?? []).length === 0 && <p className="text-center text-[11px] text-ct-muted">Earlier updates on this task appear here.</p>}
        {(detail?.chat ?? []).map((m) => (
          <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`grid size-8 shrink-0 place-items-center rounded-xl text-white text-xs font-bold ${m.role === "user" ? "bg-ct-navy" : "bg-gradient-to-br from-ct-saffron/90 to-[#F5A623]"}`}>{m.role === "user" ? "R" : "V"}</div>
            <div className={`rounded-2xl px-4 py-2.5 max-w-[80%] ${m.role === "user" ? "bg-ct-navy text-white" : "bg-white border border-ct-border text-ct-navy"}`}>
              <MessageContent content={m.content} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConvoThread({ convo, messages, onBack }: { convo: ConvoSummary; messages: { id: string; senderId: string | null; content: string; createdAt: string }[]; onBack: () => void }) {
  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-center justify-between rounded-lg bg-ct-cloud px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] text-ct-slate">
          <span>Chatting with</span>
          <span className="font-semibold text-ct-navy">{convoName(convo)}</span>
        </div>
        <button type="button" onClick={onBack} className="text-[11.5px] font-semibold text-ct-saffron">Back</button>
      </div>
      <div className="space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-3 ${m.senderId ? "flex-row-reverse" : ""}`}>
            <div className={`grid size-8 shrink-0 place-items-center rounded-xl text-white text-xs font-bold ${m.senderId ? "bg-ct-navy" : "bg-ct-slate"}`}>{m.senderId ? "R" : convoName(convo).slice(0, 2).toUpperCase()}</div>
            <div className={`rounded-2xl px-4 py-2.5 max-w-[80%] ${m.senderId ? "bg-ct-navy text-white" : "bg-white border border-ct-border text-ct-navy"}`}>
              <MessageContent content={m.content} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MeetingThread({ meetingId, detail, onBack, onChanged }: { meetingId: string; detail: MeetingDetail | null; onBack: () => void; onChanged: () => void }) {
  const [shareLinks, setShareLinks] = useState<{ shareUrl: string; whatsappHref: string; telegramHref: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [newActionTitle, setNewActionTitle] = useState("");
  const [addingAction, setAddingAction] = useState(false);

  async function share() {
    setSharing(true);
    try {
      const link = await postJson(`/api/veri-meetings/${meetingId}/share-links`);
      setShareLinks({ shareUrl: link.shareUrl, whatsappHref: link.whatsappHref, telegramHref: link.telegramHref });
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to create share link");
    } finally {
      setSharing(false);
    }
  }

  function copyShareUrl() {
    if (!shareLinks) return;
    navigator.clipboard.writeText(shareLinks.shareUrl);
    toast.success("Link copied");
  }

  async function addActionItem() {
    if (!newActionTitle.trim()) return;
    setAddingAction(true);
    try {
      await postJson(`/api/veri-meetings/${meetingId}/action-items`, { title: newActionTitle.trim() });
      setNewActionTitle("");
      onChanged();
    } catch {
      toast.error("Couldn't add that action item");
    } finally {
      setAddingAction(false);
    }
  }

  async function toggleActionDone(taskId: string) {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }) });
      if (!res.ok) throw new Error();
      onChanged();
    } catch {
      toast.error("Couldn't mark that action item done");
    }
  }

  if (!detail) return <div className="grid place-items-center h-32"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;

  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-center justify-between rounded-lg bg-ct-cloud px-3 py-2">
        <div className="min-w-0">
          <p className="font-semibold text-ct-navy text-[13px] truncate">{detail.title}</p>
          <p className="text-[11px] text-ct-muted">{new Date(detail.scheduledAt).toLocaleString()} · {detail.status === "published" ? "Published" : "Draft"}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <a href={`/veri-meetings/${detail.id}`} className="text-[11.5px] font-semibold text-ct-saffron">Open</a>
          <button type="button" onClick={onBack} className="text-[11.5px] font-semibold text-ct-saffron">Back</button>
        </div>
      </div>

      {detail.agenda.length > 0 && (
        <div className="mb-3">
          <p className="text-[10.5px] font-bold text-ct-muted uppercase tracking-wide mb-1">Agenda</p>
          <ul className="list-disc list-inside text-[12.5px] text-ct-slate space-y-0.5">
            {detail.agenda.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      {detail.minutes && (
        <div className="mb-3">
          <p className="text-[10.5px] font-bold text-ct-muted uppercase tracking-wide mb-1">Minutes</p>
          <p className="text-[12.5px] text-ct-slate whitespace-pre-wrap">{detail.minutes}</p>
        </div>
      )}

      {detail.aiSummary && (
        <div className="mb-3 rounded-lg border border-ct-border bg-ct-cream/40 p-2.5">
          <p className="text-[10.5px] font-bold text-ct-muted uppercase tracking-wide mb-1">AI summary</p>
          <p className="text-[12.5px] text-ct-slate">{detail.aiSummary}</p>
        </div>
      )}

      <div className="mb-3">
        <p className="text-[10.5px] font-bold text-ct-muted uppercase tracking-wide mb-1">Action items</p>
        {detail.actionItems.length === 0 && <p className="text-[12px] text-ct-muted">None yet.</p>}
        {detail.actionItems.map((ai) => (
          <div key={ai.id} className="flex items-center justify-between gap-2 py-1">
            <span className={`text-[12.5px] truncate ${ai.task.status === "completed" ? "line-through text-ct-muted" : "text-ct-navy"}`}>{ai.task.title}</span>
            {ai.task.status !== "completed" && (
              <button type="button" onClick={() => toggleActionDone(ai.task.id)} className="text-[10.5px] font-semibold text-emerald-600 shrink-0">Done</button>
            )}
          </div>
        ))}
        <div className="flex items-center gap-1.5 mt-1.5">
          <input
            value={newActionTitle}
            onChange={(e) => setNewActionTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addActionItem(); }}
            placeholder="Add an action item…"
            className="flex-1 h-7 px-2 rounded-md border border-ct-border text-[12px]"
          />
          <button type="button" onClick={addActionItem} disabled={addingAction || !newActionTitle.trim()} className="text-[11.5px] font-semibold text-ct-saffron shrink-0 disabled:opacity-40">Add</button>
        </div>
      </div>

      <div>
        {shareLinks ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <input readOnly value={shareLinks.shareUrl} className="flex-1 h-7 px-2 rounded-md border border-ct-border text-[11px] text-ct-muted" />
              <button type="button" onClick={copyShareUrl} className="text-[11px] font-semibold text-ct-saffron shrink-0">Copy</button>
            </div>
            <div className="flex gap-1.5">
              <a href={shareLinks.whatsappHref} target="_blank" rel="noopener noreferrer" className="flex-1 text-center text-[11px] border border-ct-border rounded-md py-1 hover:bg-ct-cloud">WhatsApp</a>
              <a href={shareLinks.telegramHref} target="_blank" rel="noopener noreferrer" className="flex-1 text-center text-[11px] border border-ct-border rounded-md py-1 hover:bg-ct-cloud">Telegram</a>
            </div>
          </div>
        ) : (
          <button type="button" onClick={share} disabled={sharing} className="text-[11.5px] font-semibold text-ct-saffron disabled:opacity-40">
            {sharing ? "Creating link…" : "Share"}
          </button>
        )}
      </div>
    </div>
  );
}

function EmailThread({ item, onBack, onChanged }: { item: EmailItem; onBack: () => void; onChanged: () => void }) {
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [dismissing, setDismissing] = useState(false);

  async function promote(index: number) {
    setBusyIndex(index);
    try {
      await postJson(`/api/email-intelligence/${item.id}/promote`, { suggestedIndex: index });
      toast.success("Added to your tasks");
      onChanged();
    } catch {
      toast.error("Couldn't promote that item");
    } finally {
      setBusyIndex(null);
    }
  }

  async function dismiss() {
    setDismissing(true);
    try {
      await postJson(`/api/email-intelligence/${item.id}/dismiss`);
      onBack();
      onChanged();
    } catch {
      toast.error("Couldn't dismiss that email");
    } finally {
      setDismissing(false);
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-center justify-between rounded-lg bg-ct-cloud px-3 py-2">
        <div className="min-w-0">
          <p className="font-semibold text-ct-navy text-[13px] truncate">{item.subject}</p>
          <p className="text-[11px] text-ct-muted truncate">{item.senderEmail ?? "Unknown sender"}</p>
        </div>
        <button type="button" onClick={onBack} className="text-[11.5px] font-semibold text-ct-saffron shrink-0">Back</button>
      </div>

      {item.aiSummary && <p className="text-[12.5px] text-ct-slate mb-3">{item.aiSummary}</p>}

      <p className="text-[10.5px] font-bold text-ct-muted uppercase tracking-wide mb-1">Suggested work items</p>
      {item.aiSuggestedWorkItems.length === 0 && <p className="text-[12px] text-ct-muted">None detected.</p>}
      {item.aiSuggestedWorkItems.map((s, i) => (
        <div key={i} className="flex items-center justify-between gap-2 py-1.5 border-b border-ct-border/60 last:border-0">
          <div className="min-w-0">
            <p className="text-[12.5px] text-ct-navy truncate">{s.title}</p>
            <p className="text-[11px] text-ct-muted capitalize">{s.category.replace(/_/g, " ")}</p>
          </div>
          <button type="button" onClick={() => promote(i)} disabled={busyIndex === i} className="text-[11px] font-semibold text-emerald-600 shrink-0 disabled:opacity-40">
            {busyIndex === i ? "Adding…" : "Add to tasks"}
          </button>
        </div>
      ))}

      <button type="button" onClick={dismiss} disabled={dismissing} className="mt-3 text-[11.5px] font-semibold text-ct-muted disabled:opacity-40">
        {dismissing ? "Dismissing…" : "Dismiss"}
      </button>
    </div>
  );
}

function Overview({
  tasks, conversations, todos, emails, onOpenTask, onOpenConvo, onOpenEmail, onGoToTodo,
}: {
  tasks: TaskSummary[]; conversations: ConvoSummary[]; todos: TodoItem[]; emails: EmailItem[];
  onOpenTask: (id: string) => void; onOpenConvo: (id: string) => void; onOpenEmail: (id: string) => void; onGoToTodo: () => void;
}) {
  type Item = { key: string; type: "task" | "chat" | "todo" | "email"; ts: number; title: string; sub: string; unread: boolean; onClick: () => void };

  const items: Item[] = [
    ...tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled").map((t) => ({
      key: `t-${t.id}`, type: "task" as const, ts: new Date(t.createdAt).getTime(), title: t.title, sub: t.description ?? STATUS_LABEL[t.status] ?? t.status,
      unread: t.status === "pending", onClick: () => onOpenTask(t.id),
    })),
    ...conversations.filter((c) => c.lastMessage).map((c) => ({
      key: `c-${c.id}`, type: "chat" as const, ts: new Date(c.lastMessage!.createdAt).getTime(), title: convoName(c), sub: c.lastMessage!.content,
      unread: c.unreadCount > 0, onClick: () => onOpenConvo(c.id),
    })),
    ...todos.filter((d) => d.status !== "completed" && d.status !== "done_as_asked" && d.status !== "resolved").map((d) => ({
      key: `d-${d.id}`, type: "todo" as const, ts: 0, title: d.title, sub: "To do", unread: false, onClick: onGoToTodo,
    })),
    // Priority 18a: email-intelligence-service.ts's flagged/actionable items
    // (status: 'proposed', already filtered by the caller) folded into this
    // same merged feed rather than a parallel mail client or a new tab --
    // per this wave's own brief, email attention belongs alongside
    // tasks/chats/todos here, not as its own surface.
    ...emails.map((e) => ({
      key: `e-${e.id}`, type: "email" as const, ts: new Date(e.createdAt).getTime(), title: e.subject, sub: e.aiSummary ?? (e.senderEmail ?? "New email detected"),
      unread: true, onClick: () => onOpenEmail(e.id),
    })),
  ].sort((a, b) => b.ts - a.ts);

  if (items.length === 0) return <EmptyState text="Nothing needs your attention right now." />;

  const ICON_BG: Record<Item["type"], string> = { task: "bg-ct-saffron", chat: "bg-ct-navy", todo: "bg-emerald-700", email: "bg-ct-teal" };

  return (
    <div>
      {items.map((item) => (
        <button key={item.key} type="button" onClick={item.onClick} className="flex items-start gap-2.5 w-full text-left px-4 py-3 border-b border-ct-border/60 hover:bg-ct-cream/60 transition-colors">
          <div className={`grid place-items-center size-[26px] rounded-lg shrink-0 text-white ${ICON_BG[item.type]}`}>
            {item.type === "task" ? "✓" : item.type === "chat" ? <MessageSquare className="size-3" /> : item.type === "email" ? "@" : "☐"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-ct-navy truncate">{item.title}</p>
              {item.unread && <span className="size-2 rounded-full bg-ct-saffron shrink-0" />}
            </div>
            <p className="text-[12px] text-ct-muted truncate mt-0.5">{item.sub}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-5 py-10 text-center text-sm text-ct-muted">{text}</div>;
}
