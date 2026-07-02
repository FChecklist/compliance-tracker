"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/SimpleModulePage";

type Entry = { id: string; holderName: string; shares: number; percent: string | null; shareClass: string };
type Event = { id: string; eventType: string; description: string | null; shares: number | null; eventDate: string | null; status: string };

export default function CapTablePage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [holderName, setHolderName] = useState("");
  const [shares, setShares] = useState("");
  const [eventType, setEventType] = useState("");
  const [eventShares, setEventShares] = useState("");

  const load = () => {
    Promise.all([fetch("/api/cap-table").then((r) => r.json()), fetch("/api/cap-table/events").then((r) => r.json())])
      .then(([e, ev]) => { setEntries(e.entries ?? []); setEvents(ev.events ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(load, []);

  const addEntry = async () => {
    if (!holderName.trim() || !shares) return;
    await fetch("/api/cap-table", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ holderName, shares }) });
    setHolderName(""); setShares(""); setShowEntryForm(false);
    load();
  };

  const addEvent = async () => {
    if (!eventType.trim()) return;
    await fetch("/api/cap-table/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventType, shares: eventShares }) });
    setEventType(""); setEventShares(""); setShowEventForm(false);
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Share Capital & Cap Table</h1>
        <p className="text-sm text-ct-muted mt-1">Shareholder register and capital events (allotments, transfers, ESOP grants)</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Shareholders</h3>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowEntryForm((v) => !v)}>{showEntryForm ? "Cancel" : "+ Add Holder"}</Button>
        </div>
        {showEntryForm && (
          <div className="flex gap-2 mb-3">
            <Input placeholder="Holder name" value={holderName} onChange={(e) => setHolderName(e.target.value)} className="h-9" />
            <Input type="number" placeholder="Shares" value={shares} onChange={(e) => setShares(e.target.value)} className="h-9 w-32" />
            <Button size="sm" onClick={addEntry} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Save</Button>
          </div>
        )}
        {loading ? <p className="text-xs text-ct-muted">Loading…</p> : entries.length === 0 ? <p className="text-xs text-ct-muted">No shareholders recorded.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="pb-2 font-medium">Holder</th><th className="pb-2 font-medium">Shares</th><th className="pb-2 font-medium">%</th><th className="pb-2 font-medium">Class</th></tr></thead>
            <tbody className="divide-y divide-ct-border">
              {entries.map((e) => <tr key={e.id}><td className="py-2">{e.holderName}</td><td className="py-2">{e.shares.toLocaleString("en-IN")}</td><td className="py-2">{e.percent ?? "—"}</td><td className="py-2">{e.shareClass}</td></tr>)}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="rounded-xl shadow-card bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Capital Events</h3>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowEventForm((v) => !v)}>{showEventForm ? "Cancel" : "+ Add Event"}</Button>
        </div>
        {showEventForm && (
          <div className="flex gap-2 mb-3">
            <Input placeholder="e.g. ESOP Grant, Share Transfer" value={eventType} onChange={(e) => setEventType(e.target.value)} className="h-9" />
            <Input type="number" placeholder="Shares" value={eventShares} onChange={(e) => setEventShares(e.target.value)} className="h-9 w-32" />
            <Button size="sm" onClick={addEvent} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Save</Button>
          </div>
        )}
        {loading ? <p className="text-xs text-ct-muted">Loading…</p> : events.length === 0 ? <p className="text-xs text-ct-muted">No capital events recorded.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="pb-2 font-medium">Event</th><th className="pb-2 font-medium">Shares</th><th className="pb-2 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-ct-border">
              {events.map((e) => <tr key={e.id}><td className="py-2">{e.eventType}{e.description ? ` — ${e.description}` : ""}</td><td className="py-2">{e.shares?.toLocaleString("en-IN") ?? "—"}</td><td className="py-2"><StatusPill value={e.status} /></td></tr>)}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
