"use client";
import { useEffect, useState } from "react";

type Dept = { id: string; name: string; description: string | null };

export default function AdminDepartmentsPage() {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = () => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((d) => {
        setDepts(d.departments ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setAdding(true);
    await fetch("/api/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: desc.trim() || undefined }),
    });
    setName("");
    setDesc("");
    setAdding(false);
    load();
  };

  return (
    <div className="space-y-6">
      {/* Add form */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Add Department</h3>
        <div className="flex gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Department name"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1"
          />
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Description (optional)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !name.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            {adding ? "..." : "Add"}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {depts.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                  <td className="px-4 py-3 text-gray-500">{d.description ?? "—"}</td>
                </tr>
              ))}
              {depts.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-gray-400">No departments yet</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}