"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 42 (VERI FDE -- Forward Deployed AI, PLATFORM_STRATEGY.md §23).
// Describe a capability in plain language; VERI FDE checks it against the
// org's existing worker agents/modules/automation rules and either points
// to what already covers it, or drafts a new Worker Agent proposal through
// the existing Wave 16 human-approval pipeline -- it never creates
// anything unilaterally.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, CheckCircle2, Wrench, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type FdeRequest = {
  id: string; requestText: string; status: string; matchedLabel: string | null;
  createdWorkerAgentId: string | null; responseText: string; createdAt: string;
};

const STATUS_META: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  matched_existing: { label: "Already covered", color: "bg-ct-teal/20 text-ct-teal", icon: CheckCircle2 },
  proposed_agent: { label: "Proposing new agent", color: "bg-ct-saffron/20 text-ct-saffron", icon: Wrench },
  // Wave 46 (VERIDIAN AI Constitution): the Policy Enforcement Engine
  // refused this request before it ever reached an AI model -- deliberately
  // NOT labeled "Denied" in this user-facing badge.
  not_part_of_work: { label: "Not Part of Work", color: "bg-ct-cloud text-ct-muted", icon: AlertCircle },
  error: { label: "Error", color: "bg-red-100 text-red-700", icon: AlertCircle },
};

export default function FdePage() {
  const [requests, setRequests] = useState<FdeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestText, setRequestText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/fde/requests");
    const data = await res.json();
    setRequests(data.requests ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!requestText.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/fde/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestText }),
      });
      if (!res.ok) throw new Error();
      setRequestText("");
      load();
    } catch {
      toast.error("Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-ct-saffron" />
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">VERI FDE</h1>
          <p className="text-sm text-ct-muted mt-1">Describe a capability you want -- VERI FDE checks it against everything VERIDIAN already has, and only proposes a new Worker Agent (pending admin approval) if nothing already covers it.</p>
        </div>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="pt-5 space-y-3">
          <Textarea
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
            placeholder="e.g. I want to automatically flag any GST notice with a demand over ₹1 lakh for review"
            className="min-h-[80px] text-sm"
          />
          <Button onClick={submit} disabled={submitting || !requestText.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
            {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Sparkles className="size-4 mr-2" />}
            Ask VERI FDE
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-ct-muted">No requests yet.</p>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const meta = STATUS_META[req.status] ?? STATUS_META.error;
            const Icon = meta.icon;
            return (
              <Card key={req.id} className="rounded-xl shadow-card bg-white">
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-ct-navy">{req.requestText}</p>
                    <Badge className={`text-xs border-0 shrink-0 ${meta.color}`}>
                      <Icon className="size-3 mr-1" /> {meta.label}
                    </Badge>
                  </div>
                  <p className="text-sm text-ct-muted">{req.responseText}</p>
                  <p className="text-[11px] text-ct-muted">{new Date(req.createdAt).toLocaleString()}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
