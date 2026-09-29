"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module 16 of 24:
// port of PROJEXA's own JournalEntryObjectClient.tsx -- the General
// Ledger's Object Page: line items + a Submit (post to ledger) action.
// Reads GET /api/v1/projexa/journal-entries/{id} (getJournalEntry in
// erp-accounting-service.ts, returns the entry row with a `lines` array
// attached) and GET /api/v1/projexa/accounts (listAccounts, to resolve each
// line's accountId to a readable name/number) -- both already-native
// routes, zero new backend route.
//
// Submit posts to POST /api/v1/projexa/journal-entries/{id}/submit
// (submitJournalEntry). That route explicitly requires a real user session
// (ctx.dbUser), not just an API key, and requireRoleOrScope(ctx,
// "senior_professional") -- a lower-privileged user or a session gap
// surfaces the route's own honest error via toast rather than silently
// no-op'ing, same as PROJEXA's own screen comment on this exact gap.
// submitJournalEntry can also come back with `pendingApproval: true` if the
// org has an approval workflow configured for erp_journal_entry -- handled
// as an honest "submitted for approval" state below rather than assuming
// every submit always posts immediately.
//
// No Edit/Delete here: financial records are never physically edited or
// removed in this codebase once their lines are written (double-entry
// integrity) -- the only lifecycle transitions are draft -> submitted
// (this Submit action) or draft -> cancelled (voidDraftJournalEntry, an
// internal compensating rollback, not a user action). Matches PROJEXA's own
// scope for this screen exactly (display-only line table, one action).
//
// Rebuilt on this repo's own Card/Table/Select (matching
// src/app/(app)/purchase-orders/[id]/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Line = { id: string; accountId: string; debit: string; credit: string; remark: string | null };
type Entry = {
  id: string; entryNumber: number; postingDate: string; referenceType: string | null;
  userRemark: string | null; status: string; totalDebit: string; totalCredit: string; lines: Line[];
};
type Account = { id: string; accountName: string; accountNumber: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "default", cancelled: "destructive",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

export default function JournalEntryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const entryId = params.id;
  const currencies = useCurrencies();
  const money = (v: string | number) => `${currencyLabel(undefined, currencies)}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  const [entry, setEntry] = useState<Entry | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entryRes, acctRes] = await Promise.all([
        fetch(`/api/v1/projexa/journal-entries/${encodeURIComponent(entryId)}`),
        fetch("/api/v1/projexa/accounts").catch(() => null),
      ]);
      const entryBody = await entryRes.json().catch(() => null);
      if (!entryRes.ok) throw new Error(entryBody?.error ?? "Couldn't load this journal entry");
      setEntry(entryBody as Entry);
      if (acctRes && acctRes.ok) {
        const acctBody = await acctRes.json().catch(() => ({}));
        setAccounts(acctBody.accounts ?? []);
      }
      setLoadError(null);
    } catch (err) {
      setEntry(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this journal entry");
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => { void load(); }, [load]);

  async function submitEntry() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projexa/journal-entries/${encodeURIComponent(entryId)}/submit`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to submit journal entry");
      toast.success(body?.pendingApproval ? "Submitted for approval" : "Journal entry posted to the ledger");
      await load();
    } catch (err) {
      // Honest, expected failure if there's no real user session backing
      // this request (submitJournalEntry refuses an API-key-only actor) --
      // surfaced verbatim, not swallowed, matching PROJEXA's own screen note.
      toast.error(err instanceof Error ? err.message : "Couldn't submit journal entry");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !entry) {
    return (
      <div className="space-y-3">
        <Link href="/accounting?tab=ledger" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />Back to General Ledger
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Journal entry not found."}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  const isDraft = entry.status === "draft";

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/accounting?tab=ledger")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to General Ledger
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">Journal Entry #{entry.entryNumber}</h1>
            <Badge variant={STATUS_VARIANT[entry.status] ?? "outline"} className="capitalize">{entry.status}</Badge>
          </div>
          {isDraft && (
            <Button size="sm" disabled={submitting} onClick={submitEntry} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              {submitting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Send className="size-3.5 mr-1" />}
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          )}
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Posting Date: {formatDate(entry.postingDate)} &middot; Remark: {entry.userRemark ?? entry.referenceType ?? "—"} &middot; Total: {money(entry.totalDebit)} / {money(entry.totalCredit)}
        </p>
      </div>

      {isDraft && (
        <p className="text-xs text-ct-muted">Posting this entry into the General Ledger requires a real user session — if Submit fails, that session-identity gap is the reason.</p>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Line Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Account</TableHead><TableHead>Remark</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {entry.lines.map((l) => {
                const account = accounts.find((a) => a.id === l.accountId);
                return (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium text-ct-navy">{account ? `${account.accountNumber ? `${account.accountNumber} — ` : ""}${account.accountName}` : l.accountId}</TableCell>
                    <TableCell className="text-ct-muted">{l.remark ?? "—"}</TableCell>
                    <TableCell className="text-right">{Number(l.debit) > 0 ? money(l.debit) : "—"}</TableCell>
                    <TableCell className="text-right">{Number(l.credit) > 0 ? money(l.credit) : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
        <div className="flex justify-end gap-6 border-t border-ct-border px-4 py-3 text-sm">
          <div><span className="text-ct-muted">Total Debit: </span><span className="font-medium text-ct-navy">{money(entry.totalDebit)}</span></div>
          <div><span className="text-ct-muted">Total Credit: </span><span className="font-medium text-ct-navy">{money(entry.totalCredit)}</span></div>
        </div>
      </Card>

      {!isDraft && (
        <p className="text-xs text-ct-muted">
          {entry.status === "submitted" ? "Posted — financial records are never edited or removed once submitted." : "Cancelled/voided."}
        </p>
      )}
    </div>
  );
}
