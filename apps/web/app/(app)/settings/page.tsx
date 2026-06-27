"use client";

import { useEffect, useState, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────

type User = {
  id: string;
  full_name: string;
  email: string;
};

type Organisation = {
  id: string;
  name: string;
  onboarding_step: number;
  onboarding_completed: boolean;
  timezone: string;
  financial_year_start: string;
};

type Toast = {
  id: number;
  message: string;
  type: "success" | "error";
};

// ─── Constants ────────────────────────────────────────────────────────────

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const TIMEZONES = [
  { label: "UTC (Coordinated Universal Time)", value: "UTC" },
  { label: "US/Eastern (New York, -05:00)", value: "America/New_York" },
  { label: "US/Central (Chicago, -06:00)", value: "America/Chicago" },
  { label: "US/Mountain (Denver, -07:00)", value: "America/Denver" },
  { label: "US/Pacific (Los Angeles, -08:00)", value: "America/Los_Angeles" },
  { label: "US/Alaska (Anchorage, -09:00)", value: "America/Anchorage" },
  { label: "US/Hawaii (Honolulu, -10:00)", value: "Pacific/Honolulu" },
  { label: "Canada/Atlantic (Halifax, -04:00)", value: "America/Halifax" },
  { label: "Canada/Newfoundland (-03:30)", value: "America/St_Johns" },
  { label: "UK (London, +00:00)", value: "Europe/London" },
  { label: "Central Europe (Paris/Berlin, +01:00)", value: "Europe/Paris" },
  { label: "Eastern Europe (Athens/Bucharest, +02:00)", value: "Europe/Athens" },
  { label: "Moscow (Russia, +03:00)", value: "Europe/Moscow" },
  { label: "Dubai (Gulf, +04:00)", value: "Asia/Dubai" },
  { label: "India (Kolkata/Mumbai, +05:30)", value: "Asia/Kolkata" },
  { label: "Bangladesh (Dhaka, +06:00)", value: "Asia/Dhaka" },
  { label: "Thailand/Vietnam (Bangkok, +07:00)", value: "Asia/Bangkok" },
  { label: "China/Singapore (+08:00)", value: "Asia/Singapore" },
  { label: "Japan/Korea (Tokyo/Seoul, +09:00)", value: "Asia/Tokyo" },
  { label: "Australia/West (Perth, +08:00)", value: "Australia/Perth" },
  { label: "Australia/Central (Adelaide, +09:30)", value: "Australia/Adelaide" },
  { label: "Australia/East (Sydney/Melbourne, +10:00)", value: "Australia/Sydney" },
  { label: "New Zealand (Auckland, +12:00)", value: "Pacific/Auckland" },
  { label: "Brazil/East (Sao Paulo, -03:00)", value: "America/Sao_Paulo" },
  { label: "Argentina (Buenos Aires, -03:00)", value: "America/Argentina/Buenos_Aires" },
  { label: "Mexico City (-06:00)", value: "America/Mexico_City" },
  { label: "South Africa (Johannesburg, +02:00)", value: "Africa/Johannesburg" },
  { label: "Nigeria (Lagos, +01:00)", value: "Africa/Lagos" },
  { label: "Egypt (Cairo, +02:00)", value: "Africa/Cairo" },
  { label: "Iran (Tehran, +03:30)", value: "Asia/Tehran" },
  { label: "Pakistan (Karachi, +05:00)", value: "Asia/Karachi" },
  { label: "Indonesia (Jakarta, +07:00)", value: "Asia/Jakarta" },
  { label: "Philippines (Manila, +08:00)", value: "Asia/Manila" },
  { label: "Taiwan (+08:00)", value: "Asia/Taipei" },
  { label: "Hong Kong (+08:00)", value: "Asia/Hong_Kong" },
  { label: "Nepal (Kathmandu, +05:45)", value: "Asia/Kathmandu" },
  { label: "Sri Lanka (Colombo, +05:30)", value: "Asia/Colombo" },
  { label: "Fiji (+12:00)", value: "Pacific/Fiji" },
];

// ─── Skeleton Component ───────────────────────────────────────────────────

function SettingsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-40 rounded-lg bg-gray-200" />
      {/* Profile skeleton */}
      <div className="rounded-xl bg-white border border-gray-200 p-6 space-y-4">
        <div className="h-5 w-20 rounded bg-gray-200" />
        <div className="space-y-3">
          <div className="h-4 w-24 rounded bg-gray-100" />
          <div className="h-10 w-full rounded-lg bg-gray-100" />
        </div>
        <div className="space-y-3">
          <div className="h-4 w-16 rounded bg-gray-100" />
          <div className="h-10 w-full rounded-lg bg-gray-100" />
        </div>
        <div className="h-10 w-28 rounded-lg bg-gray-200" />
      </div>
      {/* Org skeleton */}
      <div className="rounded-xl bg-white border border-gray-200 p-6 space-y-4">
        <div className="h-5 w-28 rounded bg-gray-200" />
        <div className="space-y-3">
          <div className="h-4 w-36 rounded bg-gray-100" />
          <div className="h-10 w-full rounded-lg bg-gray-100" />
        </div>
        <div className="space-y-3">
          <div className="h-4 w-20 rounded bg-gray-100" />
          <div className="h-10 w-full rounded-lg bg-gray-100" />
        </div>
        <div className="space-y-3">
          <div className="h-4 w-40 rounded bg-gray-100" />
          <div className="h-10 w-full rounded-lg bg-gray-100" />
        </div>
        <div className="h-10 w-28 rounded-lg bg-gray-200" />
      </div>
      {/* Danger zone skeleton */}
      <div className="rounded-xl bg-white border-2 border-gray-200 p-6 space-y-4">
        <div className="h-5 w-28 rounded bg-gray-200" />
        <div className="h-4 w-64 rounded bg-gray-100" />
        <div className="h-10 w-44 rounded-lg bg-gray-200" />
      </div>
    </div>
  );
}

