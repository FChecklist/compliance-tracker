"use client";
import { SimpleModulePage, StatusPill } from "@/components/SimpleModulePage";

export default function DirectorsPage() {
  return (
    <SimpleModulePage
      title="Director & KMP Register"
      subtitle="Directors and Key Managerial Personnel — DIN, designation, KYC status"
      apiPath="/api/directors"
      listKey="directors"
      addLabel="Add Director / KMP"
      emptyMessage="No directors or KMP recorded."
      columns={[
        { key: "name", label: "Name" },
        { key: "din", label: "DIN" },
        { key: "designation", label: "Designation" },
        { key: "isIndependent", label: "Independent", render: (v) => (v ? "Yes" : "No") },
        { key: "kycStatus", label: "KYC", render: (v) => <StatusPill value={v} /> },
      ]}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "din", label: "DIN" },
        { key: "designation", label: "Designation", placeholder: "e.g. Independent Director" },
        { key: "appointedDate", label: "Appointed Date", type: "date" },
      ]}
    />
  );
}
