"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own LeaveBalanceCreateClient.tsx (src/app/(app)/employees/leave/
// balance/new/page.tsx there). POSTs to the already-native POST
// /api/v1/projexa/leave/balances -- hr-service.ts's setLeaveBalance(), an
// upsert keyed on (userId, leaveType, year) with no separate get/list-by-id
// and no delete, matching PROJEXA's own reference page's honest scope cut
// ("No Object Page... no delete exists either -- matches this module's own
// precedent").
//
// Employee is a required selection with no default -- deliberately NOT
// defaulted to the signed-in user, matching PROJEXA's own R80 GAP-8 comment:
// this is an administrator setting somebody else's entitlement, so "me"
// would be a guess about whose balance is being set.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Employee = { id: string; name: string | null; email: string };

export default function LeaveBalanceNewPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [userId, setUserId] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [totalDays, setTotalDays] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/employees").then((r) => r.json()).then((d) => setEmployees(d.employees ?? [])).catch(() => {});
  }, []);

  const missing = !userId || !leaveType.trim() || !totalDays;

  async function saveBalance() {
    if (missing) { toast.error("Employee, leave type, and total days are required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/leave/balances", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, leaveType: leaveType.trim(), year: Number(year), totalDays: Number(totalDays) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't save leave balance");
      toast.success("Leave balance saved");
      router.push("/employees?tab=leave");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save leave balance");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Set Leave Balance</h1>
        <p className="text-sm text-ct-muted mt-1">Employees / Set Leave Balance</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white max-w-2xl">
        <CardHeader><CardTitle className="text-base text-ct-navy">Leave balance</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Employee</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name ?? e.email}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Leave Type</Label><Input value={leaveType} onChange={(e) => setLeaveType(e.target.value)} placeholder="e.g. Casual" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Year</Label><Input type="number" value={year} onChange={(e) => setYear(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Total Days</Label>
            <Input type="number" value={totalDays} onChange={(e) => setTotalDays(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => router.push("/employees?tab=leave")}>Cancel</Button>
            <Button
              onClick={() => void saveBalance()}
              disabled={submitting || missing}
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
            >
              {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Save Balance
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
