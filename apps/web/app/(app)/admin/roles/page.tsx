"use client";

const ROLES = [
  {
    name: "account_admin",
    label: "Account Admin",
    description: "Full control over the organisation. Manage users, departments, compliance, API tokens, webhooks, and settings.",
    color: "bg-orange-100 text-orange-800",
  },
  {
    name: "client_department_admin",
    label: "Department Admin",
    description: "Manage users and departments within their scope. Full compliance workflow control including status changes and reassignment.",
    color: "bg-blue-100 text-blue-800",
  },
  {
    name: "editor",
    label: "Editor",
    description: "Create and edit compliance items and documents. Can add comments. Cannot change status or manage users.",
    color: "bg-green-100 text-green-800",
  },
  {
    name: "viewer",
    label: "Viewer",
    description: "Read-only access to compliance items, documents, audit logs, and comments. Cannot create or modify anything.",
    color: "bg-gray-100 text-gray-700",
  },
];

export default function RolesPage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Roles define what actions users can perform. Assign roles via the Users tab.
      </p>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Role</th>
              <th className="text-left px-4 py-3 font-medium">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ROLES.map((r) => (
              <tr key={r.name} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.color}`}>
                    {r.label}
                  </span>
                  <span className="ml-2 text-xs text-gray-400 font-mono">{r.name}</span>
                </td>
                <td className="px-4 py-3 text-gray-600">{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}