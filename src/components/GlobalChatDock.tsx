"use client";

// Wave 48: the persistent, Claude-Desktop-style command bar validated across
// both the mobile and laptop pastel mockups, brought into production as one
// real component -- auto-grows with the text (textarea, not <input>), and is
// mounted once in AppShell so it's present on every authenticated screen on
// every device. Presentation adapts via pure CSS breakpoints (full-width bar
// on mobile, centered floating bar offset past the sidebar on desktop) --
// deliberately not UA-sniffed, since CSS media queries stay correct when a
// desktop window is resized narrow, which UA detection alone would miss.
//
// Hidden on /veri-ai and /chat: those pages already have their own dedicated,
// full-height composer (Wave 37) -- showing a second one on top would be
// redundant. Everywhere else, this is the only way to reach VERI AI.
//
// Sends always go to the org's pinned AI thread (the same one /veri-ai
// opens by default) -- routing into whatever specific human conversation a
// user has open elsewhere would need cross-page state this component
// doesn't have visibility into; a real follow-up, not faked here.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Send, Loader2, Paperclip } from "lucide-react";
import { useAutoGrowTextarea } from "@/lib/use-autogrow-textarea";

// Home 2 has its own full composer -- showing the dock on top of it would be
// a second, redundant chat box (demo feedback). Same reason /veri-ai and
// /chat are hidden.
const HIDDEN_PREFIXES = ["/veri-ai", "/chat", "/home-2", "/login", "/signup"];

export function isDockHiddenForPath(pathname: string | null): boolean {
  return HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p));
}

export default function GlobalChatDock() {
  const pathname = usePathname();
  const hidden = isDockHiddenForPath(pathname);

  const [aiThreadId, setAiThreadId] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const textareaRef = useAutoGrowTextarea(value, 200);
  const draftKeyRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Restore any draft the moment we know who the user is -- namespaced
    // per user so a shared/kiosk machine never shows one person's draft to
    // another. Done inside this same fetch callback (not a separate effect
    // keyed off userId) so the localStorage read stays async-callback-scoped
    // rather than a synchronous setState-in-effect.
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.id) return;
        const key = `veridian-dock-draft:${d.id}`;
        draftKeyRef.current = key;
        try {
          const saved = window.localStorage.getItem(key);
          if (saved) setValue(saved);
        } catch {
          // localStorage unavailable (private browsing, etc.) -- draft
          // persistence just silently doesn't happen, nothing else breaks.
        }
      })
      .catch(() => {});
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((d) => {
        const ai = (d?.conversations ?? []).find((c: { isAiThread: boolean }) => c.isAiThread);
        if (ai) setAiThreadId(ai.id);
      })
      .catch(() => {});
  }, []);

  const onChange = (next: string) => {
    setValue(next);
    if (!draftKeyRef.current) return;
    try {
      if (next) window.localStorage.setItem(draftKeyRef.current, next);
      else window.localStorage.removeItem(draftKeyRef.current);
    } catch {
      // Same as above -- best-effort only.
    }
  };

  const send = async () => {
    const text = value.trim();
    if (!text || sending) return;
    if (!aiThreadId) {
      toast.error("VERI AI isn't ready yet — try again in a moment");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${aiThreadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) throw new Error();
      onChange("");
      toast.success("Sent to VERI AI");
    } catch {
      toast.error("Failed to send — please try again");
    } finally {
      setSending(false);
    }
  };

  // Attachment pin (demo feedback): upload the file, post a message that
  // carries it, then link it -- same document-attachment plumbing /veri-ai
  // uses, so a file dropped here becomes a real attachment on the AI thread.
  const attachFile = async (file: File) => {
    if (!aiThreadId || attaching) return;
    setAttaching(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await fetch("/api/documents", { method: "POST", body: form });
      if (!uploadRes.ok) throw new Error();
      const doc = await uploadRes.json();
      const res = await fetch(`/api/conversations/${aiThreadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value.trim() || `Here's a document for you: ${doc.name}` }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const messageId = data.message?.id;
      if (messageId) {
        await fetch(`/api/veri-chat/messages/${messageId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: doc.id }),
        }).catch(() => {});
      }
      onChange("");
      toast.success("Sent to your AI Assistant");
    } catch {
      toast.error("Couldn't attach that file — please try again");
    } finally {
      setAttaching(false);
    }
  };

  if (hidden) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 lg:left-[220px] z-40 flex justify-center px-3 pb-3 pt-1 sm:px-6 sm:pb-5 pointer-events-none">
      <div className="w-full sm:max-w-[760px] pointer-events-auto">
        <div className="rounded-2xl bg-white border border-ct-border shadow-lg px-4 pt-3.5 pb-2.5">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Tell your AI Assistant what to do…"
            className="w-full bg-transparent text-[15px] text-ct-navy placeholder:text-ct-muted focus:outline-none resize-none max-h-[200px] overflow-y-auto"
          />
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={attaching || !aiThreadId}
                title="Attach a document"
                className="grid size-9 place-items-center rounded-lg text-ct-muted hover:bg-ct-cloud hover:text-ct-slate transition-colors disabled:opacity-50"
              >
                {attaching ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-[18px]" />}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) attachFile(f); e.target.value = ""; }}
              />
              <span className="text-[11px] text-ct-muted hidden sm:inline">Your AI Assistant</span>
            </div>
            <button
              type="button"
              onClick={send}
              disabled={sending || !value.trim()}
              className="size-9 rounded-lg bg-ct-saffron hover:bg-ct-saffron-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-white transition-colors"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-[18px]" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
