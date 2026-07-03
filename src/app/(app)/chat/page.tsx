"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ConversationList, type ConversationSummary } from "@/components/chat/ConversationList";
import { ThreadView } from "@/components/chat/ThreadView";

const POLL_MS = 8000;

type OrgUser = { id: string; name: string };

export default function ChatPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [pickerUserId, setPickerUserId] = useState<string>("");
  const [showPicker, setShowPicker] = useState(false);

  function loadConversations() {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => {
        const list: ConversationSummary[] = data.conversations ?? [];
        setConversations(list);
        setSelectedId((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch(() => {});
  }

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setCurrentUserId(d.id));
    fetch("/api/users").then((r) => r.json()).then((d) => setOrgUsers(d.users ?? []));
    loadConversations();
    const interval = setInterval(loadConversations, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  async function startConversation() {
    if (!pickerUserId) return;
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantUserIds: [pickerUserId] }),
    });
    if (res.ok) {
      const created = await res.json();
      setShowPicker(false);
      setPickerUserId("");
      loadConversations();
      setSelectedId(created.id);
    }
  }

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const otherOrgUsers = orgUsers.filter(
    (u) => u.id !== currentUserId && !conversations.some((c) => c.otherParticipants.some((p) => p.id === u.id))
  );

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-heading text-xl text-ct-navy">Chat</h1>
        <Button size="sm" variant="outline" onClick={() => setShowPicker((s) => !s)}>
          <Plus className="size-4 mr-1" /> New conversation
        </Button>
      </div>

      {showPicker && (
        <div className="flex items-center gap-2 mb-3 p-3 rounded-lg border border-ct-border bg-white">
          <Select value={pickerUserId} onValueChange={setPickerUserId}>
            <SelectTrigger className="w-[220px] h-9">
              <SelectValue placeholder="Choose a person" />
            </SelectTrigger>
            <SelectContent>
              {otherOrgUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={startConversation} disabled={!pickerUserId}>Start</Button>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-[280px_1fr] rounded-lg border border-ct-border bg-white overflow-hidden">
        <div className="border-r border-ct-border overflow-hidden">
          <ConversationList conversations={conversations} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className="overflow-hidden">
          {selected && currentUserId ? (
            <ThreadView key={selected.id} conversation={selected} currentUserId={currentUserId} />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-ct-muted">
              {conversations.length === 0 ? "Loading..." : "Select a conversation"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
