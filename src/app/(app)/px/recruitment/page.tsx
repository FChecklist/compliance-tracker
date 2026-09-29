"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge (2026-09-29): port of PROJEXA's Recruitment module
// (src/app/(app)/recruitment/page.tsx + RecruitmentClient.tsx there) into
// compliance-tracker as a native page calling the same-origin
// /api/v1/projexa/recruitment/** routes directly (real signed-in session,
// no HTTP hop, no X-Acting-User bridge -- requireActingPerson() resolves
// the acting person straight from ctx.dbUser for a real session).
//
// Lives at px/recruitment, NOT recruitment: compliance-tracker already has
// its OWN native /recruitment page (Wave 62) on the exact same backend
// (src/lib/services/recruitment-service.ts, same jobOpenings/candidates/
// jobApplications/interviewFeedback tables) -- verified directly, this is
// a real duplicate feature under one name, not two different concepts that
// happen to collide. That native page is a flatter UI (no job-opening/
// application detail pages, no interview scheduling/feedback, no
// hire-linking); this port is PROJEXA's richer UI over the identical data.
// Consolidating the two (retiring/redirecting the native page) is a real
// product decision with sidebar/nav implications, deliberately left for a
// later pass -- see ai-os/boss/ACTIVE-CLAIMS.yaml. src/proxy.ts's
// host-branching rewrite (projexa-ai.com/recruitment -> /px/recruitment)
// is a separate, already-in-flight PR and is not touched here.
//
// Single-file "use client" page (no separate *Client.tsx split), matching
// this repo's own convention (construction-dashboard/page.tsx, permits/
// page.tsx) rather than PROJEXA's page.tsx+Client.tsx split. UI rebuilt in
// compliance-tracker's own component vocabulary (@/components/ui/*,
// DataTable, ct-navy/ct-muted/ct-saffron classes) -- PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen is not used anywhere in this
// port.
import { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Loader2, Plus } from "lucide-react";

type JobOpening = { id: string; title: string; departmentId: string | null; jobDescription: string | null; employmentType: string; numPositions: number; status: string };
type Candidate = { id: string; name: string; email: string; phone: string | null; source: string | null };
type Application = { id: string; jobOpeningId: string; candidateId: string; stage: string };
type Department = { id: string; name: string };

const STAGE_ORDER = ["applied", "screening", "interview", "offer", "hired", "rejected"];
const STAGE_LABEL: Record<string, string> = {
  applied: "Applied", screening: "Screening", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Rejected",
};
const JOB_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "default", on_hold: "secondary", closed: "outline", filled: "outline",
};
const VALID_TABS = new Set(["openings", "candidates", "pipeline"]);

