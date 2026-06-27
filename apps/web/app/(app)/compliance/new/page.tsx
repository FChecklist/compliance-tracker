"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = ["gst","income_tax","tds","roc","pf","esic","professional_tax","labour_law","custom"];
const PRIORITIES = ["critical","high","medium","low"];

export default function NewCompliancePage() {
  const router = useRouter();
  const [form, setForm] = useState({ title:"", compliance_type:"gst", priority:"medium", due_date:"", description:"" });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true);
    const res = await fetch("/api/compliance", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(form) });
    if (res.ok) router.push("/compliance");
    else setLoading(false);
  }

  const f = (key: keyof typeof form, label: string, type="text") => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={form[key]} onChange={e=>setForm(p=>({...p,[key]:e.target.value}))} required={["title","due_date"].includes(key)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Compliance</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {f("title","Title")}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select value={form.compliance_type} onChange={e=>setForm(p=>({...p,compliance_type:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {TYPES.map(t=><option key={t} value={t}>{t.toUpperCase().replace("_"," ")}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select value={form.priority} onChange={e=>setForm(p=>({...p,priority:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {PRIORITIES.map(p=><option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
              </select>
            </div>
          </div>
          {f("due_date","Due Date","date")}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={loading} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading?"Creating...":"Create Compliance"}
            </button>
            <button type="button" onClick={()=>router.back()} className="border border-gray-200 px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}