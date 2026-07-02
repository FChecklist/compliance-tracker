"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/SimpleModulePage";

type Incident = {
  id: string; title: string | null; category: string; severity: string; classification: string; stage: string;
  regulatoryNotifyRequired: boolean; notified: boolean; notifyDeadline: string | null; linkedRiskId: string | null; restricted?: boolean;
};

const STAGES = ["logged", "triaged", "investigating", "contained", "notified", "remediated", "closed"];

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("Operational");

  const load = () => {
    fetch("/api/incidents").then((r) => r.json()).then((d) => { setIncidents(d.incidents ?? []); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    if (!titleInput.trim()) return;
    await fetch("/api/incidents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: titleInput, category: categoryInput }) });
    setTitleInput(""); setShowForm(false);
    load();
  };

  const act = async (id: string, action: string) => {
    await fetch(`/api/incidents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Incident Management</h1>
          <p className="text-sm text-ct-muted mt-1">Every incident — security, breach, operational, safety — logged to closed</p>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ Log Incident"}</Button>
      </div>

      {showForm && (
        <Card className="rounded-xl shadow-card bg-white p-4 space-y-3">
          <Input placeholder="Incident title" value={titleInput} onChange={(e) => setTitleInput(e.target.value)} className="h-9" />
          <Input placeholder="Category (e.g. Security / Data Breach, Operational, Safety)" value={categoryInput} onChange={(e) => setCategoryInput(e.target.value)} className="h-9" />
          <Button size="sm" onClick={create} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Save</Button>
        </Card>
      )}

      {loading ? <p className="text-sm text-ct-muted">Loading…</p> : (
        <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {STAGES.map((stage) => (
            <div key={stage} className="rounded-xl border border-ct-border bg-white overflow-hidden">
              <div className="px-2 py-2 border-b border-ct-border bg-ct-cloud/50">
                <span className="text-[11px] font-semibold text-ct-navy">{stage}</span>{" "}
                <span className="text-[10px] text-ct-muted">{incidents.filter((i) => i.stage === stage).length}</span>
              </div>
              <div className="p-1.5 space-y-1.5 min-h-[160px]">
                {incidents.filter((i) => i.stage === stage).map((i) => (
                  <div key={i.id} className="rounded-lg border border-ct-border p-2">
                    <div className="mb-1"><StatusPill value={i.classification} /></div>
                    {i.restricted ? (
                      <p className="text-[10px] text-ct-muted italic">Restricted — {i.classification}</p>
                    ) : (
                      <>
                        <p className="text-[11px] font-medium text-ct-navy leading-snug">{i.title}</p>
                        <div className="flex items-center gap-1 mt-1"><StatusPill value={i.category} /><StatusPill value={i.severity} /></div>
                        {i.regulatoryNotifyRequired && (
                          <p className={`text-[10px] mt-1 ${i.notified ? "text-emerald-600" : "text-red-600"}`}>
                            {i.notified ? "✓ Regulator notified" : `Notify by ${i.notifyDeadline}`}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {i.stage !== "closed" && <button onClick={() => act(i.id, "advance")} className="text-[10px] text-ct-teal underline">Next stage →</button>}
                          {i.regulatoryNotifyRequired && !i.notified && <button onClick={() => act(i.id, "mark_notified")} className="text-[10px] text-ct-navy underline">Mark notified</button>}
                          {!i.linkedRiskId ? <button onClick={() => act(i.id, "flag_as_risk")} className="text-[10px] text-amber-600 underline">Flag as risk</button> : <span className="text-[10px] text-ct-muted">Linked to risk</span>}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
