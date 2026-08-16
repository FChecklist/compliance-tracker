"use client";
import { SimpleModulePage } from "@/components/SimpleModulePage";

export default function ContractCompliancePage() {
  return (
    <SimpleModulePage
      title="Contract Compliance"
      subtitle="Regulatory and SLA obligations embedded in vendor contracts"
      apiPath="/api/contract-compliance"
      listKey="items"
      addLabel="Add Clause"
      emptyMessage="No contract compliance clauses tracked."
      columns={[
        { key: "vendorName", label: "Vendor" },
        { key: "clauseDescription", label: "Key Clause" },
        { key: "renewalDate", label: "Renewal", render: (v) => (v ? new Date(v as string).toLocaleDateString("en-IN") : "—") },
      ]}
      fields={[
        { key: "vendorName", label: "Vendor", required: true },
        { key: "clauseDescription", label: "Key Compliance Clause", placeholder: "e.g. SOC 2 report annually" },
        { key: "renewalDate", label: "Renewal Date", type: "date" },
      ]}
    />
  );
}
