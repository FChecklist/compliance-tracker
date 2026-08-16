"use client";

// Intentionally outside (app)/ and outside middleware's protected-route
// allowlist -- the vendor self-service portal (Wave 80), mirroring
// /guest-chat/[token]'s pattern (tokenized, no auth session). Never move
// this under (app)/.
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Loader2, ShieldCheck, ShieldAlert, Landmark, FileText, Gavel } from "lucide-react";

type BankAccount = { id: string; accountHolderName: string; bankName: string; accountNumberMasked: string; ifscCode: string | null };
type KycDoc = { id: string; name: string; category: string | null; expiryDate: string | null };
type PortalData = {
  supplierName: string; qualificationStatus: string; sanctionScreeningStatus: string;
  bankAccounts: BankAccount[]; kycDocuments: KycDoc[];
};

// Wave 83 (RFQ enhancements): reverse auction bidding, reusing this same
// portal token -- no second invite mechanism for suppliers.
type ActiveAuction = { id: string; rfqId: string; endAt: string; currentLowestBid: string | null; isCurrentLeader: boolean };

export default function VendorPortalPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [holder, setHolder] = useState("");
  const [bank, setBank] = useState("");
  const [number, setNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const [auctions, setAuctions] = useState<ActiveAuction[]>([]);
  const [bidAmounts, setBidAmounts] = useState<Record<string, string>>({});
  const [biddingId, setBiddingId] = useState<string | null>(null);
  const [bidMessage, setBidMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/vendor-portal/${params.token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "This vendor portal link is invalid or has expired");
      } else {
        setData(await res.json());
        setError(null);
      }
    } catch {
      setError("This vendor portal link is invalid or has expired");
    } finally {
      setLoading(false);
    }
  }, [params.token]);

  const loadAuctions = useCallback(async () => {
    const res = await fetch(`/api/vendor-portal/${params.token}/auctions`);
    if (res.ok) {
      const d = await res.json();
      setAuctions(d.auctions ?? []);
    }
  }, [params.token]);

  useEffect(() => { load(); loadAuctions(); }, [load, loadAuctions]);

  const submitBid = async (auctionId: string) => {
    const amount = bidAmounts[auctionId];
    if (!amount) return;
    setBiddingId(auctionId);
    setBidMessage(null);
    try {
      const res = await fetch(`/api/vendor-portal/${params.token}/auctions/${auctionId}/bid`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bidAmount: Number(amount) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to submit bid");
      setBidMessage("Bid submitted -- you're now the leader.");
      setBidAmounts((prev) => ({ ...prev, [auctionId]: "" }));
      loadAuctions();
    } catch (err) {
      setBidMessage(err instanceof Error ? err.message : "Failed to submit bid");
    } finally {
      setBiddingId(null);
    }
  };

  const submitBankAccount = async () => {
    setSubmitting(true);
    setSubmitMessage(null);
    try {
      const res = await fetch(`/api/vendor-portal/${params.token}/bank-account`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountHolderName: holder, bankName: bank, accountNumber: number, ifscCode: ifsc || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to submit");
      setSubmitMessage("Bank account submitted -- pending internal review before it's used for payments.");
      setHolder(""); setBank(""); setNumber(""); setIfsc("");
      load();
    } catch (err) {
      setSubmitMessage(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="size-6 animate-spin text-ct-teal" /></div>;
  if (error || !data) return <div className="flex items-center justify-center min-h-screen"><p className="text-sm text-ct-muted">{error}</p></div>;

  return (
    <div className="min-h-screen bg-ct-cloud/30 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">{data.supplierName}</h1>
          <p className="text-sm text-ct-muted">Vendor Self-Service Portal</p>
        </div>

        <div className="bg-white rounded-xl border border-ct-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-ct-teal" /> Qualification status: <span className="font-medium">{data.qualificationStatus.replace("_", " ")}</span></div>
          <div className="flex items-center gap-2 text-sm"><ShieldAlert className="size-4 text-ct-teal" /> Sanction screening status: <span className="font-medium">{data.sanctionScreeningStatus.replace("_", " ")}</span></div>
        </div>

        {auctions.length > 0 && (
          <div className="bg-white rounded-xl border border-ct-border p-4 space-y-3">
            <h2 className="text-sm font-semibold text-ct-navy flex items-center gap-2"><Gavel className="size-4 text-ct-teal" /> Active Reverse Auctions</h2>
            {auctions.map((a) => (
              <div key={a.id} className="border border-ct-border rounded-lg p-3 space-y-2">
                <p className="text-xs text-ct-muted">Ends {new Date(a.endAt).toLocaleString()}</p>
                <p className="text-sm text-ct-navy">
                  Current lowest bid: <span className="font-medium">{a.currentLowestBid ?? "No bids yet"}</span>
                  {a.isCurrentLeader && <span className="text-ct-teal ml-2">(You're leading)</span>}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={bidAmounts[a.id] ?? ""}
                    onChange={(e) => setBidAmounts((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    placeholder="Your bid (must undercut current lowest)"
                    className="flex-1 h-9 text-sm rounded-md border border-ct-border px-3"
                  />
                  <button
                    onClick={() => submitBid(a.id)}
                    disabled={!bidAmounts[a.id] || biddingId === a.id}
                    className="h-9 px-3 rounded-md bg-ct-saffron text-white text-sm font-medium disabled:opacity-50"
                  >
                    {biddingId === a.id ? <Loader2 className="size-4 animate-spin" /> : "Bid"}
                  </button>
                </div>
              </div>
            ))}
            {bidMessage && <p className="text-xs text-ct-muted">{bidMessage}</p>}
          </div>
        )}

        <div className="bg-white rounded-xl border border-ct-border p-4 space-y-2">
          <h2 className="text-sm font-semibold text-ct-navy flex items-center gap-2"><FileText className="size-4 text-ct-teal" /> KYC Documents on File</h2>
          {data.kycDocuments.length === 0 ? <p className="text-xs text-ct-muted">No KYC documents on file yet.</p> : data.kycDocuments.map((d) => (
            <p key={d.id} className="text-xs text-ct-muted">{d.name} ({d.category ?? "uncategorized"})</p>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-ct-border p-4 space-y-3">
          <h2 className="text-sm font-semibold text-ct-navy flex items-center gap-2"><Landmark className="size-4 text-ct-teal" /> Bank Accounts on File</h2>
          {data.bankAccounts.length === 0 ? <p className="text-xs text-ct-muted">No bank accounts on file yet.</p> : data.bankAccounts.map((b) => (
            <p key={b.id} className="text-xs text-ct-muted">{b.bankName} {b.accountNumberMasked} -- {b.accountHolderName}</p>
          ))}

          <div className="border-t border-ct-border pt-3 space-y-2">
            <p className="text-xs font-semibold text-ct-navy uppercase">Submit New Bank Account</p>
            <input className="w-full h-9 text-sm rounded-md border border-ct-border px-3" placeholder="Account holder name" value={holder} onChange={(e) => setHolder(e.target.value)} />
            <input className="w-full h-9 text-sm rounded-md border border-ct-border px-3" placeholder="Bank name" value={bank} onChange={(e) => setBank(e.target.value)} />
            <input className="w-full h-9 text-sm rounded-md border border-ct-border px-3" placeholder="Account number" value={number} onChange={(e) => setNumber(e.target.value)} />
            <input className="w-full h-9 text-sm rounded-md border border-ct-border px-3" placeholder="IFSC code (optional)" value={ifsc} onChange={(e) => setIfsc(e.target.value)} />
            <button
              onClick={submitBankAccount}
              disabled={submitting || !holder || !bank || number.length < 4}
              className="w-full h-9 rounded-md bg-ct-saffron hover:bg-ct-saffron-hover text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />} Submit
            </button>
            {submitMessage && <p className="text-xs text-ct-muted">{submitMessage}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
