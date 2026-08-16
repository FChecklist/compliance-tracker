"use client";

export const dynamic = "force-dynamic";

// Wave 52 (VERI ERP gap-fill, Tier 2 #3): Cash Management -- petty cash,
// cash receipts/payments, each posting a real balanced journal entry
// immediately (see erp-cash-service.ts).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Account = { id: string; accountName: string; accountNumber: string | null };
type CashAccount = { id: string; accountName: string; isPettyCash: boolean; glAccountId: string | null };
type Voucher = { id: string; voucherNumber: number; voucherType: string; amount: string; postingDate: string; status: string };

export default function ErpCashManagementPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);

  const [caOpen, setCaOpen] = useState(false);
  const [caName, setCaName] = useState("");
  const [caGlAccountId, setCaGlAccountId] = useState("");
  const [caPetty, setCaPetty] = useState(false);
  const [creatingCa, setCreatingCa] = useState(false);

  const [vOpen, setVOpen] = useState(false);
  const [vCashAccountId, setVCashAccountId] = useState("");
  const [vType, setVType] = useState("receipt");
  const [vAmount, setVAmount] = useState("");
  const [vAgainstAccountId, setVAgainstAccountId] = useState("");
  const [vDate, setVDate] = useState(new Date().toISOString().slice(0, 10));
  const [vRemark, setVRemark] = useState("");
  const [creatingV, setCreatingV] = useState(false);

  const load = useCallback(() => {
    Promise.all([fetch("/api/erp/accounts"), fetch("/api/erp/cash-accounts"), fetch("/api/erp/cash-vouchers")])
      .then(([acctRes, caRes, vRes]) => Promise.all([acctRes.json(), caRes.json(), vRes.json()]))
      .then(([acctData, caData, vData]) => {
        setAccounts(acctData.accounts ?? []);
        setCashAccounts(caData.cashAccounts ?? []);
        setVouchers(vData.vouchers ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const createCashAccount = async () => {
    if (!caName.trim()) return;
    setCreatingCa(true);
    const res = await fetch("/api/erp/cash-accounts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountName: caName, glAccountId: caGlAccountId || undefined, isPettyCash: caPetty }),
    });
    setCreatingCa(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create cash account"); return; }
    setCaOpen(false); setCaName(""); setCaGlAccountId(""); setCaPetty(false);
    toast.success("Cash account created");
    load();
  };

  const createVoucher = async () => {
    setCreatingV(true);
    const res = await fetch("/api/erp/cash-vouchers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cashAccountId: vCashAccountId, voucherType: vType, amount: Number(vAmount) || 0,
        againstAccountId: vAgainstAccountId, postingDate: vDate, remark: vRemark || undefined,
      }),
    });
    setCreatingV(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create voucher"); return; }
    setVOpen(false); setVAmount(""); setVRemark("");
    toast.success("Cash voucher posted");
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Cash Management</h1>
        <p className="text-sm text-ct-muted mt-1">Petty cash &amp; cash accounts, receipts and payments — VERI ERP AI</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-ct-navy">Cash Accounts</h3>
              <Dialog open={caOpen} onOpenChange={setCaOpen}>
                <DialogTrigger asChild><Button size="sm" className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-3 h-3 mr-1" />New</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Cash Account</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div><Label>Account Name</Label><Input value={caName} onChange={(e) => setCaName(e.target.value)} placeholder="e.g. Head Office Petty Cash" /></div>
                    <div><Label>GL Account (balance-sheet)</Label>
                      <Select value={caGlAccountId} onValueChange={setCaGlAccountId}>
                        <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={caPetty} onChange={(e) => setCaPetty(e.target.checked)} />Petty cash</label>
                  </div>
                  <DialogFooter><Button onClick={createCashAccount} disabled={creatingCa} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingCa && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Create</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-ct-border">
                {cashAccounts.length === 0 ? <tr><td className="p-4 text-center text-ct-muted">No cash accounts yet.</td></tr>
                  : cashAccounts.map((c) => <tr key={c.id}><td className="p-2">{c.accountName}</td><td className="p-2">{c.isPettyCash && <Badge className="bg-ct-cloud text-ct-muted">Petty Cash</Badge>}</td></tr>)}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-ct-navy">Post Voucher</h3>
              <Dialog open={vOpen} onOpenChange={setVOpen}>
                <DialogTrigger asChild><Button size="sm" className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-3 h-3 mr-1" />New</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Cash Voucher</DialogTitle><DialogDescription>Posts immediately to the general ledger.</DialogDescription></DialogHeader>
                  <div className="space-y-3">
                    <div><Label>Cash Account</Label>
                      <Select value={vCashAccountId} onValueChange={setVCashAccountId}>
                        <SelectTrigger><SelectValue placeholder="Select cash account" /></SelectTrigger>
                        <SelectContent>{cashAccounts.map((c) => <SelectItem key={c.id} value={c.id}>{c.accountName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Type</Label>
                      <Select value={vType} onValueChange={setVType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="receipt">Receipt (money in)</SelectItem><SelectItem value="payment">Payment (money out)</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div><Label>Against Account</Label>
                      <Select value={vAgainstAccountId} onValueChange={setVAgainstAccountId}>
                        <SelectTrigger><SelectValue placeholder="e.g. Sales Revenue, Office Expense" /></SelectTrigger>
                        <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Amount</Label><Input type="number" value={vAmount} onChange={(e) => setVAmount(e.target.value)} /></div>
                      <div><Label>Date</Label><Input type="date" value={vDate} onChange={(e) => setVDate(e.target.value)} /></div>
                    </div>
                    <div><Label>Remark</Label><Input value={vRemark} onChange={(e) => setVRemark(e.target.value)} placeholder="Optional" /></div>
                  </div>
                  <DialogFooter><Button onClick={createVoucher} disabled={creatingV || !vCashAccountId || !vAgainstAccountId || !vAmount} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingV && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Post</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-2 font-medium">#</th><th className="p-2 font-medium">Type</th><th className="p-2 font-medium">Amount</th><th className="p-2 font-medium">Date</th></tr></thead>
              <tbody className="divide-y divide-ct-border">
                {loading ? <tr><td colSpan={4} className="p-4 text-center text-ct-muted">Loading…</td></tr>
                  : vouchers.length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-ct-muted">No vouchers yet.</td></tr>
                  : vouchers.map((v) => <tr key={v.id}><td className="p-2">{v.voucherNumber}</td><td className="p-2 capitalize">{v.voucherType}</td><td className="p-2">{Number(v.amount).toFixed(2)}</td><td className="p-2">{v.postingDate}</td></tr>)}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
