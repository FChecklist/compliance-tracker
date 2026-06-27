"use client";
import { useEffect, useState } from "react";

type Org = { id: string; name: string; timezone: string; financial_year_start: string };

export default function SettingsPage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [aiUsage, setAiUsage] = useState({ tokens_used: 0, limit: 10000, usage_percent: 0 });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then(r=>r.json()).then(d=>{
      if(d.organisation) setOrg(d.organisation as any);
    });
    fetch("/api/ai/usage").then(r=>r.json()).then(d=>setAiUsage(d));
  }, []);

  async function saveOrg(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    await fetch(`/api/orgs/${org?.id}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(org) });
    setSaving(false); setSaved(true); setTimeout(()=>setSaved(false), 2000);
  }

  const usagePct = Math.min(aiUsage.usage_percent, 100);
  const barColor = usagePct >= 95 ? "bg-red-500" : usagePct >= 80 ? "bg-yellow-500" : "bg-blue-500";

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Organisation Profile</h2>
        {org && <form onSubmit={saveOrg} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Organisation name</label>
            <input value={org.name} onChange={e=>setOrg(p=>p?({...p,name:e.target.value}):p)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <input value={org.timezone} onChange={e=>setOrg(p=>p?({...p,timezone:e.target.value}):p)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Asia/Kolkata" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Financial year start</label>
            <select value={org.financial_year_start} onChange={e=>setOrg(p=>p?({...p,financial_year_start:e.target.value}):p)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {["January","February","March","April","July","October"].map(m=><option key={m}>{m}</option>)}
            </select>
          </div>
          <button type="submit" disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saved ? "Saved!" : saving ? "Saving..." : "Save changes"}
          </button>
        </form>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">AI Usage</h2>
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>{aiUsage.tokens_used.toLocaleString()} tokens used</span>
          <span>Limit: {aiUsage.limit.toLocaleString()}</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-2 ${barColor} rounded-full transition-all`} style={{width:`${usagePct}%`}} />
        </div>
        {usagePct >= 80 && <p className="mt-2 text-xs text-yellow-600">⚠ You have used {usagePct}% of your AI limit this month.</p>}
      </div>
    </div>
  );
}