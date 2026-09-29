"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module 16 of 24:
// port of PROJEXA's own JournalEntryCreateClient.tsx -- a repeatable
// double-entry line editor (account/debit/credit, add/remove a row, at
// least 2 lines required) with a live debit/credit balance check. POSTs to
// the SAME POST /api/v1/projexa/journal-entries this app's backend already
// serves (createJournalEntry in erp-accounting-service.ts) -- zero new
// backend route. That route inserts a DRAFT entry only (requirePermission
// "erp.journal_entries.create", policy "member") -- submitting/posting it
// is a separate action on the Object Page (journal-entries/[id]/page.tsx),
// matching PROJEXA's own scope split exactly.
//
// The account picker reads GET /api/v1/projexa/accounts (listAccounts in
// erp-accounting-service.ts) -- same route the Object Page uses.
//
// Rebuilt on this repo's own Card/Input/Select (matching
// src/app/(app)/purchase-orders/new/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Account = { id: string; accountName: string; accountNumber: string | null };
type JeLine = { accountId: string; debit: string; credit: string };

function blankLine(): JeLine {
  return { accountId: "", debit: "", credit: "" };
}

export default function JournalEntryNewPage() {
  const router = useRouter();
  const currencies = useCurrencies();
  const label = currencyLabel(undefined, currencies);

  const [accounts, setAccounts] = useState<Account[]>([]);
  // R80 E2E-rewrite fix PROJEXA's own screen carries (2026-09-08): a real
  // loaded flag distinct from "accounts is empty", so an org with genuinely
  // zero chart-of-accounts rows shows "No accounts found" instead of a
  // placeholder stuck on "Loading…" forever.
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [userRemark, setUserRemark] = useState("");
  const [lines, setLines] = useState<JeLine[]>([blankLine(), blankLine()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/accounts")
      .then((r) => r.json())
      .then((data) => setAccounts(data.accounts ?? []))
      .catch(() => {})
      .finally(() => setAccountsLoaded(true));
  }, []);

  function updateLine(idx: number, patch: Partial<JeLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const balanced = lines.length >= 2 && Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;
  const linesWithAccount = lines.filter((l) => l.accountId);

  async function createEntry() {
    if (!balanced) {
      toast.error("Debit and credit totals must match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/journal-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postingDate,
          userRemark: userRemark || undefined,
          lines: linesWithAccount.map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to create journal entry");
      toast.success("Journal entry drafted");
      router.push(`/accounting/journal-entries/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create journal entry");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Journal Entry</h1>
        <p className="text-sm text-ct-muted mt-1">General Ledger / New Journal Entry</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Entry Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Posting Date</Label>
              <Input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Remark</Label>
              <Input value={userRemark} onChange={(e) => setUserRemark(e.target.value)} placeholder="e.g. Site 4 material accrual" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Lines (double-entry — debit must equal credit)</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, blankLine()])}>Add Line</Button>
            </div>
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_100px_100px_36px] items-center gap-1.5">
                <Select value={line.accountId} onValueChange={(v) => updateLine(idx, { accountId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder={accounts.length ? "Account" : !accountsLoaded ? "Loading…" : "No accounts found"} />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" placeholder="Debit" value={line.debit} onChange={(e) => updateLine(idx, { debit: e.target.value, credit: e.target.value ? "" : line.credit })} />
                <Input type="number" placeholder="Credit" value={line.credit} onChange={(e) => updateLine(idx, { credit: e.target.value, debit: e.target.value ? "" : line.debit })} />
                <Button variant="ghost" size="icon" disabled={lines.length <= 2} onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}>
                  <Trash2 className="size-4 text-red-500" />
                </Button>
              </div>
            ))}
          </div>

          <div className={`rounded-md border p-2 text-sm ${balanced ? "border-green-300 bg-green-50 text-green-700" : "border-amber-300 bg-amber-50 text-amber-700"}`}>
            Debit {label}{totalDebit.toLocaleString("en-IN", { maximumFractionDigits: 2 })} &middot; Credit {label}{totalCredit.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {balanced ? "— balanced" : "— must balance before posting"}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/accounting?tab=ledger")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={createEntry}
          disabled={submitting || !balanced}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Creating..." : "Create Journal Entry"}
        </Button>
      </div>
    </div>
  );
}
