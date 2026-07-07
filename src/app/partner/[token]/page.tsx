"use client";

// Wave 109 (Sales Engine): partner dashboard -- intentionally outside
// (app)/ and outside middleware's protected-route allowlist (tokenized,
// no auth session), mirroring /vendor-portal/[token]'s exact pattern.
// Never move this under (app)/.
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Loader2, Link2, Copy, Check, TrendingUp, Wallet, Briefcase } from "lucide-react";

type ReferralLink = { id: string; token: string; productKey: string | null; label: string | null; isActive: boolean; clickCount: number };
type RecentReferral = { id: string; productKey: string | null; status: string; clickedAt: string; paidAt: string | null };
type DashboardData = {
  partner: { name: string; partnerType: string; status: string };
  links: ReferralLink[];
  pipelineByStatus: Record<string, number>;
  commission: { accrued: number; paid: number; pending: number };
  recentReferrals: RecentReferral[];
};

const STATUS_LABELS: Record<string, string> = {
  clicked: "Clicked",
  signup_completed: "Signed up",
  org_provisioned: "Signed up",
  paid: "Paid",
  lost: "Lost",
};

function CopyLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/r/${token}` : `/r/${token}`;
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-ct-border text-xs font-medium text-ct-navy hover:bg-ct-cloud/50"
    >
      {copied ? <Check className="size-3.5 text-ct-teal" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

export default function PartnerDashboardPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/partner/${params.token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "This partner dashboard link is invalid or has expired");
      } else {
        setData(await res.json());
        setError(null);
      }
    } catch {
      setError("This partner dashboard link is invalid or has expired");
    } finally {
      setLoading(false);
    }
  }, [params.token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="size-6 animate-spin text-ct-teal" /></div>;
  if (error || !data) return <div className="flex items-center justify-center min-h-screen"><p className="text-sm text-ct-muted">{error}</p></div>;

  const pipelineEntries = Object.entries(data.pipelineByStatus);

  return (
    <div className="min-h-screen bg-ct-cloud/30 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">{data.partner.name}</h1>
          <p className="text-sm text-ct-muted capitalize">{data.partner.partnerType.replace(/_/g, " ")} · Partner Dashboard</p>
        </div>

        <div className="bg-white rounded-xl border border-ct-border p-4">
          <h2 className="text-sm font-semibold text-ct-navy flex items-center gap-2 mb-3"><Link2 className="size-4 text-ct-teal" /> Your Referral Links</h2>
          {data.links.length === 0 ? (
            <p className="text-xs text-ct-muted">No referral links yet -- contact your VERIDIAN AI OS contact to get one set up.</p>
          ) : (
            <div className="space-y-2">
              {data.links.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 border border-ct-border rounded-lg p-3">
                  <div>
                    <p className="text-sm font-medium text-ct-navy">{l.label ?? (l.productKey ?? "General")}</p>
                    <p className="text-xs text-ct-muted">{l.clickCount} click{l.clickCount === 1 ? "" : "s"}{!l.isActive ? " · inactive" : ""}</p>
                  </div>
                  <CopyLinkButton token={l.token} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-ct-border p-4">
            <h2 className="text-sm font-semibold text-ct-navy flex items-center gap-2 mb-3"><TrendingUp className="size-4 text-ct-teal" /> Pipeline</h2>
            {pipelineEntries.length === 0 ? (
              <p className="text-xs text-ct-muted">No referrals yet.</p>
            ) : (
              <div className="space-y-1.5">
                {pipelineEntries.map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between text-sm">
                    <span className="text-ct-slate">{STATUS_LABELS[status] ?? status}</span>
                    <span className="font-medium text-ct-navy">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-ct-border p-4">
            <h2 className="text-sm font-semibold text-ct-navy flex items-center gap-2 mb-3"><Wallet className="size-4 text-ct-teal" /> Commission</h2>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between"><span className="text-ct-slate">Accrued</span><span className="font-medium text-ct-navy">₹{data.commission.accrued.toLocaleString("en-IN")}</span></div>
              <div className="flex items-center justify-between"><span className="text-ct-slate">Paid</span><span className="font-medium text-ct-navy">₹{data.commission.paid.toLocaleString("en-IN")}</span></div>
              <div className="flex items-center justify-between border-t border-ct-border pt-1.5"><span className="text-ct-slate">Pending</span><span className="font-semibold text-ct-saffron">₹{data.commission.pending.toLocaleString("en-IN")}</span></div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-ct-border p-4">
          <h2 className="text-sm font-semibold text-ct-navy flex items-center gap-2 mb-3"><Briefcase className="size-4 text-ct-teal" /> Recent Referrals</h2>
          {data.recentReferrals.length === 0 ? (
            <p className="text-xs text-ct-muted">No referrals yet -- share your link above to get started.</p>
          ) : (
            <div className="space-y-1.5">
              {data.recentReferrals.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs text-ct-muted border-b border-ct-border/60 last:border-0 py-1.5">
                  <span>{r.productKey ?? "General"}</span>
                  <span>{new Date(r.clickedAt).toLocaleDateString()}</span>
                  <span className="font-medium text-ct-navy">{STATUS_LABELS[r.status] ?? r.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
