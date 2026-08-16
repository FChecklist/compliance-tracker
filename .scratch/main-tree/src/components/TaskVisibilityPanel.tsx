"use client";

// D5.B6 (tree4-unified 50-completion-plan area 1, "persistent visibility
// panel"): Task Number/Priority/Owner/Workflow Status must always be visible
// somewhere in the authenticated app chrome -- confirmed absent before this.
// Rendered unconditionally by AppShell (both the veriChatV2 and legacy
// branches), independent of whether VeriChatProvider is mounted -- see
// useVeriChatOptional()'s own comment for why a null-safe read is needed
// here specifically.
import { useEffect, useState } from "react";
import { CircleDot } from "lucide-react";
import { useVeriChatOptional } from "@/components/veri-chat/veri-chat-context";
import { cn } from "@/lib/utils";

type TaskDetail = {
  id: string;
  title: string;
  status: string;
  priority: number;
  owner: { id: string; name: string } | null;
};

// tasks.priority is a plain 0-3 int (task-service.ts's VALID_PRIORITIES),
// not the priorityEnum used elsewhere in this schema -- labels match that
// file's own comment ("Low, Normal, High, Urgent").
const PRIORITY_LABELS: Record<number, string> = { 0: "Low", 1: "Normal", 2: "High", 3: "Urgent" };
const PRIORITY_COLORS: Record<number, string> = {
  0: "text-ct-muted",
  1: "text-ct-navy",
  2: "text-orange-600",
  3: "text-red-600",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

// No dedicated task-number column exists on `tasks` (schema.ts confirmed --
// only id, no sequential/human-readable number). Rather than a schema
// migration for a narrowly-scoped UX wave, a stable short reference derived
// from the id's own tail is used as the visible "Task Number" -- same idea
// as a short-SHA display, deterministic and unique enough to be useful
// without inventing a new counter.
function shortTaskNumber(id: string): string {
  return "#" + id.slice(-6).toUpperCase();
}

export default function TaskVisibilityPanel() {
  const veriChat = useVeriChatOptional();
  const activeTaskId = veriChat?.activeTaskId ?? null;
  const [task, setTask] = useState<TaskDetail | null>(null);

  useEffect(() => {
    if (!activeTaskId) {
      setTask(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/tasks/${activeTaskId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setTask({ id: d.id, title: d.title, status: d.status, priority: d.priority, owner: d.owner ?? null });
      })
      .catch(() => {
        if (!cancelled) setTask(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTaskId]);

  return (
    <div
      className="shrink-0 h-9 bg-ct-cream border-b border-ct-border flex items-center gap-4 px-4 md:px-6 text-xs"
      data-testid="task-visibility-panel"
    >
      {task ? (
        <>
          <span className="flex items-center gap-1.5 text-ct-muted">
            <CircleDot className="size-3" />
            <span className="font-medium text-ct-navy">{shortTaskNumber(task.id)}</span>
          </span>
          <span className="text-ct-border" aria-hidden="true">|</span>
          <span className="text-ct-muted">
            Priority: <span className={cn("font-medium", PRIORITY_COLORS[task.priority] ?? "text-ct-navy")}>{PRIORITY_LABELS[task.priority] ?? task.priority}</span>
          </span>
          <span className="text-ct-border" aria-hidden="true">|</span>
          <span className="text-ct-muted">
            Owner: <span className="font-medium text-ct-navy">{task.owner?.name ?? "Unassigned"}</span>
          </span>
          <span className="text-ct-border" aria-hidden="true">|</span>
          <span className="text-ct-muted">
            Status: <span className="font-medium text-ct-navy">{STATUS_LABELS[task.status] ?? task.status}</span>
          </span>
          <span className="text-ct-muted truncate ml-2">{task.title}</span>
        </>
      ) : (
        <span className="text-ct-muted">No task in context — Task Number / Priority / Owner / Workflow Status will show here once you open one.</span>
      )}
    </div>
  );
}
