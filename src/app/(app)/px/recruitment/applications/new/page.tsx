"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge -- port of PROJEXA's ApplicationCreateClient.tsx,
// including its R80 GAP-8 sole-option seeding (src/lib/reference-lookups.ts
// port): when a list has exactly one row, this opens answered instead of
// empty, judged independently per list.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { soleOptionId } from "@/lib/reference-lookups";

type JobOpening = { id: string; title: string };
type Candidate = { id: string; name: string };

export default function NewApplicationPage() {
  const router = useRouter();
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [jobOpeningId, setJobOpeningId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/recruitment/job-openings")
      .then((r) => r.json())
      .then((d) => {
        const rows: JobOpening[] = d.jobOpenings ?? [];
        setOpenings(rows);
        const sole = soleOptionId(rows);
        if (sole) setJobOpeningId((prev) => prev || sole);
      })
      .catch(() => {});
    fetch("/api/v1/projexa/recruitment/candidates")
      .then((r) => r.json())
      .then((d) => {
        const rows: Candidate[] = d.candidates ?? [];
        setCandidates(rows);
        const sole = soleOptionId(rows);
        if (sole) setCandidateId((prev) => prev || sole);
      })
      .catch(() => {});
  }, []);

  async function create() {
    if (!jobOpeningId || !candidateId) { toast.error("Job opening and candidate are required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/recruitment/applications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobOpeningId, candidateId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create application");
      toast.success("Application created");
      router.push(`/px/recruitment/applications/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create application");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Link href="/px/recruitment?tab=pipeline" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ArrowLeft className="size-3.5" /> Back to Recruitment
      </Link>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">New Application</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Job Opening</Label>
            <Select value={jobOpeningId} onValueChange={setJobOpeningId}>
              <SelectTrigger><SelectValue placeholder="Select job opening" /></SelectTrigger>
              <SelectContent>{openings.map((o) => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Candidate</Label>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger><SelectValue placeholder="Select candidate" /></SelectTrigger>
              <SelectContent>{candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => router.push("/px/recruitment?tab=pipeline")}>Cancel</Button>
            <Button
              onClick={create}
              disabled={submitting || !jobOpeningId || !candidateId}
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
            >
              {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Create
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
