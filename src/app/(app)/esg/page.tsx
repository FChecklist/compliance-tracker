"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";

type Metric = { label: string; value: number; note: string };

export default function EsgPage() {
  const [pillars, setPillars] = useState<Record<string, Metric[]>>({});

  useEffect(() => {
    fetch("/api/esg").then((r) => r.json()).then((d) => setPillars(d.pillars ?? {}));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">ESG & Sustainability (BRSR)</h1>
        <p className="text-sm text-ct-muted mt-1">Environment, Social, and Governance metrics — Social pillar computed live from Policy Management and POSH Compliance</p>
      </div>
      {Object.entries(pillars).map(([pillar, metrics]) => (
        <div key={pillar}>
          <h3 className="text-xs font-semibold text-ct-muted tracking-wide mb-2 uppercase">{pillar}</h3>
          <div className="space-y-3">
            {metrics.map((m, i) => (
              <Card key={i} className="rounded-xl shadow-card bg-white p-4">
                <div className="flex items-center justify-between mb-1"><span className="text-sm font-medium text-ct-navy">{m.label}</span><span className="text-sm font-heading text-ct-teal">{m.value}%</span></div>
                <div className="h-1.5 rounded-full bg-ct-cloud"><div className="h-1.5 rounded-full bg-ct-teal" style={{ width: `${m.value}%` }} /></div>
                <p className="text-[11px] text-ct-muted mt-1">{m.note}</p>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
