"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge -- port of PROJEXA's JobOpeningCreateClient.tsx
// (its ObjectScreen create form) into a plain Card, matching this repo's
// own create-screen convention (see change-orders/page.tsx's Dialog form
// for the same fields-plus-Save pattern, rebuilt here as a full page since
// PROJEXA gave this its own route rather than a Dialog).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Department = { id: string; name: string };

export default function NewJobOpeningPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [description, setDescription] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [numPositions, setNumPositions] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/hr/departments")
      .then((r) => r.json())
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => {});
  }, []);

  async function create() {
    if (!title.trim()) { toast.error("Title is required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/recruitment/job-openings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, departmentId: departmentId || undefined, jobDescription: description || undefined,
          employmentType, numPositions: Number(numPositions) || 1,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create job opening");
      toast.success("Job opening created");
      router.push(`/px/recruitment/openings/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create job opening");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Link href="/px/recruitment?tab=openings" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ArrowLeft className="size-3.5" /> Back to Recruitment
      </Link>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">New Job Opening</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Site Engineer" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Department (optional)</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Employment Type</Label>
              <Select value={employmentType} onValueChange={setEmploymentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full Time</SelectItem>
                  <SelectItem value="part_time">Part Time</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                  <SelectItem value="intern">Intern</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Number of Positions</Label>
            <Input type="number" value={numPositions} onChange={(e) => setNumPositions(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Job Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => router.push("/px/recruitment?tab=openings")}>Cancel</Button>
            <Button
              onClick={create}
              disabled={submitting || !title.trim()}
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
