"use client";
import { useEffect, useState } from "react";

type Dept = { id: string; name: string; description?: string };

export default function DepartmentsPage() {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const load = () => fetch("/api/departments").then(r=>r.json()).then(d=>setDepts(d.departments??[]));
  useEffect(() => { load(); }, []);

  async function addDept(e: React.FormEvent) {
    e.preventDefault(); if (!name.trim()) return;
    setLoading(true);
    await fetch("/api/departments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    setName(""); await load(); setLoading(false);
  }

  async function deleteDept(id: string) {
    if (!confirm("Delete this department?")) return;
    await fetch(`/api/departments/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Departments</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Add Department</h2>
        <form onSubmit={addDept} className="flex gap-3">
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Department name" className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button type="submit" disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">Add</button>
        </form>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {depts.length === 0 ? <p className="p-8 text-center text-gray-400">No departments yet</p> :
          depts.map(d => (
            <div key={d.id} className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="font-medium text-gray-900">{d.name}</p>
                {d.description && <p className="text-sm text-gray-500">{d.description}</p>}
              </div>
              <button onClick={()=>deleteDept(d.id)} className="text-red-500 hover:text-red-700 text-sm">Remove</button>
            </div>
          ))}
      </div>
    </div>
  );
}