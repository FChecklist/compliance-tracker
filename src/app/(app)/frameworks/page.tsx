"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/SimpleModulePage";
import { toast } from "sonner";

type Control = { id: string; controlRef: string; title: string; status: string };
type Framework = { id: string; frameworkKey: string; name: string; relevanceNote: string | null; pct: number; controls: Control[] };

export default function FrameworksPage() {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch("/api/frameworks").then((r) => r.json()).then((d) => { setFrameworks(d.frameworks ?? []); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const advance = async (id: string) => {
    const res = await fetch(`/api/frameworks/controls/${id}`, { method: "PATCH" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Could not advance this control's status");
      return;
    }
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Controls & Framework Library</h1>
        <p className="text-sm text-ct-muted mt-1">One control library, mapped to every framework you need — ISO 27001, SOC 2, COSO, NIST CSF, India Statutory, DPDP, plus opt-in PCI DSS / HIPAA where relevant</p>
      </div>
      {loading ? <p className="text-sm text-ct-muted">Loading…</p> : (
        <div className="grid md:grid-cols-2 gap-4">
          {frameworks.map((f) => (
            <Card key={f.id} className="rounded-xl shadow-card bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">{f.name}</h3>
                <span className="text-[11px] text-ct-muted">{f.pct}% ready</span>
              </div>
              {f.relevanceNote && <p className="text-[10px] text-amber-600 italic mb-2">{f.relevanceNote}</p>}
              <div className="h-1.5 rounded-full bg-ct-cloud mb-3"><div className="h-1.5 rounded-full bg-ct-teal" style={{ width: `${f.pct}%` }} /></div>
              <div className="space-y-1.5">
                {f.controls.length === 0 ? <p className="text-xs text-ct-muted">No controls added yet.</p> : f.controls.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-xs py-1 border-b border-ct-border last:border-0">
                    <span className="text-ct-slate">{c.controlRef} — {c.title}</span>
                    <button onClick={() => advance(c.id)}><StatusPill value={c.status} /></button>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
