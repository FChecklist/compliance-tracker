"use client";

import { Bot } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ConversationSummary = {
  id: string;
  type: string;
  isAiThread: boolean;
  title: string | null;
  otherParticipants: { id: string; name: string }[];
  lastMessage: { content: string; createdAt: string; senderId: string | null } | null;
  unreadCount: number;
  updatedAt: string;
};

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {conversations.map((c) => {
        const name = c.isAiThread ? "VERIDIAN AI" : c.title || c.otherParticipants[0]?.name || "Conversation";
        const isActive = c.id === selectedId;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={cn(
              "flex items-center gap-3 px-4 py-3 text-left border-b border-ct-border/60 transition-colors",
              isActive ? "bg-ct-accent" : "hover:bg-ct-cloud",
              c.isAiThread && "bg-ct-saffron/5"
            )}
          >
            <Avatar className="size-9 shrink-0">
              {c.isAiThread ? (
                <AvatarFallback className="bg-ct-saffron/20 text-ct-saffron">
                  <Bot className="size-4" />
                </AvatarFallback>
              ) : (
                <AvatarFallback className="bg-ct-navy/10 text-ct-navy">{initials(name)}</AvatarFallback>
              )}
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className={cn("text-sm truncate", isActive ? "font-bold text-ct-navy" : "text-ct-navy")}>{name}</span>
                {c.unreadCount > 0 && (
                  <Badge className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full border-0 bg-ct-saffron text-white">
                    {c.unreadCount}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-ct-muted truncate">{c.lastMessage?.content ?? "No messages yet"}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
