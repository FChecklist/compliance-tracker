"use client";
import { useEffect, useState } from "react";

type Org = { id: string; name: string; type: string; plan: string; industry: string | null; timezone: string; logo_url: string | null };

export default function OrgSettingsPage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [form, setForm] = useState({ name: "", industry: "", timezone: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/orgs/current")
      .then((r) => r.json())
      .then((d) => {
        const o = d.data ?? d;
        setOrg(o);
        setForm({ name: o.name ?? "", industry: o.industry ?? "", timezone: o.timezone ?? "" });
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/orgs/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) setMsg("Settings saved");
      else setMsg("Failed to save");
    } catch {
      setMsg("Network error");
    } finally {
      setSaving(false);
    }
  };

  if (!org) return <div className="text-gray-400 p-8">Loading...</div>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Organisation Settings</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Organisation Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <input value={org.type} disabled className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
          <input value={org.plan} disabled className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
          <input
            value={form.industry}
            onChange={(e) => setForm({ ...form, industry: e.target.value })}
            placeholder="e.g. Accounting, Legal, IT Services"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
          <input
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
        {msg && <span className={`text-sm ${msg.includes("saved") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}