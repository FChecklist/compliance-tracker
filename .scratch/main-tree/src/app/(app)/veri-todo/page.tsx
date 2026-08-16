"use client";

// force-dynamic: prevents static prerendering (and the CDN-cache-bypasses-
// middleware gap that caused, confirmed live in Wave 29-31 -- see
// orchestra_changes.md #79). Every new client-only page in (app)/ gets
// this proactively now.
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { CheckSquare, MessageSquare, ListTodo } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type VeriTodoItem = {
  id: string; source: "task" | "instruction" | "pms_issue"; title: string; description: string | null;
  status: string; dueDate: string | null; createdAt: string; href: string;
};

const SOURCE_ICON: Record<string, typeof CheckSquare> = { task: CheckSquare, instruction: MessageSquare, pms_issue: ListTodo };
const SOURCE_LABEL: Record<string, string> = { task: "Task", instruction: "Chat Instruction", pms_issue: "PMS Issue" };

export default function VeriTodoPage() {
  const [items, setItems] = useState<VeriTodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/veri-todo");
    const data = await res.json();
    setItems(data.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">VERI To Do</h1>
        <p className="text-sm text-ct-muted mt-1">Everything pending for you -- tasks, chat instructions, and assigned PMS issues, in one unified view.</p>
      </div>

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : items.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center space-y-2">
            <CheckSquare className="size-10 text-ct-muted mx-auto" />
            <p className="text-sm text-ct-muted">Nothing pending. You're all caught up.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {items.map((item) => {
            const Icon = SOURCE_ICON[item.source];
            return (
              <Link key={`${item.source}-${item.id}`} href={item.href} className="px-4 py-3 flex items-center gap-3 hover:bg-ct-cloud transition-colors">
                <Icon className="size-4 text-ct-teal shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ct-navy truncate">{item.title}</p>
                  {item.description && <p className="text-xs text-ct-muted truncate">{item.description}</p>}
                </div>
                <Badge variant="secondary" className="text-[10px] shrink-0">{SOURCE_LABEL[item.source]}</Badge>
                {item.dueDate && <span className="text-xs text-ct-muted shrink-0">{new Date(item.dueDate).toLocaleDateString()}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
