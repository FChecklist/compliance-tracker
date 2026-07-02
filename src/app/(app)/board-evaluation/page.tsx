"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/SimpleModulePage";

type Evaluation = {
  id: string; cycle: string; currentStage: string;
  respondents: { name: string; role: string; responded: boolean }[];
  actionItems: { item: string; owner: string; status: string }[];
  history: { cycle: string; completedDate: string; outcome: string }[];
};

export default function BoardEvaluationPage() {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [cycleInput, setCycleInput] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    fetch("/api/board-evaluation").then((r) => r.json()).then((d) => {
      setEvaluations(d.evaluations ?? []);
      setStages(d.stages ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    if (!cycleInput.trim()) return;
    await fetch("/api/board-evaluation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cycle: cycleInput }) });
    setCycleInput(""); setShowForm(false);
    load();
  };

  const advance = async (id: string) => {
    await fetch(`/api/board-evaluation/${id}`, { method: "PATCH" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Board & Director Evaluation</h1>
          <p className="text-sm text-ct-muted mt-1">Companies Act Schedule IV / SEBI LODR Reg 17(10) — annual evaluation cycle</p>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New Cycle"}
        </Button>
      </div>

      {showForm && (
        <Card className="rounded-xl shadow-card bg-white p-4 space-y-3">
          <Input placeholder="e.g. FY 2025-26 Annual Evaluation" value={cycleInput} onChange={(e) => setCycleInput(e.target.value)} className="h-9" />
          <Button size="sm" onClick={create} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Start Cycle</Button>
        </Card>
      )}

      {loading ? <p className="text-sm text-ct-muted">Loading…</p> : evaluations.length === 0 ? (
        <Card className="rounded-xl bg-white p-8 text-center text-sm text-ct-muted">No evaluation cycles yet.</Card>
      ) : (
        evaluations.map((e) => {
          const stageIdx = stages.indexOf(e.currentStage);
          return (
            <Card key={e.id} className="rounded-xl shadow-card bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ct-navy">{e.cycle}</h3>
                <div className="flex items-center gap-2">
                  <StatusPill value={e.currentStage} />
                  {e.currentStage !== "closed" && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => advance(e.id)}>Advance stage →</Button>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {stages.map((s, i) => <div key={s} className={`flex-1 h-1.5 rounded-full ${i <= stageIdx ? "bg-ct-teal" : "bg-ct-cloud"}`} title={s} />)}
              </div>
              {e.respondents?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ct-navy mb-1">Respondents ({e.respondents.filter((r) => r.responded).length}/{e.respondents.length})</p>
                  <ul className="text-xs space-y-1">
                    {e.respondents.map((r, i) => <li key={i} className="flex justify-between"><span>{r.name} — {r.role}</span><StatusPill value={r.responded ? "responded" : "pending"} /></li>)}
                  </ul>
                </div>
              )}
              {e.history?.length > 0 && (
                <div className="text-xs border-t border-ct-border pt-2">
                  <p className="font-semibold text-ct-navy mb-1">Prior Cycles</p>
                  {e.history.map((h, i) => <p key={i} className="text-ct-muted">{h.cycle} — {h.completedDate}: {h.outcome}</p>)}
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
