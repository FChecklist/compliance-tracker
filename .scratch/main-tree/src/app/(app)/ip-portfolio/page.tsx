"use client";
import { SimpleModulePage, StatusPill } from "@/components/SimpleModulePage";

export default function IpPortfolioPage() {
  return (
    <SimpleModulePage
      title="IP Portfolio"
      subtitle="Trademarks, patents, copyrights, designs — status and renewal tracking"
      apiPath="/api/ip-portfolio"
      listKey="items"
      addLabel="Add IP Asset"
      emptyMessage="No IP assets recorded."
      columns={[
        { key: "mark", label: "Mark / Asset" },
        { key: "ipType", label: "Type" },
        { key: "status", label: "Status", render: (v) => <StatusPill value={v} /> },
        { key: "renewalDate", label: "Renewal", render: (v) => (v ? new Date(v as string).toLocaleDateString("en-IN") : "—") },
      ]}
      fields={[
        { key: "mark", label: "Mark / Asset Name", required: true },
        { key: "ipType", label: "Type", placeholder: "Trademark / Patent / Copyright / Design" },
        { key: "renewalDate", label: "Renewal Date", type: "date" },
      ]}
    />
  );
}
