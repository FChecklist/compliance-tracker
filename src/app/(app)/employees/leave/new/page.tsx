"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own LeaveRequestCreateClient.tsx (src/app/(app)/employees/leave/
// new/page.tsx there). POSTs to the already-native POST /api/v1/projexa/
// leave/requests -- hr-service.ts's requestLeave(), which attributes the
// request to the caller's own signed-in session (ctx.dbUser), so this always
// submits leave FOR the person filling in the form, matching PROJEXA's own
// reference page 1:1 (it never offered an "on behalf of" employee picker
// either -- requestLeave() has no such parameter).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LeaveRequestNewPage() {
  const router = useRouter();
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const missing = !leaveType.trim() || !startDate || !endDate;

  async function createLeaveRequest() {
    if (missing) { toast.error("Leave type, start date, and end date are required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/leave/requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveType: leaveType.trim(), startDate, endDate, reason: reason.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't submit leave request");
      toast.success("Leave request submitted");
      router.push("/employees?tab=leave");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit leave request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Request Leave</h1>
        <p className="text-sm text-ct-muted mt-1">Employees / Request Leave</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white max-w-2xl">
        <CardHeader><CardTitle className="text-base text-ct-navy">Leave request</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Leave Type</Label>
            <Input value={leaveType} onChange={(e) => setLeaveType(e.target.value)} placeholder="e.g. Casual, Sick, Earned" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Start Date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">End Date</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => router.push("/employees?tab=leave")}>Cancel</Button>
            <Button
              onClick={() => void createLeaveRequest()}
              disabled={submitting || missing}
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
            >
              {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Submit Request
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
