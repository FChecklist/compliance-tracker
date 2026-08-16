"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/SimpleModulePage";

type Item = { id: string; item: string; governingLaw: string | null; state: string; dueDate: string | null; status: string };

export default function HrCompliancePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [itemInput, setItemInput] = useState("");
  const [stateInput, setStateInput] = useState("All India");

  const load = () => {
    fetch("/api/hr-compliance").then((r) => r.json()).then((d) => { setItems(d.items ?? []); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    if (!itemInput.trim()) return;
    await fetch("/api/hr-compliance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: itemInput, state: stateInput }) });
    setItemInput(""); setShowForm(false);
    load();
  };

  const markFiled = async (id: string) => {
    await fetch(`/api/hr-compliance/${id}`, { method: "PATCH" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Payroll & HR Statutory Compliance</h1>
          <p className="text-sm text-ct-muted mt-1">PF, ESIC, Professional Tax, LWF, Bonus, Gratuity — tracked state-wise</p>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ Add Item"}</Button>
      </div>

      {showForm && (
        <Card className="rounded-xl shadow-card bg-white p-4 space-y-3">
          <Input placeholder="e.g. Professional Tax — Tamil Nadu" value={itemInput} onChange={(e) => setItemInput(e.target.value)} className="h-9" />
          <Input placeholder="State" value={stateInput} onChange={(e) => setStateInput(e.target.value)} className="h-9" />
          <Button size="sm" onClick={create} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Save</Button>
        </Card>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Item</th><th className="p-3 font-medium">Law</th><th className="p-3 font-medium">State</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
            <tbody className="divide-y divide-ct-border">
              {loading ? <tr><td colSpan={5} className="p-6 text-center text-ct-muted">Loading…</td></tr> : items.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-ct-muted">No items tracked.</td></tr> : items.map((i) => (
                <tr key={i.id} className="hover:bg-ct-row-hover">
                  <td className="p-3">{i.item}</td><td className="p-3 text-ct-muted">{i.governingLaw ?? "—"}</td><td className="p-3">{i.state}</td>
                  <td className="p-3"><StatusPill value={i.status} /></td>
                  <td className="p-3">{i.status !== "filed" && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markFiled(i.id)}>Mark filed</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
