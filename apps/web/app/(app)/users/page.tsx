"use client";
import { useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────

type User = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  phone: string | null;
  created_at: string;
};

type UsersResponse = {
  success: boolean;
  data: User[];
  error?: { code: string; message: string };
};

// ─── Constants ────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: "account_admin", label: "Account Admin" },
  { value: "client_department_admin", label: "Dept. Admin" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
] as const;

const ROLE_BADGE: Record<string, string> = {
  account_admin: "bg-purple-100 text-purple-700",
  client_department_admin: "bg-blue-100 text-blue-700",
  editor: "bg-green-100 text-green-700",
  viewer: "bg-gray-100 text-gray-600",
};

const ROLE_LABEL: Record<string, string> = {
  account_admin: "Account Admin",
  client_department_admin: "Dept. Admin",
  editor: "Editor",
  viewer: "Viewer",
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Skeleton ─────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="animate-pulse divide-y divide-gray-100">
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="flex items-center gap-4 px-6 py-4">
          <div className="h-4 w-36 rounded bg-gray-200" />
          <div className="h-4 w-48 rounded bg-gray-200" />
          <div className="h-5 w-24 rounded-full bg-gray-200" />
          <div className="h-4 w-16 rounded bg-gray-200" />
          <div className="h-4 w-28 rounded bg-gray-200" />
          <div className="ml-auto h-8 w-28 rounded-lg bg-gray-200" />
        </tr>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function UsersPage() {
  // ── Data state ─────────────────────────────────────────────────────────
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Invite form state ──────────────────────────────────────────────────
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // ── Role change state ──────────────────────────────────────────────────
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);

  // ── Fetch users ────────────────────────────────────────────────────────
  async function fetchUsers() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/users");

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as UsersResponse | null;
        throw new Error(
          body?.error?.message ?? `Request failed (${res.status})`
        );
      }

      const json = (await res.json()) as UsersResponse;

      if (!json.success) {
        throw new Error(json.error?.message ?? "Unexpected response");
      }

      setUsers(json.data ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load users"
      );
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  // ── Invite handler ─────────────────────────────────────────────────────
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteLoading(true);

    try {
      const res = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        throw new Error(
          json?.error?.message ?? `Invite failed (${res.status})`
        );
      }

      setInviteEmail("");
      setInviteRole("editor");
      setShowInvite(false);
      await fetchUsers();
    } catch (err) {
      setInviteError(
        err instanceof Error ? err.message : "Failed to send invite"
      );
    } finally {
      setInviteLoading(false);
    }
  }

  // ── Role change handler ────────────────────────────────────────────────
  async function handleRoleChange(userId: string, newRole: string) {
    setChangingRoleId(userId);

    try {
      const res = await fetch(`/api/users/${userId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        throw new Error(
          json?.error?.message ?? `Role update failed (${res.status})`
        );
      }

      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
    } catch (err) {
      // Silently revert the select on error — the user sees the old role
      await fetchUsers();
    } finally {
      setChangingRoleId(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          {!loading && !error && (
            <p className="mt-1 text-sm text-gray-500">
              {users.length} user{users.length !== 1 ? "s" : ""} total
            </p>
          )}
        </div>

        {!showInvite && (
          <button
            onClick={() => setShowInvite(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            Invite User
          </button>
        )}
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">
            Invite a team member
          </h2>

          {inviteError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4 shrink-0"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{inviteError}</span>
            </div>
          )}

          <form onSubmit={handleInvite}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_auto]">
              {/* Email */}
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Email address"
                disabled={inviteLoading}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
              />

              {/* Role select */}
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                disabled={inviteLoading}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={inviteLoading}
                  className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {inviteLoading ? (
                    <svg
                      className="h-4 w-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>
                  ) : null}
                  {inviteLoading ? "Sending…" : "Send Invite"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowInvite(false);
                    setInviteError(null);
                  }}
                  disabled={inviteLoading}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Users table card */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {/* Error banner */}
        {error && !loading && (
          <div className="flex items-center gap-3 border-b border-gray-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4 shrink-0"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
            <button
              onClick={fetchUsers}
              className="ml-auto shrink-0 font-medium underline underline-offset-2 hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && <TableSkeleton />}

        {/* Empty state */}
        {!loading && !error && users.length === 0 && (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="mb-3 h-10 w-10 text-gray-300"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-sm font-medium text-gray-500">
              No users yet
            </p>
            <p className="mt-1 text-sm text-gray-400">
              Invite your first team member to get started.
            </p>
            {!showInvite && (
              <button
                onClick={() => setShowInvite(true)}
                className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Invite a user
              </button>
            )}
          </div>
        )}

        {/* Users table */}
        {!loading && !error && users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/80">
                  <th className="px-6 py-3 text-left font-medium text-gray-600">
                    Full Name
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-600">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-600">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-600">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-600">
                    Joined
                  </th>
                  <th className="px-6 py-3 text-right font-medium text-gray-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="transition-colors hover:bg-gray-50"
                  >
                    {/* Full Name */}
                    <td className="whitespace-nowrap px-6 py-4 font-medium text-gray-900">
                      {user.full_name}
                    </td>

                    {/* Email */}
                    <td className="whitespace-nowrap px-6 py-4 text-gray-600">
                      {user.email}
                    </td>

                    {/* Role badge */}
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_BADGE[user.role] ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {ROLE_LABEL[user.role] ?? user.role.replace(/_/g, " ")}
                      </span>
                    </td>

                    {/* Active status */}
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${user.is_active ? "bg-green-500" : "bg-gray-300"}`}
                        />
                        <span
                          className={
                            user.is_active ? "text-green-700" : "text-gray-400"
                          }
                        >
                          {user.is_active ? "Active" : "Inactive"}
                        </span>
                      </span>
                    </td>

                    {/* Created date */}
                    <td className="whitespace-nowrap px-6 py-4 text-gray-500">
                      {formatDate(user.created_at)}
                    </td>

                    {/* Actions — Change Role */}
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      {changingRoleId === user.id ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                          <svg
                            className="h-3.5 w-3.5 animate-spin"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                            />
                          </svg>
                          Saving…
                        </span>
                      ) : (
                        <select
                          value={user.role}
                          onChange={(e) =>
                            handleRoleChange(user.id, e.target.value)
                          }
                          aria-label={`Change role for ${user.full_name}`}
                          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}