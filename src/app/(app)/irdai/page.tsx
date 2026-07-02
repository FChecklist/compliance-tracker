"use client";

import { useEffect, useState } from "react";
import { SimpleModulePage, StatusPill } from "@/components/SimpleModulePage";
import { SectorGateNotice } from "@/components/SectorGate";

export default function IrdaiPage() {
  const [applicable, setApplicable] = useState<boolean | null>(null);
  const [entityType, setEntityType] = useState<string>();

  useEffect(() => {
    fetch("/api/irdai").then((r) => r.json()).then((d) => { setApplicable(d.applicable); setEntityType(d.entityType); });
  }, []);

  if (applicable === null) return null;
  if (!applicable) return <SectorGateNotice title="IRDAI Compliance" entityType={entityType} applicableTo="Insurer" />;

  return (
    <SimpleModulePage
      title="IRDAI Compliance"
      subtitle="Governance, prudential, and policyholder-protection obligations"
      apiPath="/api/irdai"
      listKey="items"
      addLabel="Add Requirement"
      emptyMessage="No IRDAI requirements tracked."
      columns={[
        { key: "requirement", label: "Requirement" },
        { key: "category", label: "Category" },
        { key: "status", label: "Status", render: (v) => <StatusPill value={v} /> },
      ]}
      fields={[{ key: "requirement", label: "Requirement", required: true }, { key: "category", label: "Category", placeholder: "e.g. Prudential" }]}
    />
  );
}
