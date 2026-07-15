"use client";

// Priority 18a (VERI Chat second-screen unification): the public rendering
// half of createMeetingShareLink (Wave 44) -- the backend (createMeetingShareLink,
// getMeetingByShareToken, GET /api/veri-meetings/share/[token]) already existed
// and worked end-to-end; nothing rendered it publicly. Mirrors
// /shared/conversation/[token]/page.tsx's exact shape/rationale (the one
// legitimate public page pattern in this codebase, outside (app)/ and
// outside middleware's protected-route allowlist -- never move this under
// (app)/) since this is the same class of surface, just for meeting minutes
// instead of a chat transcript.
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";

type SharedActionItem = { id: string; task: { title: string; status: string } | null };
type SharedMeeting = {
  title: string;
  meetingType: string;
  scheduledAt: string;
  attendees: string[];
  agenda: string[];
  minutes: string | null;
  systemId: string | null;
  actionItems: SharedActionItem[];
};

export default function SharedMeetingPage() {
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
            <p className="text-white text-sm font-semibold">{data?.title || "Shared Meeting"}</p>
            <p className="text-white/60 text-[11px]">
              {data?.systemId ? `${data.systemId} · ` : ""}Read-only, shared from VERI Meetings
            </p>
          </div>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : error ? (
            <p className="text-sm text-ct-error">{error}</p>
          ) : (
            <>
              <div className="text-xs text-ct-muted">
                {new Date(data!.scheduledAt).toLocaleString()} · {data!.meetingType.replace(/_/g, " ")}
                {data!.attendees.length > 0 && <> · {data!.attendees.join(", ")}</>}
              </div>
              {data!.agenda.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ct-navy mb-1">Agenda</p>
                  <ul className="list-disc list-inside text-sm text-ct-slate space-y-0.5">
                    {data!.agenda.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
              {data!.minutes && (
                <div>
                  <p className="text-xs font-semibold text-ct-navy mb-1">Minutes</p>
                  <p className="text-sm text-ct-slate whitespace-pre-wrap">{data!.minutes}</p>
                </div>
              )}
              {data!.actionItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ct-navy mb-1">Action items</p>
                  <ul className="space-y-1">
                    {data!.actionItems.map((ai) => (
                      <li key={ai.id} className="text-sm text-ct-slate flex items-center gap-2">
                        <span className={`size-1.5 rounded-full shrink-0 ${ai.task?.status === "completed" ? "bg-emerald-500" : "bg-ct-saffron"}`} />
                        {ai.task?.title ?? "Untitled"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
