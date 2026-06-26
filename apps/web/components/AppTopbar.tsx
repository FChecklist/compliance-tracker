"use client";
import { useRouter } from "next/navigation";

export function AppTopbar() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }
  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div className="text-sm text-gray-500">ComplianceTrack</div>
      <button onClick={logout} className="text-sm text-gray-500 hover:text-red-600 transition">Sign out</button>
    </header>
  );
}