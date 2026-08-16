"use client";

export const dynamic = "force-dynamic";

// Wave 84 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #5): erp_customers has
// existed since Wave 49 with a list-only service consumer (Wave 52's Credit
// Note picker) but no dedicated management page at all -- this is the first
// one, mirroring /erp/suppliers's list+detail shape.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Users, Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Customer = { id: string; customerName: string; gstin: string | null; creditLimit: string | null };

export default function ErpCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [gstin, setGstin] = useState("");
  const [panNumber, setPanNumber] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/erp/selling/customers").then((res) => res.json()).then((d) => {
      setCustomers(d.customers ?? []);
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const createCustomer = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/erp/selling/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName: name, gstin: gstin || undefined, panNumber: panNumber || undefined, creditLimit: creditLimit ? Number(creditLimit) : undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create customer");
      setOpen(false); setName(""); setGstin(""); setPanNumber(""); setCreditLimit("");
      toast.success("Customer created");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create customer");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Customers</h1>
          <p className="text-sm text-ct-muted mt-1">Customer master -- multiple addresses/contacts, credit limits -- VERI ERP AI</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Customer</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Customer</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Customer Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>GSTIN (optional)</Label><Input value={gstin} onChange={(e) => setGstin(e.target.value)} /></div>
                <div><Label>PAN (optional)</Label><Input value={panNumber} onChange={(e) => setPanNumber(e.target.value)} /></div>
              </div>
              <div><Label>Credit Limit (optional)</Label><Input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="No limit" /></div>
            </div>
            <DialogFooter><Button onClick={createCustomer} disabled={creating || !name} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creating && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : customers.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><Users className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No customers yet.</p></CardContent></Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {customers.map((c) => (
            <div key={c.id} className="px-4 py-3 flex items-center gap-3">
              <Users className="size-4 text-ct-teal shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ct-navy">{c.customerName}</p>
                <p className="text-xs text-ct-muted">{c.gstin ?? "No GSTIN on file"}{c.creditLimit ? ` -- credit limit ${c.creditLimit}` : ""}</p>
              </div>
              <Link href={`/erp/customers/${c.id}`}>
                <Button size="sm" variant="outline" className="h-8 text-xs">Manage</Button>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
