"use client";

// Priority 18b (Owner directive 2026-07-15, Option B). A stage-0 user's
// ENTIRE authenticated surface -- intentionally outside (app)/ and AppShell
// (see AppShell.tsx's own comment on why: its widgets all assume a real
// orgId). Multi-org by design (Option B): fetches /api/stage0/inbox, which
// merges results across every org this person holds an active stage0Sources
// relationship with -- grouped by org in the UI below, matching the design
// doc's "the one place in the app that is deliberately not single-org-
// scoped" framing.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Loader2, Send, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type InboxItem =
  | { kind: "conversation"; id: string; title: string | null; updatedAt: string }
  | { kind: "task"; id: string; title: string; status: string; assignedById: string | null; dueDate: string | null }
  | { kind: "instruction"; id: string; describedAction: string; assignerId: string; status: string; dueDate: string | null };

type OrgInbox = { orgId: string; orgName: string; items: InboxItem[] };

type ThreadMessage = { id: string; senderId: string | null; content: string; createdAt: string };

export default function Stage0ChatPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgInbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeConvo, setActiveConvo] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/stage0/inbox");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        setError("Could not load your VERI Chat inbox");
        return;
      }
      const data = await res.json();
      setOrgs(data.orgs ?? []);
    } catch {
      setError("Could not load your VERI Chat inbox");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function openConversation(id: string) {
    setActiveConvo(id);
    const res = await fetch(`/api/stage0/conversations/${id}/messages`);
    if (res.ok) {
      const data = await res.json();
      setThread(data.messages ?? []);
    }
  }

  async function send() {
    const content = draft.trim();
    if (!content || !activeConvo || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/stage0/conversations/${activeConvo}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setDraft("");
        await openConversation(activeConvo);
      }
    } finally {
      setSending(false);
    }
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-ct-cream flex">
      <div className="w-72 shrink-0 border-r border-ct-border bg-white flex flex-col">
        <div className="bg-gradient-navy px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image src="/logo-mark.svg" alt="VERIDIAN AI" width={24} height={24} unoptimized />
            <p className="text-white text-sm font-semibold">VERI Chat</p>
          </div>
          <button onClick={signOut} className="text-white/70 hover:text-white" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : error ? (
            <p className="text-sm text-ct-error">{error}</p>
          ) : orgs.length === 0 ? (
            <p className="text-xs text-ct-muted">Nothing here yet -- messages, to-dos, and instructions sent to you will show up here.</p>
          ) : (
            orgs.map((org) => (
              <div key={org.orgId} className="space-y-2">
                <p className="text-[11px] font-semibold text-ct-muted uppercase">{org.orgName}</p>
                {org.items.filter((i) => i.kind === "conversation").map((i) => (
                  <button
                    key={i.id}
                    onClick={() => openConversation(i.id)}
                    className={`w-full text-left text-sm rounded-md px-2 py-1.5 ${activeConvo === i.id ? "bg-ct-teal text-white" : "hover:bg-ct-cloud text-ct-navy"}`}
                  >
                    {i.title ?? "Conversation"}
                  </button>
                ))}
                {org.items.filter((i) => i.kind === "task").map((i) => (
                  <div key={i.id} className="text-xs text-ct-navy px-2 py-1 rounded-md bg-ct-cloud/60">
                    To Do: {i.title} <span className="text-ct-muted">({i.status})</span>
                  </div>
                ))}
                {org.items.filter((i) => i.kind === "instruction").map((i) => (
                  <div key={i.id} className="text-xs text-ct-navy px-2 py-1 rounded-md bg-ct-cloud/60">
                    Instruction: {i.describedAction} <span className="text-ct-muted">({i.status})</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {!activeConvo ? (
          <div className="flex-1 flex items-center justify-center text-sm text-ct-muted">Select a conversation</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {thread.map((m) => (
                <div key={m.id} className={m.senderId === null ? "text-left" : "text-right"}>
                  <div className={`inline-block max-w-[70%] rounded-lg px-3 py-2 text-sm ${m.senderId === null ? "bg-ct-cloud text-ct-navy" : "bg-ct-teal text-white"}`}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-ct-border p-3 flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Type a message..."
                rows={1}
                className="flex-1 min-h-[36px] max-h-[160px] py-2 px-3 rounded-lg border border-ct-border text-sm resize-none overflow-y-auto"
              />
              <button
                onClick={send}
                disabled={!draft.trim() || sending}
                className="h-9 w-9 flex items-center justify-center rounded-lg bg-ct-teal text-white disabled:opacity-50"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
