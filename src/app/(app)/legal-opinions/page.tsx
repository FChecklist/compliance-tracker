"use client";
import { SimpleModulePage } from "@/components/SimpleModulePage";

export default function LegalOpinionsPage() {
  return (
    <SimpleModulePage
      title="Legal Opinions Register"
      subtitle="Formal legal opinions obtained, by topic and advisor"
      apiPath="/api/legal-opinions"
      listKey="opinions"
      addLabel="Record Opinion"
      emptyMessage="No legal opinions recorded."
      columns={[
        { key: "topic", label: "Topic" },
        { key: "advisor", label: "Advisor" },
        { key: "opinionDate", label: "Date", render: (v) => (v ? new Date(v as string).toLocaleDateString("en-IN") : "—") },
      ]}
      fields={[
        { key: "topic", label: "Topic", required: true, placeholder: "e.g. DPDP Act applicability to HR data" },
        { key: "advisor", label: "Advisor" },
        { key: "opinionDate", label: "Date", type: "date" },
      ]}
    />
  );
}
