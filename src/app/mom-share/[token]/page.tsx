"use client";

// Intentionally outside (app)/ and outside middleware's protected-route
// allowlist -- read-only public share view (Wave 44, PLATFORM_STRATEGY.md
// §25), mirroring /guest-chat/[token]'s exact pattern. Never move under (app)/.
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { Loader2, CheckCircle2 } from "lucide-react";

type ActionItem = { id: string; task: { id: string; title: string; status: string } };
type SharedMeeting = {
  title: string; meetingType: string; scheduledAt: string; systemId: string | null;
  attendees: string[]; agenda: string[]; minutes: string | null; actionItems: ActionItem[];
};

export default function MomSharePage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<SharedMeeting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/veri-meetings/share/${params.token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "This share link is invalid or has expired");
      } else {
        setData(await res.json());
        setError(null);
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
    <div className="min-h-screen bg-ct-cream flex items-start justify-center p-6">
      <div className="w-full max-w-2xl rounded-xl border border-ct-border bg-white shadow-card overflow-hidden">
        <div className="bg-gradient-navy px-6 py-4 flex items-center gap-3">
          <Image src="/logo-mark.svg" alt="Veridian AI" width={28} height={28} unoptimized />
          <div>
            <p className="text-white text-sm font-semibold">{data?.title || "Minutes of Meeting"}</p>
            <p className="text-white/60 text-[11px]">{data?.systemId || "Shared via VERI Minutes of Meetings"}</p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {loading ? (
            <p className="text-sm text-ct-muted flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading...</p>
          ) : error ? (
            <p className="text-sm text-ct-error">{error}</p>
          ) : data ? (
            <>
              <div className="space-y-1">
                <p className="text-sm text-ct-muted">{new Date(data.scheduledAt).toLocaleString()}</p>
                {data.attendees.length > 0 && (
                  <p className="text-sm text-ct-muted">Attendees: {data.attendees.join(", ")}</p>
                )}
              </div>

              {data.agenda.length > 0 && (
                <div>
                  <h2 className="text-xs font-semibold text-ct-navy uppercase tracking-wide mb-2">Agenda</h2>
                  <ul className="list-disc list-inside text-sm text-ct-navy space-y-1">
                    {data.agenda.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}

              <div>
                <h2 className="text-xs font-semibold text-ct-navy uppercase tracking-wide mb-2">Minutes</h2>
                <p className="text-sm text-ct-navy whitespace-pre-wrap">{data.minutes || "(no minutes recorded)"}</p>
              </div>

              {data.actionItems.length > 0 && (
                <div>
                  <h2 className="text-xs font-semibold text-ct-navy uppercase tracking-wide mb-2">Action Items</h2>
                  <div className="space-y-2">
                    {data.actionItems.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="size-3.5 text-ct-teal shrink-0" />
                        <span className="flex-1 text-ct-navy">{item.task.title}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-ct-cloud text-ct-navy">{item.task.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