// ─── Toast Component ──────────────────────────────────────────────────────

function ToastBar({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-full max-w-md px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
            t.type === "success"
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
      />
      {/* Dialog */}
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="mt-2 text-sm text-gray-600 leading-relaxed">
          {description}
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Deleting..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Page ────────────────────────────────────────────────────────

export default function SettingsPage() {
  // ── Data state ────────────────────────────────────────────────────────
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Organisation | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Form state ────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [financialYearStart, setFinancialYearStart] = useState("");

  // ── Save states ───────────────────────────────────────────────────────
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);

  // ── Danger zone ───────────────────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Toast state ───────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback((message: string, type: Toast["type"]) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  // ── Fetch user & org data ─────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error(`Failed to load user data (${res.status})`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Unexpected response");

      const u = json.user as User;
      const o = json.organisation as Organisation;

      setUser(u);
      setOrg(o);
      setFullName(u.full_name ?? "");
      setTimezone(o.timezone ?? "UTC");
      setFinancialYearStart(o.financial_year_start ?? "January");
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to load settings",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Save profile ──────────────────────────────────────────────────────
  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName }),
      });
      if (!res.ok) throw new Error(`Failed to update profile (${res.status})`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Update failed");
      setUser((prev) => (prev ? { ...prev, full_name: fullName } : prev));
      addToast("Profile updated successfully", "success");
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to update profile",
        "error"
      );
    } finally {
      setSavingProfile(false);
    }
  }

  // ── Save org ──────────────────────────────────────────────────────────
  async function handleSaveOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    setSavingOrg(true);
    try {
      const res = await fetch(`/api/orgs/${org.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone,
          financial_year_start: financialYearStart,
        }),
      });
      if (!res.ok) throw new Error(`Failed to update organisation (${res.status})`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Update failed");
      setOrg((prev) =>
        prev
          ? { ...prev, timezone, financial_year_start: financialYearStart }
          : prev
      );
      addToast("Organisation settings saved", "success");
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to update organisation",
        "error"
      );
    } finally {
      setSavingOrg(false);
    }
  }

  // ── Delete org ────────────────────────────────────────────────────────
  async function handleDeleteOrg() {
    if (!org) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/orgs/${org.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed to delete organisation (${res.status})`);
      addToast("Organisation deleted. You will be redirected...", "success");
      setTimeout(() => {
        window.location.href = "/";
      }, 2000);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to delete organisation",
        "error"
      );
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl">
        <SettingsSkeleton />
      </div>
    );
  }

  return (
    <>
      <ToastBar toasts={toasts} />
      <ConfirmDialog
        open={confirmOpen}
        title="Delete Organisation"
        description="This action is permanent and cannot be undone. All compliance data, departments, users, and audit logs associated with this organisation will be permanently removed."
        confirmLabel="Delete Organisation"
        onConfirm={handleDeleteOrg}
        onCancel={() => setConfirmOpen(false)}
        loading={deleting}
      />

      <div className="mx-auto max-w-2xl space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your profile and organisation preferences
          </p>
        </div>

        {/* ── Profile Section ─────────────────────────────────────────── */}
        <form
          onSubmit={handleSaveProfile}
          className="rounded-xl bg-white border border-gray-200 p-6"
        >
          <h2 className="text-base font-semibold text-gray-800 mb-4">Profile</h2>

          <div className="space-y-4">
            {/* Full Name */}
            <div>
              <label
                htmlFor="full-name"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Full Name
              </label>
              <input
                id="full-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {/* Email (read-only) */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={user?.email ?? ""}
                readOnly
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
              />
            </div>

            {/* Save */}
            <div className="pt-1">
              <button
                type="submit"
                disabled={savingProfile}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingProfile ? "Saving..." : "Save Profile"}
              </button>
            </div>
          </div>
        </form>

        {/* ── Organisation Section ────────────────────────────────────── */}
        <form
          onSubmit={handleSaveOrg}
          className="rounded-xl bg-white border border-gray-200 p-6"
        >
          <h2 className="text-base font-semibold text-gray-800 mb-4">
            Organisation
          </h2>

          <div className="space-y-4">
            {/* Organisation Name (read-only) */}
            <div>
              <label
                htmlFor="org-name"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Organisation Name
              </label>
              <input
                id="org-name"
                type="text"
                value={org?.name ?? ""}
                readOnly
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
              />
            </div>

            {/* Timezone */}
            <div>
              <label
                htmlFor="timezone"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Timezone
              </label>
              <select
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Financial Year Start */}
            <div>
              <label
                htmlFor="fys"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Financial Year Start
              </label>
              <select
                id="fys"
                value={financialYearStart}
                onChange={(e) => setFinancialYearStart(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* Save */}
            <div className="pt-1">
              <button
                type="submit"
                disabled={savingOrg}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingOrg ? "Saving..." : "Save Organisation"}
              </button>
            </div>
          </div>
        </form>

        {/* ── Danger Zone ─────────────────────────────────────────────── */}
        <div className="rounded-xl bg-white border-2 border-red-200 p-6">
          <h2 className="text-base font-semibold text-red-700 mb-1">
            Danger Zone
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Irreversible and destructive actions. Proceed with extreme caution.
          </p>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700"
          >
            Delete Organisation
          </button>
        </div>
      </div>
    </>
  );
}