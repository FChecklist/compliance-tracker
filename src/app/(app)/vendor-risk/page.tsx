"use client";
import { SimpleModulePage, StatusPill } from "@/components/SimpleModulePage";

export default function VendorRiskPage() {
  return (
    <SimpleModulePage
      title="Vendor & Third-Party Risk"
      subtitle="Due diligence and ongoing risk tracking for every vendor"
      apiPath="/api/vendor-risk"
      listKey="vendors"
      addLabel="Add Vendor"
      emptyMessage="No vendors assessed yet."
      columns={[
        { key: "name", label: "Vendor" },
        { key: "riskTier", label: "Risk Tier", render: (v) => <StatusPill value={v} /> },
        { key: "lastAssessedDate", label: "Last Assessed", render: (v) => (v ? new Date(v as string).toLocaleDateString("en-IN") : "Not yet assessed") },
      ]}
      fields={[{ key: "name", label: "Vendor Name", required: true }]}
    />
  );
}
