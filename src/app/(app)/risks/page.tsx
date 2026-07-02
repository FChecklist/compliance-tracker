"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/SimpleModulePage";

type Risk = { id: string; title: string; category: string; likelihood: number; impact: number; status: string; ownerDept: string | null };

export default function RisksPage() {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [hiddenByScope, setHiddenByScope] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [titleInput, setTitleInput] = useState("");

  const load = () => {
    fetch("/api/risks").then((r) => r.json()).then((d) => { setRisks(d.risks ?? []); setHiddenByScope(d.hiddenByScope ?? 0); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    if (!titleInput.trim()) return;
    await fetch("/api/risks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: titleInput }) });
    setTitleInput(""); setShowForm(false);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Risk Register</h1>
          <p className="text-sm text-ct-muted mt-1">
            Every enterprise risk, scored by likelihood × impact{hiddenByScope > 0 && ` — (${hiddenByScope} risks outside your scope not shown)`}
          </p>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ Add Risk"}</Button>
      </div>

      {showForm && (
        <Card className="rounded-xl shadow-card bg-white p-4 space-y-3">
          <Input placeholder="Risk title" value={titleInput} onChange={(e) => setTitleInput(e.target.value)} className="h-9" />
          <Button size="sm" onClick={create} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Save</Button>
        </Card>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Risk</th><th className="p-3 font-medium">Category</th><th className="p-3 font-medium">Score</th><th className="p-3 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-ct-border">
              {loading ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">Loading…</td></tr> : risks.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No risks visible in your scope.</td></tr>
              ) : risks.map((r) => (
                <tr key={r.id} className="hover:bg-ct-row-hover">
                  <td className="p-3">{r.title}</td>
                  <td className="p-3 text-ct-muted">{r.category}</td>
                  <td className="p-3">{r.likelihood} × {r.impact} = {r.likelihood * r.impact}</td>
                  <td className="p-3"><StatusPill value={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
