"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/SimpleModulePage";

type Matter = { id: string; matter: string; matterType: string | null; forum: string | null; stage: string; nextHearingDate: string | null; counsel: string | null; amount: string | null };
const STAGES = ["filed", "hearing_scheduled", "judgment_reserved", "judgment_passed", "appeal_filed", "closed"];

export default function LitigationPage() {
  const [matters, setMatters] = useState<Matter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [matterInput, setMatterInput] = useState("");
  const [forumInput, setForumInput] = useState("");

  const load = () => {
    fetch("/api/litigation").then((r) => r.json()).then((d) => { setMatters(d.matters ?? []); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    if (!matterInput.trim()) return;
    await fetch("/api/litigation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matter: matterInput, forum: forumInput }) });
    setMatterInput(""); setForumInput(""); setShowForm(false);
    load();
  };

  const advance = async (m: Matter) => {
    const idx = STAGES.indexOf(m.stage);
    if (idx >= STAGES.length - 1) return;
    await fetch(`/api/litigation/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: STAGES[idx + 1] }) });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Litigation & Disputes</h1>
          <p className="text-sm text-ct-muted mt-1">Every matter, tracked stage to stage — filed to closed</p>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ Log Matter"}</Button>
      </div>

      {showForm && (
        <Card className="rounded-xl shadow-card bg-white p-4 space-y-3">
          <Input placeholder="Matter description" value={matterInput} onChange={(e) => setMatterInput(e.target.value)} className="h-9" />
          <Input placeholder="Forum (e.g. GST Appellate Tribunal)" value={forumInput} onChange={(e) => setForumInput(e.target.value)} className="h-9" />
          <Button size="sm" onClick={create} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Save</Button>
        </Card>
      )}

      {loading ? <p className="text-sm text-ct-muted">Loading…</p> : matters.length === 0 ? (
        <Card className="rounded-xl bg-white p-8 text-center text-sm text-ct-muted">No litigation matters recorded.</Card>
      ) : (
        <div className="space-y-2">
          {matters.map((m) => (
            <Card key={m.id} className="rounded-xl shadow-card bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ct-navy">{m.matter}</p>
                  <p className="text-[11px] text-ct-muted">{m.forum ?? "—"} {m.counsel ? `· ${m.counsel}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill value={m.stage} />
                  {m.stage !== "closed" && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => advance(m)}>Next stage →</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
