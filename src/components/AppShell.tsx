"use client";

import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { HealthRibbon } from "@/components/HealthRibbon";
import { useEffect, useState } from "react";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [overdueCount, setOverdueCount] = useState(0);

  useEffect(() => {
    fetch("/api/compliance/stats")
      .then((r) => r.json())
      .then((d) => setOverdueCount(d.overdue ?? 0))
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppTopbar />
      <HealthRibbon />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar overdueCount={overdueCount} />
        <main className="flex-1 overflow-auto p-4 md:p-6 bg-ct-cream">
          {children}
        </main>
      </div>
    </div>
  );
}