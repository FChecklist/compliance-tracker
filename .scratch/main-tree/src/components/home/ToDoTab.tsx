"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/SimpleModulePage";
import { formatDistanceToNow } from "date-fns";

type VeriTodoItem = {
  id: string; source: "task" | "instruction" | "pms_issue"; title: string; description: string | null;
  status: string; dueDate: string | null; createdAt: string; href: string; priority: number | null;
};

// Wave 148 (Phase4_Implementation_Plan.md): matches task-service.ts's
// VALID_PRIORITIES (0-3).
const PRIORITY_LABELS: Record<number, string> = { 0: "Low", 1: "Normal", 2: "High", 3: "Urgent" };
type DelegatedTask = { id: string; title: string; description: string | null; status: string; createdAt: string; updatedAt: string; assigneeId: string };

export function ToDoTab() {
  const [items, setItems] = useState<VeriTodoItem[]>([]);
  const [delegated, setDelegated] = useState<DelegatedTask[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    Promise.all([
      fetch("/api/home/todos").then((r) => r.json()),
      fetch("/api/home/assigned-by-me").then((r) => r.json()),
    ])
      .then(([mine, byMe]) => {
        setItems(mine.items ?? []);
        setDelegated(byMe.tasks ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  // Only real `tasks` rows have a /api/tasks/:id PATCH target -- an
  // instruction_commitment or pms_issue sourced item isn't a task and can't
  // be toggled the same way, so those render read-only (via their own href).
  async function toggleComplete(item: VeriTodoItem) {
    if (item.source !== "task") return;
    const nextStatus = item.status === "completed" ? "in_progress" : "completed";
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: nextStatus } : i)));
    await fetch(`/api/tasks/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    }).catch(() => {});
  }

  // Wave 148: only `task`-sourced items have a real priority column --
  // instructions/pms_issues render without this control.
  async function changePriority(item: VeriTodoItem, priority: number) {
    setItems((prev) => {
      const next = prev.map((i) => (i.id === item.id ? { ...i, priority } : i));
      next.sort((a, b) => {
        const diff = (b.priority ?? 0) - (a.priority ?? 0);
        if (diff !== 0) return diff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
      return next;
    });
    await fetch(`/api/tasks/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority }),
    }).catch(() => {});
  }

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg text-ct-navy mb-2">My To Do</h2>
        <Card className="rounded-xl shadow-card bg-white divide-y divide-ct-border">
          {items.length === 0 ? (
            <p className="p-4 text-sm text-ct-muted">Nothing on your plate right now.</p>
          ) : (
            items.map((item) => (
              <a key={item.id} href={item.href} className="flex items-center gap-3 p-3 hover:bg-ct-cloud/40">
                {item.source === "task" ? (
                  <Checkbox
                    checked={item.status === "completed"}
                    onCheckedChange={() => toggleComplete(item)}
                    onClick={(e) => e.preventDefault()}
                  />
                ) : (
                  <span className="size-4 shrink-0 rounded-full border border-ct-border" title={item.source === "instruction" ? "Assigned to you" : "PMS issue"} />
                )}
                <div className="flex-1 min-w-0">
                  <p className={item.status === "completed" ? "text-sm text-ct-muted line-through" : "text-sm text-ct-navy"}>{item.title}</p>
                  <p className="text-xs text-ct-muted">{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</p>
                </div>
                {item.source === "task" && (
                  <Select
                    value={String(item.priority ?? 0)}
                    onValueChange={(v) => changePriority(item, Number(v))}
                  >
                    <SelectTrigger
                      className="h-7 w-[92px] text-xs shrink-0"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent onClick={(e) => e.stopPropagation()}>
                      {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <StatusPill value={item.status} />
              </a>
            ))
          )}
        </Card>
      </div>

      {delegated.length > 0 && (
        <div>
          <h2 className="font-heading text-lg text-ct-navy mb-2">Assigned by me</h2>
          <Card className="rounded-xl shadow-card bg-white divide-y divide-ct-border">
            {delegated.map((t) => (
              <div key={t.id} className="flex items-center gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ct-navy">{t.title}</p>
                  <p className="text-xs text-ct-muted">{formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}</p>
                </div>
                <StatusPill value={t.status} />
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
