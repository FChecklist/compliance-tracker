"use client";

// Checks & Balances / Role-Based Approval Matrix gap-closure: the matrix
// previously only existed per-workflow-definition (GET /api/approval-
// workflows?entityType=X) -- an admin had no single place to see every
// entity type's approval chain at once. This reads the SAME endpoint with
// no entityType filter (listWorkflowDefinitions already returns every
// definition for the org when entityType is omitted) and renders all of
// them together, one row per step, so "who can approve what, across every
// module" is answerable at a glance. Distinct from src/app/(app)/doa (a
// manually-entered Delegation-of-Authority table) -- this is derived live
// from the real, enforced approvalWorkflowDefinitions/steps data, not a
// separately-maintained record.
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HIGH_IMPACT_CATEGORY_LABELS, type HighImpactCategory } from "@/lib/high-impact-action-detector";

type MatrixStep = {
  id: string;
  stepOrder: number;
  name: string;
  approverRole: string;
  requiredApprovals: number;
  conditionField: string | null;
  highImpactCategory: HighImpactCategory | null;
  fourEyesSatisfied: boolean;
};

type MatrixWorkflow = {
  id: string;
  entityType: string;
  name: string;
  isActive: boolean;
  steps: MatrixStep[];
};

export function ApprovalMatrixSection() {
  const [workflows, setWorkflows] = useState<MatrixWorkflow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/approval-workflows")
      .then((r) => r.json())
      .then((d) => { setWorkflows(d.workflows ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (!loading && workflows.length === 0) return null;

  const rows = workflows.flatMap((wf) => wf.steps.map((step) => ({ wf, step })));

  return (
    <div>
      <h2 className="font-heading text-lg text-ct-navy mb-1">Approval Matrix</h2>
      <p className="text-xs text-ct-muted mb-2">Every configured approval chain across all entity types, in one place -- who can approve what, and whether four-eyes (2+ approvers) applies.</p>
      <Card className="rounded-xl shadow-card bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border">
              <th className="p-3 font-medium">Entity Type</th>
              <th className="p-3 font-medium">Workflow</th>
              <th className="p-3 font-medium">Step</th>
              <th className="p-3 font-medium">Approver Role</th>
              <th className="p-3 font-medium">Required Approvals</th>
              <th className="p-3 font-medium">Critical Category</th>
              <th className="p-3 font-medium">Conditional</th>
            </tr></thead>
            <tbody className="divide-y divide-ct-border">
              {loading ? <tr><td colSpan={7} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                : rows.map(({ wf, step }) => (
                  <tr key={step.id} className="hover:bg-ct-row-hover">
                    <td className="p-3">{wf.entityType.replace(/_/g, " ")}</td>
                    <td className="p-3">{wf.name}{!wf.isActive && <Badge className="ml-2 bg-ct-cloud text-ct-muted">inactive</Badge>}</td>
                    <td className="p-3">{step.stepOrder}. {step.name}</td>
                    <td className="p-3"><Badge className="bg-ct-cloud text-ct-muted capitalize">{step.approverRole.replace(/_/g, " ")}+</Badge></td>
                    <td className="p-3">
                      {step.requiredApprovals}
                      {step.highImpactCategory && (
                        <Badge className={`ml-2 ${step.fourEyesSatisfied ? "bg-ct-teal/10 text-ct-teal" : "bg-ct-saffron/10 text-ct-saffron"}`}>
                          {step.fourEyesSatisfied ? "four-eyes" : "four-eyes required"}
                        </Badge>
                      )}
                    </td>
                    <td className="p-3">{step.highImpactCategory ? <Badge className="bg-ct-navy/10 text-ct-navy">{HIGH_IMPACT_CATEGORY_LABELS[step.highImpactCategory]}</Badge> : <span className="text-ct-muted">—</span>}</td>
                    <td className="p-3">{step.conditionField ? <span className="text-ct-muted">{step.conditionField}</span> : <span className="text-ct-muted">—</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
