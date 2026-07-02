"use client";

import { useEffect, useState, useCallback } from "react";
import { Bot, CircleDashed, Loader2, CheckCircle2, XCircle, Ban, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ASSISTANT_COLOR } from "@/lib/orchestra-mock-data";
import { toast } from "sonner";

type RealAssistant = {
  id: string;
  assistantNumber: number;
  label: string;
  status: "idle" | "working";
};

type RealTask = {
  id: string;
  title: string;
  description: string | null;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  createdAt: string;
};

const COLOR_CYCLE: Array<OrchestraAssistantColor> = ["teal", "amber", "rose", "cyan", "lime"];
type OrchestraAssistantColor = "teal" | "amber" | "rose" | "cyan" | "lime";

const STATUS_BADGE: Record<RealTask["status"], { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  in_progress: { label: "Working", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  completed: { label: "Done", className: "bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300" },
  failed: { label: "Failed", className: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

function TaskIcon({ status }: { status: RealTask["status"] }) {
  if (status === "in_progress") return <Loader2 className="size-3.5 text-amber-500 animate-spin" />;
  if (status === "completed") return <CheckCircle2 className="size-3.5 text-lime-600" />;
  if (status === "failed") return <XCircle className="size-3.5 text-rose-600" />;
  if (status === "cancelled") return <Ban className="size-3.5 text-muted-foreground" />;
  return <CircleDashed className="size-3.5 text-muted-foreground/50" />;
}

export function RealAssistantColumn({ assistant }: { assistant: RealAssistant }) {
  const [tasks, setTasks] = useState<RealTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const color = COLOR_CYCLE[(assistant.assistantNumber - 1) % COLOR_CYCLE.length];
  const c = ASSISTANT_COLOR[color];

  const fetchTasks = useCallback(() => {
    setLoading(true);
    fetch(`/api/tasks?assistantId=${assistant.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setTasks(data.tasks ?? []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [assistant.id]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const doneCount = tasks.filter((t) => t.status === "completed").length;

  const createTask = async () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, assistantId: assistant.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create task");
      }
      setNewTaskTitle("");
      fetchTasks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create task");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card className="flex-1 min-w-[260px] flex flex-col overflow-hidden py-0 gap-0 rounded-xl">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b">
        <div className={cn("size-6 rounded-md flex items-center justify-center shrink-0", c.bg)}>
          <Bot className={cn("size-3.5", c.text)} />
        </div>
        <span className="text-sm font-semibold flex-1 truncate">{assistant.label}</span>
        <span className={cn("size-1.5 rounded-full", assistant.status === "working" ? cn(c.dot, "animate-pulse") : "bg-muted-foreground/30")} />
        <span className="text-[10px] text-muted-foreground">{assistant.status === "working" ? "Active" : "Idle"}</span>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1 min-h-[300px]">
        {loading ? (
          <div className="space-y-1.5 px-1.5 py-1.5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="text-[11px] text-muted-foreground text-center py-6 px-2">
            No tasks yet. Add one below — the assistant plans it against your real worker
            agent roster and reports back in a few seconds.
          </p>
        ) : (
          tasks.map((task) => {
            const badge = STATUS_BADGE[task.status];
            return (
              <div key={task.id} className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-md">
                <TaskIcon status={task.status} />
                <div className="flex-1 min-w-0">
                  <div className={cn("text-xs leading-tight truncate", task.status === "completed" && "text-muted-foreground line-through")}>
                    {task.title}
                  </div>
                </div>
                <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0", badge.className)}>
                  {badge.label}
                </span>
              </div>
            );
          })
        )}
        {tasks.length > 0 && (
          <div className="px-1.5 pt-1 text-[10px] text-muted-foreground">
            {doneCount}/{tasks.length} complete
          </div>
        )}
      </div>

      {/* Add task -- real, not disabled. Creates a row in `tasks`; nothing
          auto-executes it yet, that's a later wave (task execution engine). */}
      <div className="border-t px-1.5 py-1.5 flex gap-1.5">
        <Input
          placeholder={`New task for ${assistant.label}...`}
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") createTask();
          }}
          disabled={creating}
          className="h-7 text-xs"
        />
        <Button size="icon" className="size-7 shrink-0" onClick={createTask} disabled={creating || !newTaskTitle.trim()}>
          {creating ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
        </Button>
      </div>
    </Card>
  );
}