function PxRecruitmentPageInner() {
  const router = useRouter();
  // useSearchParams-in-Suspense convention (mood-boards/page.tsx, chat/
  // page.tsx, reports/page.tsx's CustomReportsSection).
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") ?? undefined;
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "openings");
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jobStatusFilter, setJobStatusFilter] = useState("all");
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [openRes, candRes, appRes, deptRes] = await Promise.all([
        fetch("/api/v1/projexa/recruitment/job-openings"),
        fetch("/api/v1/projexa/recruitment/candidates"),
        fetch("/api/v1/projexa/recruitment/applications"),
        fetch("/api/v1/projexa/hr/departments"),
      ]);
      for (const res of [openRes, candRes, appRes, deptRes]) {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Couldn't load recruitment data");
      }
      const [openData, candData, appData, deptData] = await Promise.all([
        openRes.json(), candRes.json(), appRes.json(), deptRes.json(),
      ]);
      setOpenings(openData.jobOpenings ?? []);
      setCandidates(candData.candidates ?? []);
      setApplications(appData.applications ?? []);
      setDepartments(deptData.departments ?? []);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "Couldn't load recruitment data";
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function updateOpeningStatus(id: string, status: string) {
    setStatusBusyId(id);
    try {
      const res = await fetch(`/api/v1/projexa/recruitment/job-openings/${id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Job opening status updated");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't update status");
    } finally {
      setStatusBusyId(null);
    }
  }

  const candidateName = (id: string) => candidates.find((c) => c.id === id)?.name ?? "—";
  const jobTitle = (id: string) => openings.find((o) => o.id === id)?.title ?? "—";
  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";

  const filteredOpenings = useMemo(
    () => (jobStatusFilter === "all" ? openings : openings.filter((o) => o.status === jobStatusFilter)),
    [openings, jobStatusFilter]
  );

  const openingColumns: ColumnDef<JobOpening>[] = [
    { accessorKey: "title", header: "Title", cell: ({ row }) => <span className="font-medium text-ct-navy">{row.original.title}</span> },
    { id: "department", header: "Department", cell: ({ row }) => departmentName(row.original.departmentId) },
    { id: "type", header: "Employment Type", cell: ({ row }) => row.original.employmentType.replace(/_/g, " ") },
    { id: "positions", header: "Positions", cell: ({ row }) => row.original.numPositions },
    { id: "status", header: "Status", cell: ({ row }) => <Badge variant={JOB_STATUS_VARIANT[row.original.status] ?? "outline"}>{row.original.status.replace(/_/g, " ")}</Badge> },
    {
      id: "actions", header: "", cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Select value="" onValueChange={(v) => updateOpeningStatus(row.original.id, v)}>
            <SelectTrigger className="h-8 w-32" disabled={statusBusyId === row.original.id} onClick={(e) => e.stopPropagation()}><SelectValue placeholder="Change status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="on_hold">On Hold</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="filled">Filled</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); router.push(`/px/recruitment/openings/${row.original.id}`); }}>View</Button>
        </div>
      ),
    },
  ];

  const candidateColumns: ColumnDef<Candidate>[] = [
    { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="font-medium text-ct-navy">{row.original.name}</span> },
    { accessorKey: "email", header: "Email", cell: ({ row }) => <span className="text-ct-muted">{row.original.email}</span> },
    { id: "phone", header: "Phone", cell: ({ row }) => row.original.phone ?? "—" },
    { id: "source", header: "Source", cell: ({ row }) => row.original.source ?? "—" },
  ];

  function goToTab(tab: string) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
  }

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-ct-muted" /></div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Recruitment</h1>
        <p className="text-sm text-ct-muted mt-1">Job openings, candidates, and the hiring pipeline.</p>
      </div>

      <Tabs value={activeTab} onValueChange={goToTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="openings">Job Openings</TabsTrigger>
          <TabsTrigger value="candidates">Candidates</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="openings" className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="w-44">
              <Select value={jobStatusFilter} onValueChange={setJobStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="on_hold">On Hold</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="filled">Filled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={() => router.push("/px/recruitment/openings/new")}>
              <Plus className="size-4" /> New Job Opening
            </Button>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-4">
              {loadError ? (
                <p role="alert" className="text-sm text-ct-error">{loadError}</p>
              ) : filteredOpenings.length === 0 ? (
                <p className="py-10 text-center text-sm text-ct-muted">No job openings yet.</p>
              ) : (
                <DataTable columns={openingColumns} data={filteredOpenings} searchKey="title" searchPlaceholder="Search job openings…" />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="candidates" className="space-y-4">
          <div className="flex justify-end">
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={() => router.push("/px/recruitment/candidates/new")}>
              <Plus className="size-4" /> Add Candidate
            </Button>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-4">
              {candidates.length === 0 ? (
                <p className="py-10 text-center text-sm text-ct-muted">No candidates yet.</p>
              ) : (
                <DataTable columns={candidateColumns} data={candidates} searchKey="name" searchPlaceholder="Search candidates…" />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pipeline" className="space-y-4">
          <div className="flex justify-end">
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={() => router.push("/px/recruitment/applications/new")}>
              <Plus className="size-4" /> New Application
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {STAGE_ORDER.map((stage) => (
              <div key={stage} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ct-muted">{STAGE_LABEL[stage]}</h4>
                  <Badge variant="outline" className="text-[10px]">{applications.filter((a) => a.stage === stage).length}</Badge>
                </div>
                <div className="space-y-2">
                  {applications.filter((a) => a.stage === stage).map((a) => (
                    <Card
                      key={a.id}
                      className="rounded-xl shadow-card bg-white cursor-pointer hover:shadow-md"
                      onClick={() => router.push(`/px/recruitment/applications/${a.id}`)}
                    >
                      <CardContent className="p-3">
                        <p className="text-sm font-medium text-ct-navy">{candidateName(a.candidateId)}</p>
                        <p className="text-xs text-ct-muted">{jobTitle(a.jobOpeningId)}</p>
                      </CardContent>
                    </Card>
                  ))}
                  {applications.filter((a) => a.stage === stage).length === 0 && <p className="px-1 text-xs text-ct-muted">—</p>}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function PxRecruitmentPage() {
  return (
    <Suspense fallback={<div className="text-sm text-ct-muted">Loading...</div>}>
      <PxRecruitmentPageInner />
    </Suspense>
  );
}
