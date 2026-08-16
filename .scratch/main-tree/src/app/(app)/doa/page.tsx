"use client";
import { SimpleModulePage } from "@/components/SimpleModulePage";

export default function DoAPage() {
  return (
    <SimpleModulePage
      title="Delegation of Authority"
      subtitle="Who can approve what, up to what threshold"
      apiPath="/api/doa"
      listKey="doa"
      addLabel="Add Entry"
      emptyMessage="No delegation-of-authority entries recorded."
      columns={[
        { key: "activity", label: "Activity" },
        { key: "thresholdDescription", label: "Threshold" },
        { key: "approverRole", label: "Approver" },
      ]}
      fields={[
        { key: "activity", label: "Activity", required: true, placeholder: "e.g. Capital expenditure approval" },
        { key: "thresholdDescription", label: "Threshold", placeholder: "e.g. Up to ₹5,00,000" },
        { key: "approverRole", label: "Approver Role", placeholder: "e.g. CFO" },
      ]}
    />
  );
}
