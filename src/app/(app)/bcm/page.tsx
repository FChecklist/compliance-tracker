"use client";
import { SimpleModulePage, StatusPill } from "@/components/SimpleModulePage";

export default function BcmPage() {
  return (
    <SimpleModulePage
      title="Business Continuity"
      subtitle="Continuity and disaster recovery plans, tested on schedule"
      apiPath="/api/bcm"
      listKey="plans"
      addLabel="Add Plan"
      emptyMessage="No continuity plans recorded."
      columns={[
        { key: "planName", label: "Plan" },
        { key: "lastTestedDate", label: "Last Tested", render: (v) => (v ? new Date(v as string).toLocaleDateString("en-IN") : "Not tested") },
        { key: "status", label: "Status", render: (v) => <StatusPill value={v} /> },
      ]}
      fields={[{ key: "planName", label: "Plan Name", required: true }]}
    />
  );
}
