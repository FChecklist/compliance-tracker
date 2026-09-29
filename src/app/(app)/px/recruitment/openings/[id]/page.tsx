"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge -- port of PROJEXA's JobOpeningObjectClient.tsx.
// No generic Edit (no updateJobOpening() exists, only the real
// status-change already on the list, kept here too) and no Delete (no
// delete function exists) -- matching the source's own comment on why.
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type JobOpening = { id: string; title: string; departmentId: string | null; jobDescription: string | null; employmentType: string; numPositions: number; status: string };
type Department = { id: string; name: string };

const STATUS_BADGE: Record<string, string> = {
  open: "bg-green-100 text-green-700",
  on_hold: "bg-ct-saffron/20 text-ct-saffron-text",
  closed: "bg-ct-cloud text-ct-muted",
  filled: "bg-ct-cloud text-ct-muted",
};

export default function JobOpeningDetailPage() {
  const params = useParams<{ id: string }>();
  const openingId = params.id;

  const [opening, setOpening] = useState<JobOpening | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, deptRes] = await Promise.all([
        fetch(`/api/v1/projexa/recruitment/job-openings/${openingId}`),
        fetch("/api/v1/projexa/hr/departments").catch(() => null),
      ]);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load this job opening");
      setOpening(data);
      if (deptRes?.ok) setDepartments((await deptRes.json())?.departments ?? []);
      setLoadError(null);
    } catch (err) {
      setOpening(null);
      setLoadError(err instanceof Error && err.message ? err.message : "Couldn't load this job opening");
    } finally {
      setLoading(false);
    }
  }, [openingId]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(status: string) {
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/v1/projexa/recruitment/job-openings/${openingId}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update status");
      toast.success("Job opening status updated");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update status");
    } finally {
      setStatusBusy(false);
    }
  }

  const departmentName = departments.find((d) => d.id === opening?.departmentId)?.name ?? "—";

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-4">
      <Link href="/px/recruitment?tab=openings" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ArrowLeft className="size-3.5" /> Back to Recruitment
      </Link>

      {loadError || !opening ? (
        <p role="alert" className="text-sm text-ct-error">{loadError ?? "Job opening not found."}</p>
      ) : (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-heading text-ct-navy">{opening.title}</h1>
                <Badge className={`text-xs border-0 ${STATUS_BADGE[opening.status] ?? "bg-ct-cloud text-ct-muted"}`}>{opening.status.replace(/_/g, " ")}</Badge>
              </div>
            </div>
            <Select value="" onValueChange={changeStatus}>
              <SelectTrigger className="h-9 w-40" disabled={statusBusy}><SelectValue placeholder="Change status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="filled">Filled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-4"><p className="text-xs text-ct-muted">Department</p><p className="text-xl font-heading text-ct-navy">{departmentName}</p></CardContent></Card>
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-4"><p className="text-xs text-ct-muted">Employment Type</p><p className="text-xl font-heading text-ct-navy capitalize">{opening.employmentType.replace(/_/g, " ")}</p></CardContent></Card>
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-4"><p className="text-xs text-ct-muted">Positions</p><p className="text-xl font-heading text-ct-navy">{opening.numPositions}</p></CardContent></Card>
          </div>

          {opening.jobDescription && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader><CardTitle className="text-base text-ct-navy">Job Description</CardTitle></CardHeader>
              <CardContent><p className="whitespace-pre-wrap text-sm text-ct-navy">{opening.jobDescription}</p></CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
