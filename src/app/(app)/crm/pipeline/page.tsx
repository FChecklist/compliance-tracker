"use client";

export const dynamic = "force-dynamic";

// VERIDIAN Review Framework gap-closure: Sales Pipeline (task-20260718-
// 082004, 2026-08-07). Re-homed onto its own route during the merge with
// main's Wave 3 refactor (2026-07-21), which moved every CRM sub-area's
// full management UI off crm/page.tsx and onto a dedicated page -- this
// Kanban board follows that same, now-established pattern rather than
// living as a tab on the overview. See PipelineKanbanBoard's own header
// comment for what it closes.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Kanban } from "lucide-react";
import { ModuleNotEnabledCard } from "@/components/ModuleNotEnabledCard";
import PipelineKanbanBoard from "@/components/crm/PipelineKanbanBoard";

export default function CrmPipelinePage() {
  const [salesEnabled, setSalesEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setSalesEnabled(d.salesEnabled ?? false)).catch(() => setSalesEnabled(false));
  }, []);

  if (salesEnabled === false) {
    return <ModuleNotEnabledCard moduleName="CRM" settingsSection="Sales & CRM" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/crm" className="flex items-center gap-1.5 text-sm text-ct-muted hover:text-ct-navy transition-colors mb-2">
          <ArrowLeft className="size-3.5" /> Back to CRM
        </Link>
        <h1 className="text-2xl font-heading text-ct-navy flex items-center gap-2"><Kanban className="size-5 text-ct-saffron" /> Pipeline</h1>
        <p className="text-sm text-ct-muted mt-1">Drag deals through your organisation's configured stages.</p>
      </div>

      <PipelineKanbanBoard />
    </div>
  );
}
