"use client";

import { useEffect, useState } from "react";
import { SimpleModulePage, StatusPill } from "@/components/SimpleModulePage";
import { SectorGateNotice } from "@/components/SectorGate";

export default function RbiPage() {
  const [applicable, setApplicable] = useState<boolean | null>(null);
  const [entityType, setEntityType] = useState<string>();

  useEffect(() => {
    fetch("/api/rbi").then((r) => r.json()).then((d) => { setApplicable(d.applicable); setEntityType(d.entityType); });
  }, []);

  if (applicable === null) return null;
  if (!applicable) return <SectorGateNotice title="RBI Compliance" entityType={entityType} applicableTo="Bank / NBFC" />;

  return (
    <SimpleModulePage
      title="RBI Compliance"
      subtitle="Master directions and circulars, tracked to implementation status"
      apiPath="/api/rbi"
      listKey="items"
      addLabel="Add Circular"
      emptyMessage="No RBI circulars tracked."
      columns={[
        { key: "circular", label: "Circular / Master Direction" },
        { key: "category", label: "Category" },
        { key: "status", label: "Status", render: (v) => <StatusPill value={v} /> },
      ]}
      fields={[{ key: "circular", label: "Circular / Master Direction", required: true }, { key: "category", label: "Category", placeholder: "e.g. KYC/AML" }]}
    />
  );
}
