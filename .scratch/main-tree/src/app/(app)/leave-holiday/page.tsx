"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/SimpleModulePage";

type LeaveType = { id: string; leaveType: string; governingLaw: string | null; entitlement: string | null };
type HolidayList = { id: string; state: string; year: string; status: string };

export default function LeaveHolidayPage() {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [holidayLists, setHolidayLists] = useState<HolidayList[]>([]);

  useEffect(() => {
    fetch("/api/leave-holiday").then((r) => r.json()).then((d) => { setLeaveTypes(d.leaveTypes ?? []); setHolidayLists(d.holidayLists ?? []); });
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Leave & Holiday Compliance</h1>
        <p className="text-sm text-ct-muted mt-1">Statutory leave entitlements and state-wise holiday-list filings — compliance tracking, not payroll execution</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="rounded-xl shadow-card bg-white p-4">
          <h3 className="text-sm font-semibold mb-3">Statutory Leave Entitlements</h3>
          {leaveTypes.length === 0 ? <p className="text-xs text-ct-muted">No entries.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="pb-2 font-medium">Leave Type</th><th className="pb-2 font-medium">Law</th><th className="pb-2 font-medium">Entitlement</th></tr></thead>
              <tbody className="divide-y divide-ct-border">{leaveTypes.map((l) => <tr key={l.id}><td className="py-2">{l.leaveType}</td><td className="py-2 text-ct-muted">{l.governingLaw ?? "—"}</td><td className="py-2">{l.entitlement ?? "—"}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
        <Card className="rounded-xl shadow-card bg-white p-4">
          <h3 className="text-sm font-semibold mb-3">State-wise Holiday List Filing</h3>
          {holidayLists.length === 0 ? <p className="text-xs text-ct-muted">No filings tracked.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="pb-2 font-medium">State</th><th className="pb-2 font-medium">Year</th><th className="pb-2 font-medium">Status</th></tr></thead>
              <tbody className="divide-y divide-ct-border">{holidayLists.map((h) => <tr key={h.id}><td className="py-2">{h.state}</td><td className="py-2">{h.year}</td><td className="py-2"><StatusPill value={h.status} /></td></tr>)}</tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
