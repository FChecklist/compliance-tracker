"use client";
import { SimpleModulePage, StatusPill } from "@/components/SimpleModulePage";

export default function SecretarialAuditPage() {
  return (
    <SimpleModulePage
      title="Secretarial Audit"
      subtitle="Form MR-3 secretarial audit engagements, by period"
      apiPath="/api/secretarial-audit"
      listKey="audits"
      addLabel="Add Audit Period"
      emptyMessage="No secretarial audits recorded."
      columns={[
        { key: "period", label: "Period" },
        { key: "auditorName", label: "Auditor" },
        { key: "status", label: "Status", render: (v) => <StatusPill value={v} /> },
        { key: "dueDate", label: "Due", render: (v) => (v ? new Date(v as string).toLocaleDateString("en-IN") : "—") },
      ]}
      fields={[
        { key: "period", label: "Period", required: true, placeholder: "e.g. FY 2025-26" },
        { key: "auditorName", label: "Auditor", placeholder: "e.g. M/s Sharma & Associates, CS" },
        { key: "dueDate", label: "Due Date", type: "date" },
      ]}
    />
  );
}
