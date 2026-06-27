"use client";
import { useEffect, useState } from "react";
import { Button, Modal, Input, Textarea, EmptyState, StatusBadge, SearchInput } from "@compliance/ui";
import { Plus, Building2, Users, FileCheck, Pencil, Trash2 } from "lucide-react";

type Department = {
  id: string;
  name: string;
  description: string | null;
  head_user_id: string | null;
  is_active: boolean;
  created_at: string;
  _member_count?: number;
  _compliance_count?: number;
};

const emptyForm = { name: "", description: "" };

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchDepts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/departments");
      const data = await res.json();
      setDepartments(data.departments ?? []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchDepts(); }, []);

  const filtered = departments.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()));

  const openCreate = () => { setEditing(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (dept: Department) => { setEditing(dept); setForm({ name: dept.name, description: dept.description ?? "" }); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const url = editing ? `/api/departments/${editing.id}` : "/api/departments";
      const method = editing ? "PUT" : "POST";
      await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setModalOpen(false);
      fetchDepts();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this department? This cannot be undone.")) return;
    await fetch(`/api/departments/${id}`, { method: "DELETE" });
    fetchDepts();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Departments</h1>
          <p className="text-sm text-gray-500">{departments.length} departments</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Add Department</Button>
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="Search departments..." />

      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Building2 className="w-8 h-8" />} title="No departments" description="Create your first department to organize compliance items." action={<Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Create</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((dept) => (
            <div key={dept.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{dept.name}</h3>
                    <StatusBadge status={dept.is_active ? "active" : "inactive"} />
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(dept)} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(dept.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              {dept.description && <p className="text-sm text-gray-500 mt-3 line-clamp-2">{dept.description}</p>}
              <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500">
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {(dept as any)._member_count ?? 0} members</span>
                <span className="flex items-center gap-1"><FileCheck className="w-3.5 h-3.5" /> {(dept as any)._compliance_count ?? 0} items</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit Department" : "New Department"} footer={
        <>
          <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? "Saving..." : editing ? "Update" : "Create"}
          </Button>
        </>
      }>
        <div className="space-y-4">
          <Input label="Department Name *" placeholder="e.g., Finance" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, name: e.target.value }))} />
          <Textarea label="Description" placeholder="What does this department handle?" value={form.description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm((p) => ({ ...p, description: e.target.value }))} rows={3} />
        </div>
      </Modal>
    </div>
  );
}