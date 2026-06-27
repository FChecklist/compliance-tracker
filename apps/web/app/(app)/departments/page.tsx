"use client";

import { useEffect, useState, useCallback } from "react";

type Department = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add form state
  const [addName, setAddName] = useState("");
  const [addDesc, setAddDesc] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await fetch("/api/departments");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        setDepartments(json.data ?? []);
        setError(null);
      } else {
        setError(json.error ?? "Failed to load departments");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load departments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  // --- Add ---
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim()) return;
    setAddSubmitting(true);
    try {
      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addName.trim(),
          ...(addDesc.trim() ? { description: addDesc.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        setAddName("");
        setAddDesc("");
        setShowAddForm(false);
        await fetchDepartments();
      } else {
        setError(json.error ?? "Failed to add department");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add department");
    } finally {
      setAddSubmitting(false);
    }
  };

  const cancelAdd = () => {
    setAddName("");
    setAddDesc("");
    setShowAddForm(false);
  };

  // --- Edit ---
  const startEdit = (dept: Department) => {
    setEditingId(dept.id);
    setEditName(dept.name);
    setEditDesc(dept.description ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditDesc("");
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId || !editName.trim()) return;
    setEditSubmitting(true);
    try {
      const res = await fetch(`/api/departments/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          ...(editDesc.trim() ? { description: editDesc.trim() } : { description: null }),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        cancelEdit();
        await fetchDepartments();
      } else {
        setError(json.error ?? "Failed to update department");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update department");
    } finally {
      setEditSubmitting(false);
    }
  };

  // --- Delete ---
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This action cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/departments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        if (editingId === id) cancelEdit();
        await fetchDepartments();
      } else {
        setError(json.error ?? "Failed to delete department");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete department");
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  };

  const truncate = (str: string, max: number) =>
    str.length > max ? str.slice(0, max) + "…" : str;

  // --- Inline Add Form ---
  const renderAddForm = () => (
    <form
      onSubmit={handleAdd}
      className="bg-white rounded-xl border border-blue-200 p-5 mb-6 space-y-3"
    >
      <h2 className="text-sm font-semibold text-gray-700">New Department</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="e.g. Engineering"
            required
            autoFocus
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Description
          </label>
          <input
            value={addDesc}
            onChange={(e) => setAddDesc(e.target.value)}
            placeholder="Optional description"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={addSubmitting || !addName.trim()}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {addSubmitting ? "Saving…" : "Add Department"}
        </button>
        <button
          type="button"
          onClick={cancelAdd}
          className="border border-gray-200 bg-white text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );

  // --- Edit Form Row (table) ---
  const renderEditRow = (dept: Department) => (
    <tr key={dept.id} className="bg-blue-50/50">
      <td className="px-4 py-3">
        <input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          required
          autoFocus
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </td>
      <td className="px-4 py-3">
        <input
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          placeholder="Optional description"
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </td>
      <td className="px-4 py-3 text-gray-500 text-sm whitespace-nowrap">
        {formatDate(dept.created_at)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleEdit}
            disabled={editSubmitting || !editName.trim()}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {editSubmitting ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            className="border border-gray-200 bg-white text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );

  // --- Desktop Table ---
  const renderDesktopTable = () => (
    <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Name</th>
            <th className="text-left px-4 py-3 font-medium">Description</th>
            <th className="text-left px-4 py-3 font-medium">Created</th>
            <th className="text-right px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {departments.map((dept) =>
            editingId === dept.id ? (
              renderEditRow(dept)
            ) : (
              <tr key={dept.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {dept.name}
                </td>
                <td className="px-4 py-3 text-gray-500 max-w-xs">
                  {dept.description ? truncate(dept.description, 80) : (
                    <span className="text-gray-300 italic">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                  {formatDate(dept.created_at)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(dept)}
                      className="text-blue-600 hover:text-blue-800 px-2 py-1 rounded-md text-xs font-medium hover:bg-blue-50 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(dept.id, dept.name)}
                      className="text-red-500 hover:text-red-700 px-2 py-1 rounded-md text-xs font-medium hover:bg-red-50 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );

  // --- Mobile Cards ---
  const renderMobileCards = () => (
    <div className="md:hidden space-y-3">
      {departments.map((dept) =>
        editingId === dept.id ? (
          <form
            key={dept.id}
            onSubmit={handleEdit}
            className="bg-white rounded-xl border border-blue-200 p-4 space-y-3"
          >
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  autoFocus
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Description
                </label>
                <input
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Optional description"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={editSubmitting || !editName.trim()}
                className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {editSubmitting ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="border border-gray-200 bg-white text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div
            key={dept.id}
            className="bg-white rounded-xl border border-gray-200 p-4 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-medium text-gray-900">{dept.name}</h3>
              <div className="flex items-center shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(dept)}
                  className="text-blue-600 hover:text-blue-800 px-2 py-1 rounded-md text-xs font-medium hover:bg-blue-50 transition-colors"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(dept.id, dept.name)}
                  className="text-red-500 hover:text-red-700 px-2 py-1 rounded-md text-xs font-medium hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
            {dept.description ? (
              <p className="text-sm text-gray-500">{dept.description}</p>
            ) : null}
            <p className="text-xs text-gray-400">
              Created {formatDate(dept.created_at)}
            </p>
          </div>
        )
      )}
    </div>
  );

  // --- Main ---
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Departments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage your organization&apos;s departments
          </p>
        </div>
        {!showAddForm && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
          >
            + Add Department
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-500 hover:text-red-700 font-medium ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Add form (inline) */}
      {showAddForm && renderAddForm()}

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          <p className="mt-3 text-sm text-gray-400">Loading departments…</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && departments.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
            <svg
              className="h-6 w-6 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
              />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-900">No departments yet</h3>
          <p className="text-sm text-gray-500 mt-1">
            Get started by adding your first department.
          </p>
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            + Add Department
          </button>
        </div>
      )}

      {/* Department list */}
      {!loading && departments.length > 0 && (
        <>
          {renderDesktopTable()}
          {renderMobileCards()}
        </>
      )}
    </div>
  );
}