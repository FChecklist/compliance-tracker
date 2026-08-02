"use client";

// Intentionally outside (app)/ and outside middleware's protected-route
// allowlist -- this is the one legitimate public page in this codebase,
// existing specifically to back wa.me/t.me share-out links
// (PLATFORM_STRATEGY.md §16.2). Never move this under (app)/.
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import Stage0SignupForm from "@/components/Stage0SignupForm";

type SharedMessage = { senderId: string | null; content: string; createdAt: string };
type SharedConversation = { title: string | null; messages: SharedMessage[] };

export default function SharedConversationPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<SharedConversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/shared/conversation/${params.token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "This share link is invalid or has expired");
      } else {
        setData(await res.json());
      }
    } catch {
      setError("This share link is invalid or has expired");
    } finally {
      setLoading(false);
    }
  }, [params.token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-ct-cream flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-ct-border bg-white shadow-card overflow-hidden">
        <div className="bg-gradient-navy px-5 py-4 flex items-center gap-3">
          <Image src="/logo-mark.svg" alt="VERIDIAN AI" width={28} height={28} unoptimized />
          <div>
            <p className="text-white text-sm font-semibold">{data?.title || "Shared Conversation"}</p>
            <p className="text-white/60 text-[11px]">Read-only, shared from VERI Chat</p>
          </div>
        </div>
        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : error ? (
            <p className="text-sm text-ct-error">{error}</p>
          ) : (
            <>
              {/* Priority 18b (Owner directive 2026-07-15): identical CTA to
                  guest-chat/[token] -- both are "someone shared this with
                  you" entry points, per the design doc's symmetry note. */}
              <Stage0SignupForm token={params.token} />
              {data?.messages.map((m, i) => (
              <div key={i} className={m.senderId === null ? "text-left" : "text-right"}>
                <div className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.senderId === null ? "bg-ct-cloud text-ct-navy" : "bg-ct-teal text-white"}`}>
                  {m.content}
                </div>
              </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
