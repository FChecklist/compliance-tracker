"use client";
import { SimpleModulePage, StatusPill } from "@/components/SimpleModulePage";

export default function McaFilingsPage() {
  return (
    <SimpleModulePage
      title="MCA e-Filing"
      subtitle="Preparation and status tracking only — this platform does not submit filings to the government MCA portal; that requires the Company Secretary's own Digital Signature Certificate"
      apiPath="/api/mca-filings"
      listKey="filings"
      addLabel="Track New Filing"
      emptyMessage="No MCA filings tracked."
      columns={[
        { key: "formType", label: "Form" },
        { key: "description", label: "Description" },
        { key: "dueDate", label: "Due", render: (v) => (v ? new Date(v as string).toLocaleDateString("en-IN") : "—") },
        { key: "status", label: "Status", render: (v) => <StatusPill value={v} /> },
        { key: "srn", label: "SRN" },
      ]}
      fields={[
        { key: "formType", label: "Form Type", required: true, placeholder: "e.g. AOC-4, MGT-7, CHG-1" },
        { key: "description", label: "Description" },
        { key: "dueDate", label: "Due Date", type: "date" },
      ]}
    />
  );
}
