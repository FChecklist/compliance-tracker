"use client";

import { ApprovalTab } from "@/components/home/ApprovalTab";
import { WorkflowApprovalsSection } from "@/components/home/WorkflowApprovalsSection";
import { ApprovalMatrixSection } from "@/components/home/ApprovalMatrixSection";

export default function ApprovalsPage() {
  return (
    <div className="space-y-6">
      <ApprovalTab showHeader />
      <WorkflowApprovalsSection />
      <ApprovalMatrixSection />
    </div>
  );
}
