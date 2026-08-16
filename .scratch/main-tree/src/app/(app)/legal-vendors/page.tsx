"use client";
import { SimpleModulePage, StatusPill } from "@/components/SimpleModulePage";

export default function LegalVendorsPage() {
  return (
    <SimpleModulePage
      title="External Counsel & Legal Vendors"
      subtitle="Every law firm, CS agency, and legal consultant engaged"
      apiPath="/api/legal-vendors"
      listKey="vendors"
      addLabel="Add Engagement"
      emptyMessage="No legal vendors engaged."
      columns={[
        { key: "name", label: "Firm / Consultant" },
        { key: "vendorType", label: "Type" },
        { key: "engagementType", label: "Engagement" },
        { key: "currentMatter", label: "Current Matter" },
        { key: "status", label: "Status", render: (v) => <StatusPill value={v} /> },
      ]}
      fields={[
        { key: "name", label: "Firm / Consultant Name", required: true },
        { key: "vendorType", label: "Type", placeholder: "Law Firm / CS Agency / Tax Advisory" },
        { key: "engagementType", label: "Engagement", placeholder: "Retainer / Ad-hoc" },
        { key: "currentMatter", label: "Current Matter" },
      ]}
    />
  );
}
