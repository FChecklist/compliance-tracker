"use client";

import { useState } from "react";
import { Bot, CircleDashed, Loader2, CheckCircle2, Check, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ASSISTANT_COLOR,
  type OrchestraAssistant,
  type OrchestraTask,
} from "@/lib/orchestra-mock-data";
import { AgentTag } from "./AgentTag";

const TASK_BADGE: Record<OrchestraTask["status"], { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  in_progress: { label: "Working", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  completed: { label: "Review", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  submitted: { label: "Done", className: "bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300" },
};

function TaskIcon({ status }: { status: OrchestraTask["status"] }) {
  if (status === "in_progress") return <Loader2 className="size-3.5 text-amber-500 animate-spin" />;
  if (status === "completed") return <CheckCircle2 className="size-3.5 text-lime-600" />;
  if (status === "submitted") return <Check className="size-3.5 text-muted-foreground" />;
  return <CircleDashed className="size-3.5 text-muted-foreground/50" />;
}

export function AssistantColumn({ assistant }: { assistant: OrchestraAssistant }) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const c = ASSISTANT_COLOR[assistant.color];
  const doneCount = assistant.tasks.filter((t) => t.status === "submitted" || t.status === "completed").length;

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

      {/* Linked worker agents */}
      <div className="px-2.5 py-1.5 border-b flex flex-wrap gap-1">
        {assistant.agentIds.map((id) => (
          <AgentTag key={id} agentId={id} />
        ))}
      </div>

      {/* Metrics */}
      <div className="px-2.5 py-2 border-b grid grid-cols-2 gap-1.5">
        {assistant.metrics.map((m) => (
          <div key={m.label} className="bg-muted/50 rounded-md px-2 py-1">
            <div className="text-[10px] text-muted-foreground leading-tight">{m.label}</div>
            <div
              className={cn(
                "text-xs font-semibold font-mono leading-tight mt-0.5",
                m.trend === "up" ? "text-lime-700 dark:text-lime-400" : m.trend === "down" ? "text-amber-700 dark:text-amber-400" : "text-foreground"
              )}
            >
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1 min-h-[140px]">
        {assistant.tasks.map((task) => {
          const badge = TASK_BADGE[task.status];
          const selected = selectedTaskId === task.id;
          return (
            <button
              key={task.id}
              onClick={() => setSelectedTaskId(selected ? null : task.id)}
              className={cn(
                "w-full flex items-center gap-2 px-1.5 py-1.5 rounded-md text-left transition-colors",
                selected ? "bg-muted" : "hover:bg-muted/50"
              )}
            >
              <TaskIcon status={task.status} />
              <div className="flex-1 min-w-0">
                <div className={cn("text-xs leading-tight truncate", task.status === "submitted" && "text-muted-foreground line-through")}>
                  {task.title}
                </div>
                <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{task.client}</div>
              </div>
              <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0", badge.className)}>
                {badge.label}
              </span>
            </button>
          );
        })}
        <div className="px-1.5 pt-1 text-[10px] text-muted-foreground">
          {doneCount}/{assistant.tasks.length} complete
        </div>
      </div>

      {/* Chat (preview -- not wired to a real assistant yet) */}
      <div className="border-t px-2.5 py-2 max-h-[90px] overflow-y-auto space-y-1.5">
        {assistant.chat.map((m) => (
          <div key={m.id} className="bg-muted/50 rounded-lg rounded-tl-sm px-2 py-1">
            <p className="text-[11px] text-muted-foreground leading-relaxed">{m.text}</p>
          </div>
        ))}
      </div>
      <div className="border-t px-1.5 py-1.5 flex gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex-1">
              <Input
                placeholder={`Message ${assistant.label}...`}
                disabled
                className="h-7 text-xs"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>Live chat with assistants ships in a later wave — see orchestra_changes.md</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button size="icon" className="size-7 shrink-0" disabled>
                <Send className="size-3" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Not wired up yet</TooltipContent>
        </Tooltip>
      </div>
    </Card>
  );
}
