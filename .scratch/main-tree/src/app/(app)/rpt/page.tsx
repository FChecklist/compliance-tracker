"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { SimpleModulePage, StatusPill } from "@/components/SimpleModulePage";

export default function RPTPage() {
  const [restricted, setRestricted] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/rpt").then((r) => r.json()).then((d) => setRestricted(!!d.restricted));
  }, []);

  if (restricted === null) return null;
  if (restricted) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Related Party Transactions</h1>
        <Card className="rounded-xl border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">This module is classified Board-only</p>
          <p className="text-xs text-red-600/80 mt-1">Your account does not have clearance to view RPT records.</p>
        </Card>
      </div>
    );
  }

  return (
    <SimpleModulePage
      title="Related Party Transactions"
      subtitle="Classified Board-only — every RPT tracked with approval status"
      apiPath="/api/rpt"
      listKey="rpts"
      addLabel="Record RPT"
      emptyMessage="No related party transactions recorded."
      columns={[
        { key: "partyName", label: "Party" },
        { key: "natureOfTransaction", label: "Nature" },
        { key: "amount", label: "Amount", render: (v) => (v ? `₹${v}` : "—") },
        { key: "approvalStatus", label: "Status", render: (v) => <StatusPill value={v} /> },
        { key: "transactionDate", label: "Date", render: (v) => (v ? new Date(v as string).toLocaleDateString("en-IN") : "—") },
      ]}
      fields={[
        { key: "partyName", label: "Party Name", required: true },
        { key: "natureOfTransaction", label: "Nature of Transaction" },
        { key: "amount", label: "Amount (₹)", type: "number" },
        { key: "transactionDate", label: "Transaction Date", type: "date" },
      ]}
    />
  );
}
