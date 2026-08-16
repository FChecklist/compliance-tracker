"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/SimpleModulePage";

type Finding = { id: string; title: string; severity: string; capaStatus: string; dueDate: string | null; retestResult: string | null };
type Engagement = { id: string; name: string; auditType: string; status: string; findings: Finding[] };

export default function AuditEngagementsPage() {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [findingForms, setFindingForms] = useState<Record<string, string>>({});

  const load = () => {
    fetch("/api/audit-engagements").then((r) => r.json()).then((d) => { setEngagements(d.engagements ?? []); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    if (!nameInput.trim()) return;
    await fetch("/api/audit-engagements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nameInput }) });
    setNameInput(""); setShowForm(false);
    load();
  };

  const addFinding = async (engagementId: string) => {
    const title = findingForms[engagementId];
    if (!title?.trim()) return;
    await fetch("/api/audit-findings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditEngagementId: engagementId, title }) });
    setFindingForms((v) => ({ ...v, [engagementId]: "" }));
    load();
  };

  const advanceCapa = async (id: string) => {
    await fetch(`/api/audit-findings/${id}`, { method: "PATCH" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Audit Management</h1>
          <p className="text-sm text-ct-muted mt-1">Risk-based audit planning — findings with real CAPA ownership</p>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ Plan Audit"}</Button>
      </div>

      {showForm && (
        <Card className="rounded-xl shadow-card bg-white p-4 space-y-3">
          <Input placeholder="Audit name" value={nameInput} onChange={(e) => setNameInput(e.target.value)} className="h-9" />
          <Button size="sm" onClick={create} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Save</Button>
        </Card>
      )}

      {loading ? <p className="text-sm text-ct-muted">Loading…</p> : engagements.length === 0 ? (
        <Card className="rounded-xl bg-white p-8 text-center text-sm text-ct-muted">No audits planned yet.</Card>
      ) : (
        <div className="space-y-3">
          {engagements.map((e) => (
            <Card key={e.id} className="rounded-xl shadow-card bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-ct-navy">{e.name} <span className="text-[10px] text-ct-muted font-normal">({e.auditType})</span></p>
                <StatusPill value={e.status} />
              </div>
              <div className="space-y-1.5">
                {e.findings.map((f) => (
                  <div key={f.id} className="flex items-center justify-between text-xs py-1 border-b border-ct-border last:border-0">
                    <span>{f.title} <StatusPill value={f.severity} /></span>
                    <button onClick={() => advanceCapa(f.id)}><StatusPill value={f.capaStatus} /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <Input placeholder="Add finding" value={findingForms[e.id] ?? ""} onChange={(ev) => setFindingForms((v) => ({ ...v, [e.id]: ev.target.value }))} className="h-8 text-xs" />
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => addFinding(e.id)}>Add</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
