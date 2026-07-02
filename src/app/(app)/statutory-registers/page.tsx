"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";

// Read-only index over registers that already exist as their own modules
// (Directors & KMP, Charges, Cap Table = Register of Members, RPT = Register
// of RPT Contracts, Board minutes = Minutes Book) -- the Companies Act
// requires a Company Secretary to maintain roughly this set of registers,
// but each one already has its own real CRUD module; this page is a single
// place to see all of them at a glance, not a second copy of the data.
type Director = { id: string; name: string; designation: string | null };
type Charge = { id: string; chargeHolder: string; amount: string | null; status: string };
type CapEntry = { id: string; holderName: string; shares: number };
type Meeting = { id: string; title: string; meetingDate: string };

export default function StatutoryRegistersPage() {
  const [directors, setDirectors] = useState<Director[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [members, setMembers] = useState<CapEntry[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [rptRestricted, setRptRestricted] = useState(false);

  useEffect(() => {
    fetch("/api/directors").then((r) => r.json()).then((d) => setDirectors(d.directors ?? []));
    fetch("/api/charges").then((r) => r.json()).then((d) => setCharges(d.charges ?? []));
    fetch("/api/cap-table").then((r) => r.json()).then((d) => setMembers(d.entries ?? []));
    fetch("/api/board").then((r) => r.json()).then((d) => setMeetings(d.meetings ?? []));
    fetch("/api/rpt").then((r) => r.json()).then((d) => setRptRestricted(!!d.restricted));
  }, []);

  const registers = [
    { name: "Register of Members", rows: members.map((m) => `${m.holderName} — ${m.shares.toLocaleString("en-IN")} shares`), href: "/cap-table" },
    { name: "Register of Directors & KMP", rows: directors.map((d) => `${d.name}${d.designation ? ` — ${d.designation}` : ""}`), href: "/directors" },
    { name: "Register of Charges", rows: charges.map((c) => `${c.chargeHolder}${c.amount ? ` — ₹${c.amount}` : ""} (${c.status})`), href: "/charges" },
    { name: "Register of RPT Contracts", rows: rptRestricted ? ["Restricted — Board-only classification"] : ["See RPT module for full list"], href: "/rpt" },
    { name: "Minutes Book Index", rows: meetings.map((m) => `${m.title} — ${new Date(m.meetingDate).toLocaleDateString("en-IN")}`), href: "/board" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Statutory Registers</h1>
        <p className="text-sm text-ct-muted mt-1">Every register the Companies Act requires a Company Secretary to maintain — each with its own live module</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {registers.map((r) => (
          <Card key={r.name} className="rounded-xl shadow-card bg-white p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-ct-navy">{r.name}</h3>
              <a href={r.href} className="text-[11px] text-ct-teal underline">Open module →</a>
            </div>
            {r.rows.length === 0 ? (
              <p className="text-xs text-ct-muted">No entries yet.</p>
            ) : (
              <ul className="text-xs text-ct-slate space-y-1">
                {r.rows.slice(0, 5).map((row, i) => <li key={i} className="border-b border-ct-border last:border-0 pb-1">{row}</li>)}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
