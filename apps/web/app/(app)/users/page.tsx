"use client";
import { useEffect, useState } from "react";
import { Button, Modal, Input, Select, StatusBadge, EmptyState, SearchInput } from "@compliance/ui";
import { Plus, UserPlus, Shield, Pencil, Trash2, Mail, User } from "lucide-react";

type UserItem = {
  id: string;
  email: string;
  phone: string | null;
  full_name: string;
  avatar_url: string | null;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};

const ROLE_OPTIONS = [
  { label: "Account Admin", value: "account_admin" },
  { label: "Department Admin", value: "client_department_admin" },
  { label: "Editor", value: "editor" },
  { label: "Viewer", value: "viewer" },
];

const roleLabel: Record<string, string> = {
  account_admin: "Account Admin",
  client_department_admin: "Dept Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const roleColor: Record<string, string> = {
  account_admin: "bg-purple-100 text-purple-700",
  client_department_admin: "bg-blue-100 text-blue-700",
  editor: "bg-green-100 text-green-700",
  viewer: "bg-gray-100 text-gray-600",
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [inviteForm, setInviteForm] = useState({ email: "", full_name: "", role: "viewer" });
  const [saving, setSaving] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const filtered = users.filter((u) => {
    const matchSearch = u.full_name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = !roleFilter || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const handleInvite = async () => {
    if (!inviteForm.email || !inviteForm.full_name) return;
    setSaving(true);
    try {
      await fetch("/api/users/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inviteForm) });
      setInviteOpen(false);
      setInviteForm({ email: "", full_name: "", role: "viewer" });
      fetchUsers();
    } catch {}
    setSaving(false);
  };

  const handleRoleChange = async (userId: string, role: string) => {
    await fetch(`/api/users/${userId}/role`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    fetchUsers();
  };

  const handleToggleActive = async (user: UserItem) => {
    await fetch(`/api/users/${user.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !user.is_active }) });
    fetchUsers();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this user from the organisation?")) return;
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    fetchUsers();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500">{users.length} users</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}><UserPlus className="w-4 h-4 mr-2" /> Invite User</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder="Search by name or email..." /></div>
        <Select options={[{ label: "All Roles", value: "" }, ...ROLE_OPTIONS]} value={roleFilter} onChange={setRoleFilter} placeholder="All Roles" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<User className="w-8 h-8" />} title="No users found" description="Invite users to your organisation to get started." />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">User</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Last Login</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Joined</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm">
                          {u.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{u.full_name}</p>
                          <p className="text-xs text-gray-500 flex items-center gap-1"><Mail className="w-3 h-3" />{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        className="text-xs font-medium px-2.5 py-1 rounded-full border-0 cursor-pointer"
                        style={{ backgroundColor: roleColor[u.role]?.split(" ")[0], color: roleColor[u.role]?.split(" ")[1] }}
                      >
                        {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={u.is_active ? "active" : "inactive"} /></td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : "Never"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleToggleActive(u)} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600" title={u.is_active ? "Deactivate" : "Activate"}>
                          <Shield className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(u.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite User" description="Send an invitation to join your organisation." footer={
        <>
          <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
          <Button onClick={handleInvite} disabled={saving || !inviteForm.email || !inviteForm.full_name}>
            {saving ? "Sending..." : <><Mail className="w-4 h-4 mr-2" />Send Invitation</>}
          </Button>
        </>
      }>
        <div className="space-y-4">
          <Input label="Full Name *" placeholder="John Doe" value={inviteForm.full_name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInviteForm((p) => ({ ...p, full_name: e.target.value }))} />
          <Input label="Email *" type="email" placeholder="john@company.com" value={inviteForm.email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInviteForm((p) => ({ ...p, email: e.target.value }))} />
          <Select label="Role" options={ROLE_OPTIONS} value={inviteForm.role} onChange={(v) => setInviteForm((p) => ({ ...p, role: v }))} />
        </div>
      </Modal>
    </div>
  );
}