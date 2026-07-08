"use client";

// Independent right-panel view -- its own view tabs, never driven by
// composerMode. Overview mixes real data across Tasks/Chats/To Do so
// navigating to any page always lands on something genuinely useful,
// instead of whatever list happened to be active last. Tasks/Chats reuse
// the existing /api/tasks and /api/conversations endpoints; To Do reuses
// /api/veri-todo as-is (zero new backend for that view).
import { useEffect, useState } from "react";
import { Loader2, MessageSquare, CheckCircle2 } from "lucide-react";
import { MessageContent } from "@/components/chat/MessageContent";
import { toast } from "sonner";
import { useVeriChat } from "./veri-chat-context";

type TaskSummary = { id: string; title: string; description: string | null; status: string; createdAt: string };
type TaskDetail = TaskSummary & { chat: { id: string; role: string; content: string; createdAt: string }[] };
type ConvoSummary = { id: string; isAiThread: boolean; title: string | null; otherParticipants: { id: string; name: string }[]; lastMessage: { content: string; createdAt: string; senderId: string | null } | null; unreadCount: number };
type TodoItem = { id: string; source: string; title: string; status: string; dueDate: string | null; href: string };

const STATUS_LABEL: Record<string, string> = { pending: "Pending", in_progress: "In progress", completed: "Done", failed: "Failed", cancelled: "Cancelled" };
const STATUS_COLOR: Record<string, string> = { pending: "text-amber-600", in_progress: "text-ct-saffron", completed: "text-emerald-600", failed: "text-red-600", cancelled: "text-ct-muted" };

function convoName(c: ConvoSummary): string {
  return c.title || c.otherParticipants.map((p) => p.name).join(", ") || "Conversation";
}

export default function VeriChatPanel() {
  const { rightPanelView, setRightPanelView, activeTaskId, activeConversationId, openTask, openConversation, closeThread, refreshCounter } = useVeriChat();

  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [conversations, setConversations] = useState<ConvoSummary[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [convoMessages, setConvoMessages] = useState<{ id: string; senderId: string | null; content: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/tasks").then((r) => r.json()).then((d) => setTasks(d.tasks ?? [])).catch(() => {}),
      fetch("/api/conversations").then((r) => r.json()).then((d) => setConversations((d.conversations ?? []).filter((c: ConvoSummary) => !c.isAiThread))).catch(() => {}),
      fetch("/api/veri-todo").then((r) => r.json()).then((d) => setTodos(d.items ?? [])).catch(() => {}),
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

  const waitingCount = tasks.filter((t) => t.status === "pending").length;
  const unreadChatCount = conversations.filter((c) => c.unreadCount > 0).length;
  const todoCount = todos.filter((t) => t.status !== "completed" && t.status !== "done_as_asked" && t.status !== "resolved").length;

  const activeTask = activeTaskId ? tasks.find((t) => t.id === activeTaskId) : null;
  const activeConvo = activeConversationId ? conversations.find((c) => c.id === activeConversationId) : null;

  return (
    <aside className="border-l border-ct-border bg-white flex flex-col h-full">
      <div className="border-b border-ct-border px-4 py-3">
        <div className="flex items-center gap-2 mb-2.5">
          <MessageSquare className="size-4 text-ct-saffron" />
          <span className="font-heading text-[15px] text-ct-navy">VERI Chat</span>
        </div>
        <div className="flex items-center gap-1">
          {([
            { key: "overview", label: "Overview", count: 0 },
            { key: "tasks", label: "Tasks", count: waitingCount },
            { key: "chats", label: "Chats", count: unreadChatCount },
            { key: "todo", label: "To Do", count: todoCount },
          ] as const).map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => { closeThread(); setRightPanelView(v.key); }}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${
                rightPanelView === v.key && !activeTaskId && !activeConversationId ? "bg-amber-50 text-amber-800 border border-amber-200" : "text-ct-muted hover:bg-ct-cloud"
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
          <TaskThread task={activeTask} detail={taskDetail} onBack={closeThread} onMarkDone={markTaskDone} />
        ) : activeConvo ? (
          <ConvoThread convo={activeConvo} messages={convoMessages} onBack={closeThread} />
        ) : rightPanelView === "tasks" ? (
          <TaskList tasks={tasks} onOpen={openTask} onMarkDone={markTaskDone} />
        ) : rightPanelView === "chats" ? (
          <ChatList conversations={conversations} onOpen={openConversation} />
        ) : rightPanelView === "todo" ? (
          <TodoList todos={todos} />
        ) : (
          <Overview tasks={tasks} conversations={conversations} todos={todos} onOpenTask={openTask} onOpenConvo={openConversation} onGoToTodo={() => setRightPanelView("todo")} />
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

function Overview({
  tasks, conversations, todos, onOpenTask, onOpenConvo, onGoToTodo,
}: {
  tasks: TaskSummary[]; conversations: ConvoSummary[]; todos: TodoItem[];
  onOpenTask: (id: string) => void; onOpenConvo: (id: string) => void; onGoToTodo: () => void;
}) {
  type Item = { key: string; type: "task" | "chat" | "todo"; ts: number; title: string; sub: string; unread: boolean; onClick: () => void };

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
  ].sort((a, b) => b.ts - a.ts);

  if (items.length === 0) return <EmptyState text="Nothing needs your attention right now." />;

  const ICON_BG: Record<Item["type"], string> = { task: "bg-ct-saffron", chat: "bg-ct-navy", todo: "bg-emerald-700" };

  return (
    <div>
      {items.map((item) => (
        <button key={item.key} type="button" onClick={item.onClick} className="flex items-start gap-2.5 w-full text-left px-4 py-3 border-b border-ct-border/60 hover:bg-ct-cream/60 transition-colors">
          <div className={`grid place-items-center size-[26px] rounded-lg shrink-0 text-white ${ICON_BG[item.type]}`}>
            {item.type === "task" ? "✓" : item.type === "chat" ? <MessageSquare className="size-3" /> : "☐"}
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
