"use client";

import { useEffect, useState } from "react";
import { SimpleModulePage, StatusPill } from "@/components/SimpleModulePage";
import { SectorGateNotice } from "@/components/SectorGate";

export default function SebiPage() {
  const [applicable, setApplicable] = useState<boolean | null>(null);
  const [entityType, setEntityType] = useState<string>();

  useEffect(() => {
    fetch("/api/sebi").then((r) => r.json()).then((d) => { setApplicable(d.applicable); setEntityType(d.entityType); });
  }, []);

  if (applicable === null) return null;
  if (!applicable) return <SectorGateNotice title="SEBI Compliance" entityType={entityType} applicableTo="Listed Company" />;

  return (
    <SimpleModulePage
      title="SEBI Compliance"
      subtitle="LODR filing obligations, insider trading code, and disclosures"
      apiPath="/api/sebi"
      listKey="items"
      addLabel="Add Requirement"
      emptyMessage="No SEBI requirements tracked."
      columns={[
        { key: "requirement", label: "Requirement" },
        { key: "dueDate", label: "Due", render: (v) => (v ? new Date(v as string).toLocaleDateString("en-IN") : "—") },
        { key: "status", label: "Status", render: (v) => <StatusPill value={v} /> },
      ]}
      fields={[{ key: "requirement", label: "Requirement", required: true, placeholder: "e.g. Quarterly Compliance Certificate (Reg 27)" }, { key: "dueDate", label: "Due Date", type: "date" }]}
    />
  );
}
