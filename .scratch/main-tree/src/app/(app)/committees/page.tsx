"use client";
import { SimpleModulePage } from "@/components/SimpleModulePage";

export default function CommitteesPage() {
  return (
    <SimpleModulePage
      title="Committees"
      subtitle="Board committees — charter, chair, and meeting cadence"
      apiPath="/api/committees"
      listKey="committees"
      addLabel="Add Committee"
      emptyMessage="No committees recorded yet."
      columns={[
        { key: "name", label: "Name" },
        { key: "charter", label: "Charter" },
        { key: "cadence", label: "Cadence" },
        { key: "lastMetDate", label: "Last Met", render: (v) => (v ? new Date(v as string).toLocaleDateString("en-IN") : "—") },
      ]}
      fields={[
        { key: "name", label: "Committee Name", required: true, placeholder: "e.g. Audit Committee" },
        { key: "charter", label: "Charter", placeholder: "Purpose / scope" },
        { key: "cadence", label: "Cadence", placeholder: "e.g. Quarterly" },
      ]}
    />
  );
}
