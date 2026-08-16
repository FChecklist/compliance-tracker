"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/SimpleModulePage";

type Policy = { id: string; title: string; category: string; version: string; status: string; attestationRate: number; history: { version: string; date: string; editedBy: string; note: string }[] };

const CATEGORIES = ["All", "governance", "hr", "environment", "data_privacy", "third_party"];

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [titleInput, setTitleInput] = useState("");

  const load = () => {
    fetch("/api/policies").then((r) => r.json()).then((d) => {
      setPolicies(d.policies ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    if (!titleInput.trim()) return;
    await fetch("/api/policies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: titleInput }) });
    setTitleInput(""); setShowForm(false);
    load();
  };

  const requestPublish = async (id: string) => {
    await fetch(`/api/policies/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request_publish" }) });
    load();
  };

  const filtered = filter === "All" ? policies : policies.filter((p) => p.category === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Policy Management</h1>
          <p className="text-sm text-ct-muted mt-1">Every policy — draft to publish to attestation — publishing requires approval</p>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add Policy"}
        </Button>
      </div>

      {showForm && (
        <Card className="rounded-xl shadow-card bg-white p-4 space-y-3">
          <Input placeholder="Policy title" value={titleInput} onChange={(e) => setTitleInput(e.target.value)} className="h-9" />
          <Button size="sm" onClick={create} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Save</Button>
        </Card>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setFilter(c)} className={`px-2.5 py-1 rounded-full text-[11px] ${filter === c ? "bg-ct-navy text-white" : "bg-ct-cloud text-ct-slate hover:bg-ct-border"}`}>
            {c === "All" ? c : c.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-ct-muted">Loading…</p> : filtered.length === 0 ? (
        <Card className="rounded-xl bg-white p-8 text-center text-sm text-ct-muted">No policies in this category.</Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <Card key={p.id} className="rounded-xl shadow-card bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ct-navy">{p.title} <StatusPill value={p.category} /></p>
                  <p className="text-[11px] text-ct-muted">Current: {p.version} · {p.attestationRate > 0 ? `${p.attestationRate}% attested` : "not yet published"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill value={p.status} />
                  {p.status !== "published" && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => requestPublish(p.id)}>Request publish</Button>}
                </div>
              </div>
              {p.history?.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[11px] text-ct-teal cursor-pointer">Version history ({p.history.length})</summary>
                  <div className="mt-1.5 space-y-1 pl-2 border-l-2 border-ct-border">
                    {p.history.map((h, i) => <div key={i} className="text-[11px]"><span className="font-medium text-ct-navy">{h.version}</span> — {h.date} by {h.editedBy}<br /><span className="text-ct-muted">{h.note}</span></div>)}
                  </div>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
