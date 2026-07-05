"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 62 (Recruitment/ATS, ERP benchmark Tier 3 #14). 3 tabs: Job Openings,
// Candidates, Applications (the pipeline view -- stage-move buttons only
// offer the next valid transition, matching moveApplicationStage's own
// VALID_STAGE_TRANSITIONS map).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Briefcase, Plus, Loader2, Users, ArrowRight, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type JobOpening = { id: string; title: string; status: string; numPositions: number; employmentType: string; createdAt: string };
type Candidate = { id: string; name: string; email: string; phone: string | null; source: string | null };
type Application = { id: string; jobOpeningId: string; candidateId: string; stage: string; offerAmount: string | null; rejectedReason: string | null };

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied", screening: "Screening", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Rejected",
};
const NEXT_STAGE: Record<string, string | null> = {
  applied: "screening", screening: "interview", interview: "offer", offer: "hired", hired: null, rejected: null,
};

export default function RecruitmentPage() {
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  const [openingDialogOpen, setOpeningDialogOpen] = useState(false);
  const [openingTitle, setOpeningTitle] = useState("");
  const [openingPositions, setOpeningPositions] = useState("1");
  const [creatingOpening, setCreatingOpening] = useState(false);

  const [candidateDialogOpen, setCandidateDialogOpen] = useState(false);
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [creatingCandidate, setCreatingCandidate] = useState(false);

  const [appDialogOpen, setAppDialogOpen] = useState(false);
  const [appOpeningId, setAppOpeningId] = useState("");
  const [appCandidateId, setAppCandidateId] = useState("");
  const [creatingApp, setCreatingApp] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [openingsRes, candidatesRes, appsRes] = await Promise.all([
      fetch("/api/recruitment/job-openings"), fetch("/api/recruitment/candidates"), fetch("/api/recruitment/applications"),
    ]);
    const openingsData = await openingsRes.json();
    const candidatesData = await candidatesRes.json();
    const appsData = await appsRes.json();
    setOpenings(openingsData.jobOpenings ?? []);
    setCandidates(candidatesData.candidates ?? []);
    setApplications(appsData.applications ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const createOpening = async () => {
    if (!openingTitle.trim()) return;
    setCreatingOpening(true);
    try {
      const res = await fetch("/api/recruitment/job-openings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: openingTitle, numPositions: Number(openingPositions) || 1 }),
      });
      if (!res.ok) throw new Error();
      toast.success("Job opening created");
      setOpeningDialogOpen(false); setOpeningTitle(""); setOpeningPositions("1");
      load();
    } catch { toast.error("Failed to create job opening"); } finally { setCreatingOpening(false); }
  };

  const createCandidate = async () => {
    if (!candidateName.trim() || !candidateEmail.trim()) return;
    setCreatingCandidate(true);
    try {
      const res = await fetch("/api/recruitment/candidates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: candidateName, email: candidateEmail }),
      });
      if (!res.ok) throw new Error();
      toast.success("Candidate added");
      setCandidateDialogOpen(false); setCandidateName(""); setCandidateEmail("");
      load();
    } catch { toast.error("Failed to add candidate"); } finally { setCreatingCandidate(false); }
  };

  const createApplication = async () => {
    if (!appOpeningId || !appCandidateId) return;
    setCreatingApp(true);
    try {
      const res = await fetch("/api/recruitment/applications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobOpeningId: appOpeningId, candidateId: appCandidateId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Application created");
      setAppDialogOpen(false); setAppOpeningId(""); setAppCandidateId("");
      load();
    } catch { toast.error("Failed to create application"); } finally { setCreatingApp(false); }
  };

  const moveStage = async (applicationId: string, stage: string) => {
    try {
      const res = await fetch(`/api/recruitment/applications/${applicationId}/stage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Moved to ${STAGE_LABELS[stage]}`);
      load();
    } catch { toast.error("Failed to move stage"); }
  };

  const openingName = (id: string) => openings.find((o) => o.id === id)?.title ?? id;
  const candidateName2 = (id: string) => candidates.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Recruitment</h1>
        <p className="text-sm text-ct-muted mt-1">Job openings, candidates, and the hiring pipeline.</p>
      </div>

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : (
        <Tabs defaultValue="openings">
          <TabsList>
            <TabsTrigger value="openings">Job Openings</TabsTrigger>
            <TabsTrigger value="candidates">Candidates</TabsTrigger>
            <TabsTrigger value="applications">Applications</TabsTrigger>
          </TabsList>

          <TabsContent value="openings" className="space-y-3">
            <div className="flex justify-end">
              <Dialog open={openingDialogOpen} onOpenChange={setOpeningDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"><Plus className="size-4 mr-2" />New Opening</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Job Opening</DialogTitle><DialogDescription>Create a requisition for a role.</DialogDescription></DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label><Input value={openingTitle} onChange={(e) => setOpeningTitle(e.target.value)} placeholder="Senior Accountant" /></div>
                    <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Number of positions</Label><Input type="number" value={openingPositions} onChange={(e) => setOpeningPositions(e.target.value)} /></div>
                  </div>
                  <DialogFooter><Button onClick={createOpening} disabled={creatingOpening || !openingTitle.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">{creatingOpening ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}Create</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {openings.length === 0 ? (
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><Briefcase className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No job openings yet.</p></CardContent></Card>
            ) : (
              <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
                {openings.map((o) => (
                  <div key={o.id} className="px-4 py-3 flex items-center gap-3">
                    <Briefcase className="size-4 text-ct-teal shrink-0" />
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium text-ct-navy">{o.title}</p><p className="text-xs text-ct-muted">{o.numPositions} position(s) -- {o.employmentType}</p></div>
                    <Badge variant={o.status === "open" ? "default" : "secondary"} className="text-xs">{o.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="candidates" className="space-y-3">
            <div className="flex justify-end">
              <Dialog open={candidateDialogOpen} onOpenChange={setCandidateDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"><Plus className="size-4 mr-2" />New Candidate</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Candidate</DialogTitle><DialogDescription>Resumes can be attached via the central Documents repository, linked to this candidate.</DialogDescription></DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label><Input value={candidateName} onChange={(e) => setCandidateName(e.target.value)} /></div>
                    <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Email</Label><Input type="email" value={candidateEmail} onChange={(e) => setCandidateEmail(e.target.value)} /></div>
                  </div>
                  <DialogFooter><Button onClick={createCandidate} disabled={creatingCandidate || !candidateName.trim() || !candidateEmail.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">{creatingCandidate ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}Add</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {candidates.length === 0 ? (
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><Users className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No candidates yet.</p></CardContent></Card>
            ) : (
              <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
                {candidates.map((c) => (
                  <div key={c.id} className="px-4 py-3 flex items-center gap-3">
                    <Users className="size-4 text-ct-teal shrink-0" />
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium text-ct-navy">{c.name}</p><p className="text-xs text-ct-muted">{c.email}{c.source ? ` -- ${c.source}` : ""}</p></div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="applications" className="space-y-3">
            <div className="flex justify-end">
              <Dialog open={appDialogOpen} onOpenChange={setAppDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"><Plus className="size-4 mr-2" />New Application</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Application</DialogTitle><DialogDescription>Link a candidate to a job opening.</DialogDescription></DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-ct-muted uppercase">Job Opening</Label>
                      <Select value={appOpeningId} onValueChange={setAppOpeningId}>
                        <SelectTrigger><SelectValue placeholder="Select opening" /></SelectTrigger>
                        <SelectContent>{openings.map((o) => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-ct-muted uppercase">Candidate</Label>
                      <Select value={appCandidateId} onValueChange={setAppCandidateId}>
                        <SelectTrigger><SelectValue placeholder="Select candidate" /></SelectTrigger>
                        <SelectContent>{candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter><Button onClick={createApplication} disabled={creatingApp || !appOpeningId || !appCandidateId} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">{creatingApp ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}Create</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {applications.length === 0 ? (
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><ArrowRight className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No applications yet.</p></CardContent></Card>
            ) : (
              <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
                {applications.map((a) => {
                  const next = NEXT_STAGE[a.stage];
                  return (
                    <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ct-navy">{candidateName2(a.candidateId)} &rarr; {openingName(a.jobOpeningId)}</p>
                        <p className="text-xs text-ct-muted">{a.offerAmount ? `Offer: ${a.offerAmount}` : ""}{a.rejectedReason ? `Rejected: ${a.rejectedReason}` : ""}</p>
                      </div>
                      <Badge variant={a.stage === "hired" ? "default" : a.stage === "rejected" ? "secondary" : "outline"} className="text-xs">{STAGE_LABELS[a.stage]}</Badge>
                      {next && (
                        <Button size="sm" variant="ghost" onClick={() => moveStage(a.id, next)}>
                          <ArrowRight className="size-3.5 mr-1 text-ct-teal" />{STAGE_LABELS[next]}
                        </Button>
                      )}
                      {a.stage !== "hired" && a.stage !== "rejected" && (
                        <Button size="sm" variant="ghost" onClick={() => moveStage(a.id, "rejected")}>
                          <XCircle className="size-3.5 text-ct-error" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
