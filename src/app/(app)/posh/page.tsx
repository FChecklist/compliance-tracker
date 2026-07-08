"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/SimpleModulePage";

type SlaStatus = { dueDate: string | null; daysRemaining: number | null; isOverdue: boolean; urgency: "none" | "ok" | "due_soon" | "overdue" };
type Composition = { isValid: boolean; issues: string[]; presidingOfficerCount: number; memberCount: number; externalMemberCount: number; totalCount: number };
type Committee = { id: string; memberName: string; role: string | null };
type Complaint = { id: string; caseRef: string; receivedDate: string; status: string; inquirySla: SlaStatus };
type AnnualReport = { id: string; year: string; filedWith: string | null; status: string };

const SLA_COLORS: Record<SlaStatus["urgency"], string> = { none: "text-ct-muted", ok: "text-ct-muted", due_soon: "text-amber-600", overdue: "text-red-600" };

export default function PoshPage() {
  const [restricted, setRestricted] = useState<boolean | null>(null);
  const [committee, setCommittee] = useState<Committee[]>([]);
  const [composition, setComposition] = useState<Composition | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [annualReports, setAnnualReports] = useState<AnnualReport[]>([]);

  const load = () => {
    fetch("/api/posh").then((r) => r.json()).then((d) => {
      setRestricted(!!d.restricted);
      setCommittee(d.committee ?? []); setComposition(d.committeeComposition ?? null); setComplaints(d.complaints ?? []); setAnnualReports(d.annualReports ?? []);
    });
  };
  useEffect(load, []);

  const logComplaint = async () => {
    const ref = window.prompt("Brief case reference (kept confidential — do not enter complaint detail here):");
    if (!ref?.trim()) return;
    await fetch("/api/posh", { method: "POST" });
    load();
  };

  if (restricted === null) return null;
  if (restricted) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">POSH Compliance</h1>
        <Card className="rounded-xl border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">This module is classified Confidential</p>
          <p className="text-xs text-red-600/80 mt-1">Your account does not have clearance to view POSH records.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">POSH Compliance</h1>
        <p className="text-sm text-ct-muted mt-1">Prevention of Sexual Harassment Act, 2013 — classified Confidential</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="rounded-xl shadow-card bg-white p-4">
          <h3 className="text-sm font-semibold mb-3">Internal Committee (IC)</h3>
          <ul className="text-xs space-y-1">{committee.map((c) => <li key={c.id} className="flex justify-between"><span>{c.memberName}</span><span className="text-ct-muted">{c.role}</span></li>)}</ul>
          {composition && (
            <div className="mt-3 pt-3 border-t border-ct-border">
              {composition.isValid ? (
                <p className="text-xs text-emerald-600">✓ Meets POSH Act Sec 4(2) composition (Presiding Officer + {composition.memberCount} Members + {composition.externalMemberCount} External Member)</p>
              ) : (
                <div className="text-xs text-red-600 space-y-0.5">
                  <p className="font-medium">Committee composition gaps:</p>
                  {composition.issues.map((issue, idx) => <p key={idx}>• {issue}</p>)}
                </div>
              )}
            </div>
          )}
        </Card>
        <Card className="rounded-xl shadow-card bg-white p-4">
          <h3 className="text-sm font-semibold mb-3">Annual Report (Section 21)</h3>
          {annualReports.map((a) => <p key={a.id} className="text-xs">FY {a.year} — <StatusPill value={a.status} /> {a.filedWith && `(${a.filedWith})`}</p>)}
        </Card>
      </div>
      <Card className="rounded-xl shadow-card bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Complaints Register</h3>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={logComplaint}>+ Log complaint</Button>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="pb-2 font-medium">Case ID</th><th className="pb-2 font-medium">Received</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">90-Day Inquiry Deadline</th></tr></thead>
          <tbody className="divide-y divide-ct-border">{complaints.map((c) => (
            <tr key={c.id}>
              <td className="py-2">{c.caseRef}</td><td className="py-2">{new Date(c.receivedDate).toLocaleDateString("en-IN")}</td><td className="py-2"><StatusPill value={c.status} /></td>
              <td className={`py-2 ${SLA_COLORS[c.inquirySla.urgency]}`}>{c.inquirySla.dueDate} {c.inquirySla.isOverdue ? `(overdue by ${Math.abs(c.inquirySla.daysRemaining!)}d)` : `(${c.inquirySla.daysRemaining}d left)`}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}
