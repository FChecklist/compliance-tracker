"use client";

export const dynamic = "force-dynamic";

// Wave 84 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #5): credit limit + the
// shared addresses/contacts component (also used by /erp/suppliers/[id]).
import { useEffect, useState, useCallback, use as usePromise } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, Loader2, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PartyAddressesAndContacts } from "@/components/erp/PartyAddressesAndContacts";

type Customer = { id: string; customerName: string; gstin: string | null; panNumber: string | null; creditLimit: string | null };

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [creditLimitInput, setCreditLimitInput] = useState("");
  const [savingCreditLimit, setSavingCreditLimit] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/erp/selling/customers");
    const data = await res.json();
    const found = (data.customers ?? []).find((c: Customer) => c.id === id) ?? null;
    setCustomer(found);
    setCreditLimitInput(found?.creditLimit ?? "");
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const saveCreditLimit = async () => {
    setSavingCreditLimit(true);
    try {
      const res = await fetch(`/api/erp/selling/customers/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditLimit: creditLimitInput === "" ? null : Number(creditLimitInput) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Credit limit updated");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update credit limit");
    } finally {
      setSavingCreditLimit(false);
    }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!customer) return <p className="text-sm text-ct-muted">Customer not found.</p>;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/erp/customers" className="text-xs text-ct-muted hover:text-ct-navy flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3" /> Back to Customers
        </Link>
        <h1 className="text-2xl font-heading text-ct-navy">{customer.customerName}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2"><CardTitle className="text-base text-ct-navy flex items-center gap-2"><Wallet className="size-4 text-ct-teal" /> Credit Limit</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2">
            <Input type="number" value={creditLimitInput} onChange={(e) => setCreditLimitInput(e.target.value)} placeholder="No limit" className="max-w-40" />
            <Button size="sm" onClick={saveCreditLimit} disabled={savingCreditLimit} className="bg-ct-teal hover:bg-ct-teal-hover text-white">
              {savingCreditLimit && <Loader2 className="size-3.5 mr-1 animate-spin" />} Save
            </Button>
          </CardContent>
        </Card>

        <PartyAddressesAndContacts entityType="erp_customer" entityId={id} />
      </div>
    </div>
  );
}
