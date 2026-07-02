"use client";
import { SimpleModulePage, StatusPill } from "@/components/SimpleModulePage";

export default function ChargesPage() {
  return (
    <SimpleModulePage
      title="Charges (ROC)"
      subtitle="Register of Charges — CHG-1/CHG-4 filings against company assets"
      apiPath="/api/charges"
      listKey="charges"
      addLabel="Add Charge"
      emptyMessage="No charges recorded."
      columns={[
        { key: "chargeHolder", label: "Charge Holder" },
        { key: "chargeType", label: "Type" },
        { key: "amount", label: "Amount", render: (v) => (v ? `₹${v}` : "—") },
        { key: "filingReference", label: "Filing Ref" },
        { key: "status", label: "Status", render: (v) => <StatusPill value={v} /> },
      ]}
      fields={[
        { key: "chargeHolder", label: "Charge Holder", required: true, placeholder: "e.g. HDFC Bank Ltd" },
        { key: "chargeType", label: "Type", placeholder: "e.g. Term Loan" },
        { key: "amount", label: "Amount (₹)", type: "number" },
        { key: "filingReference", label: "Filing Reference", placeholder: "e.g. CHG-1 filed Jan 2024" },
      ]}
    />
  );
}
