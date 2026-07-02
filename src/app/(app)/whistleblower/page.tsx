"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/SimpleModulePage";

type WCase = { id: string; caseRef: string; category: string | null; receivedDate: string; status: string };

export default function WhistleblowerPage() {
  const [restricted, setRestricted] = useState<boolean | null>(null);
  const [cases, setCases] = useState<WCase[]>([]);

  const load = () => {
    fetch("/api/whistleblower").then((r) => r.json()).then((d) => { setRestricted(!!d.restricted); setCases(d.cases ?? []); });
  };
  useEffect(load, []);

  const logCase = async () => {
    const category = window.prompt("Category (kept confidential — do not enter complaint detail here):");
    if (!category?.trim()) return;
    await fetch("/api/whistleblower", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category }) });
    load();
  };

  if (restricted === null) return null;
  if (restricted) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Whistleblower & Ethics</h1>
        <Card className="rounded-xl border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">This module is classified Confidential</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Whistleblower & Ethics</h1>
          <p className="text-sm text-ct-muted mt-1">Confidential reporting channel and case management</p>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={logCase}>+ Log Case</Button>
      </div>
      <Card className="rounded-xl shadow-card bg-white">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Case ID</th><th className="p-3 font-medium">Category</th><th className="p-3 font-medium">Received</th><th className="p-3 font-medium">Status</th></tr></thead>
          <tbody className="divide-y divide-ct-border">
            {cases.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No cases logged.</td></tr> : cases.map((c) => (
              <tr key={c.id}><td className="p-3">{c.caseRef}</td><td className="p-3">{c.category}</td><td className="p-3">{new Date(c.receivedDate).toLocaleDateString("en-IN")}</td><td className="p-3"><StatusPill value={c.status} /></td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
