"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusPill } from "@/components/SimpleModulePage";
import { formatDistanceToNow } from "date-fns";

type TodoTask = { id: string; title: string; description: string | null; status: string; createdAt: string; updatedAt: string };
type DelegatedTask = TodoTask & { assigneeId: string };

export function ToDoTab() {
  const [myTasks, setMyTasks] = useState<TodoTask[]>([]);
  const [delegated, setDelegated] = useState<DelegatedTask[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    Promise.all([
      fetch("/api/home/todos").then((r) => r.json()),
      fetch("/api/home/assigned-by-me").then((r) => r.json()),
    ])
      .then(([mine, byMe]) => {
        setMyTasks(mine.tasks ?? []);
        setDelegated(byMe.tasks ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleComplete(task: TodoTask) {
    const nextStatus = task.status === "completed" ? "in_progress" : "completed";
    setMyTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    }).catch(() => {});
  }

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg text-ct-navy mb-2">My To Do</h2>
        <Card className="rounded-xl shadow-card bg-white divide-y divide-ct-border">
          {myTasks.length === 0 ? (
            <p className="p-4 text-sm text-ct-muted">Nothing on your plate right now.</p>
          ) : (
            myTasks.map((t) => (
              <div key={t.id} className="flex items-center gap-3 p-3">
                <Checkbox checked={t.status === "completed"} onCheckedChange={() => toggleComplete(t)} />
                <div className="flex-1 min-w-0">
                  <p className={t.status === "completed" ? "text-sm text-ct-muted line-through" : "text-sm text-ct-navy"}>{t.title}</p>
                  <p className="text-xs text-ct-muted">{formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}</p>
                </div>
                <StatusPill value={t.status} />
              </div>
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
