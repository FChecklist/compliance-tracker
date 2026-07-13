"use client";

// Owner directive 2026-07-13: reports should be schedulable (daily/weekly/
// monthly, user/org-definable). Mirrors metric-alerts/page.tsx's own
// deliberately-simple single-dialog CRUD shape (no picker widgets beyond a
// plain checkbox list of org users, matching /api/users' existing GET
// shape) rather than a heavier scheduling UI.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { CalendarClock, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type OrgUser = { id: string; name: string; email: string };
type ReportSchedule = {
  id: string; reportId: string; cadence: string; dayOfWeek: number | null; dayOfMonth: number | null;
  recipientUserIds: string[]; isActive: boolean;
};

const WEEKDAYS = [
  { value: "0", label: "Sunday" }, { value: "1", label: "Monday" }, { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" }, { value: "4", label: "Thursday" }, { value: "5", label: "Friday" }, { value: "6", label: "Saturday" },
];

export function ReportScheduleDialog({
  reportId, reportName, open, onOpenChange,
}: { reportId: string; reportName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [saving, setSaving] = useState(false);

  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("daily");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [usersRes, schedulesRes] = await Promise.all([
      fetch("/api/users").then((r) => r.json()).catch(() => ({ users: [] })),
      fetch("/api/reports/schedules").then((r) => r.json()).catch(() => ({ schedules: [] })),
    ]);
    setOrgUsers(usersRes.users ?? []);
    setSchedules((schedulesRes.schedules ?? []).filter((s: ReportSchedule) => s.reportId === reportId));
  }, [reportId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const createSchedule = async () => {
    if (!selectedUserIds.length) {
      toast.error("Pick at least one recipient");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/reports/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId, cadence,
          dayOfWeek: cadence === "weekly" ? Number(dayOfWeek) : undefined,
          dayOfMonth: cadence === "monthly" ? Number(dayOfMonth) : undefined,
          recipientUserIds: selectedUserIds,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Schedule saved");
      setSelectedUserIds([]);
      load();
    } catch {
      toast.error("Failed to save schedule");
    } finally {
      setSaving(false);
    }
  };

  const removeSchedule = async (id: string) => {
    try {
      const res = await fetch(`/api/reports/schedules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Schedule removed");
      load();
    } catch {
      toast.error("Failed to remove schedule");
    }
  };

  const userLabel = (id: string) => orgUsers.find((u) => u.id === id)?.name ?? id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="size-4 text-ct-teal" />Schedule &quot;{reportName}&quot;</DialogTitle>
          <DialogDescription>Runs via the same cron/notification mechanism as Metric Alerts -- recipients get a notification when it's due.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {schedules.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Existing schedules</Label>
              <div className="rounded-lg border border-ct-border divide-y divide-ct-border">
                {schedules.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-2 text-xs">
                    <span>
                      {s.cadence}
                      {s.cadence === "weekly" && s.dayOfWeek != null ? ` (${WEEKDAYS[s.dayOfWeek].label})` : ""}
                      {s.cadence === "monthly" && s.dayOfMonth != null ? ` (day ${s.dayOfMonth})` : ""}
                      {" -- "}{s.recipientUserIds.map(userLabel).join(", ")}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => removeSchedule(s.id)}>
                      <Trash2 className="size-3.5 text-ct-error" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Cadence</Label>
            <Select value={cadence} onValueChange={(v) => setCadence(v as typeof cadence)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {cadence === "weekly" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Day of week</Label>
              <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {cadence === "monthly" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Day of month</Label>
              <Input type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Recipients</Label>
            <div className="rounded-lg border border-ct-border max-h-40 overflow-y-auto divide-y divide-ct-border">
              {orgUsers.length === 0 ? (
                <p className="p-2 text-xs text-ct-muted">No org users found.</p>
              ) : (
                orgUsers.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 p-2 text-xs cursor-pointer">
                    <Checkbox checked={selectedUserIds.includes(u.id)} onCheckedChange={() => toggleUser(u.id)} />
                    {u.name} <span className="text-ct-muted">({u.email})</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={createSchedule} disabled={saving} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
            {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
            Add schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
