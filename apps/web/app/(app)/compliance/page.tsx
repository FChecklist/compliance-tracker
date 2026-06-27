"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Compliance = { id: string; title: string; compliance_type: string; status: string; priority: string; due_date: string };

const STATUS_COLOR: Record<string,string> = { pending:"bg-yellow-100 text-yellow-800", in_progress:"bg-blue-100 text-blue-800", completed:"bg-green-100 text-green-800", overdue:"bg-red-100 text-red-800", not_applicable:"bg-gray-100 text-gray-600" };

export default function CompliancePage() {
  const [items, setItems] = useState<Compliance[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/compliance").then(r=>r.json()).then(d=>{ setItems(d.compliance ?? []); setLoading(false); }).catch(()=>setLoading(false));
  }, []);

  const filtered = items.filter(i => i.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Compliance</h1>
        <Link href="/compliance/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">+ Add Compliance</Link>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search compliance..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {loading ? <div className="p-8 text-center text-gray-400">Loading...</div> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>{["Title","Type","Status","Priority","Due Date",""].map(h=><th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No compliance records found</td></tr> :
               filtered.map(item => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{item.title}</td>
                  <td className="px-4 py-3 text-gray-500">{item.compliance_type}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[item.status]??""}`}>{item.status}</span></td>
                  <td className="px-4 py-3 text-gray-500">{item.priority}</td>
                  <td className="px-4 py-3 text-gray-500">{item.due_date ? new Date(item.due_date).toLocaleDateString() : "-"}</td>
                  <td className="px-4 py-3"><Link href={`/compliance/${item.id}`} className="text-blue-600 hover:underline text-xs">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}