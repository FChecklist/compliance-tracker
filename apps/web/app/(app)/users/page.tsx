"use client";
import { useEffect, useState } from "react";

type User = { id: string; email: string; full_name: string; role: string; is_active: boolean };
const ROLES = ["client_department_admin","editor","viewer"];
const ROLE_BADGE: Record<string,string> = { account_admin:"bg-purple-100 text-purple-700", client_department_admin:"bg-blue-100 text-blue-700", editor:"bg-green-100 text-green-700", viewer:"bg-gray-100 text-gray-600" };

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [invite, setInvite] = useState({ email:"", full_name:"", role:"editor" });
  const [showInvite, setShowInvite] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = () => fetch("/api/users").then(r=>r.json()).then(d=>setUsers(d.users??[]));
  useEffect(() => { load(); }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault(); setLoading(true);
    await fetch("/api/users/invite", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(invite) });
    setShowInvite(false); setInvite({email:"",full_name:"",role:"editor"}); await load(); setLoading(false);
  }

  async function changeRole(id: string, role: string) {
    await fetch(`/api/users/${id}/role`, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ role }) });
    await load();
  }

  async function removeUser(id: string) {
    if (!confirm("Remove this user?")) return;
    await fetch(`/api/users/${id}`, { method:"DELETE" }); await load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <button onClick={()=>setShowInvite(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Invite User</button>
      </div>

      {showInvite && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Invite a team member</h2>
          <form onSubmit={handleInvite} className="grid grid-cols-3 gap-3">
            <input value={invite.email} onChange={e=>setInvite(p=>({...p,email:e.target.value}))} placeholder="Email" type="email" required className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input value={invite.full_name} onChange={e=>setInvite(p=>({...p,full_name:e.target.value}))} placeholder="Full name" required className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <select value={invite.role} onChange={e=>setInvite(p=>({...p,role:e.target.value}))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {ROLES.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
            <div className="col-span-3 flex gap-3">
              <button type="submit" disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">Send Invite</button>
              <button type="button" onClick={()=>setShowInvite(false)} className="border border-gray-200 px-4 py-2 rounded-lg text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {users.map(u => (
          <div key={u.id} className="flex items-center justify-between px-6 py-4">
            <div>
              <p className="font-medium text-gray-900">{u.full_name}</p>
              <p className="text-sm text-gray-500">{u.email}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${ROLE_BADGE[u.role]??""}`}>{u.role}</span>
              {u.role !== "account_admin" && (
                <select onChange={e=>changeRole(u.id,e.target.value)} value={u.role} className="text-xs border border-gray-200 rounded px-2 py-1">
                  {ROLES.map(r=><option key={r} value={r}>{r}</option>)}
                </select>
              )}
              {u.role !== "account_admin" && <button onClick={()=>removeUser(u.id)} className="text-red-500 hover:text-red-700 text-xs">Remove</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}