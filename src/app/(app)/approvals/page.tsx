"use client";

import { ApprovalTab } from "@/components/home/ApprovalTab";
import { WorkflowApprovalsSection } from "@/components/home/WorkflowApprovalsSection";

export default function ApprovalsPage() {
  return (
    <div className="space-y-6">
      <ApprovalTab showHeader />
      <WorkflowApprovalsSection />
    </div>
  );
}
