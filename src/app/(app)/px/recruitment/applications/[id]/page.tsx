"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge -- port of PROJEXA's ApplicationObjectClient.tsx:
// stage transitions (VALID_TRANSITIONS mirrors moveApplicationStage's own
// server-side guard), interview scheduling + feedback, and the explicit
// hired -> employee-profile link (never auto-provisioned, matching
// linkHiredEmployee's own "no silent auto-provisioning" comment).
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, UserCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Application = {
  id: string; jobOpeningId: string; candidateId: string; stage: string; rejectedReason: string | null;
  offerAmount: string | null; hiredEmployeeProfileId: string | null;
};
type JobOpening = { id: string; title: string };
type Candidate = { id: string; name: string };
type InterviewFeedback = { id: string; interviewerId: string; roundName: string; scheduledAt: string; rating: number | null; recommendation: string | null; completedAt: string | null };
type Employee = { id: string; name: string; profile: { id: string; employeeCode: string | null } | null };

const STAGE_LABEL: Record<string, string> = { applied: "Applied", screening: "Screening", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Rejected" };
const VALID_TRANSITIONS: Record<string, string[]> = {
  applied: ["screening", "rejected"], screening: ["interview", "rejected"], interview: ["offer", "rejected"], offer: ["hired", "rejected"], hired: [], rejected: [],
};
const STAGE_BADGE: Record<string, string> = {
  applied: "bg-ct-cloud text-ct-muted", screening: "bg-ct-saffron/20 text-ct-saffron-text", interview: "bg-ct-saffron/20 text-ct-saffron-text",
  offer: "bg-ct-saffron/20 text-ct-saffron-text", hired: "bg-green-100 text-green-700", rejected: "bg-red-100 text-red-700",
};

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const applicationId = params.id;

  const [application, setApplication] = useState<Application | null>(null);
  const [jobOpening, setJobOpening] = useState<JobOpening | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [interviews, setInterviews] = useState<InterviewFeedback[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [stageBusy, setStageBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [offerAmount, setOfferAmount] = useState("");

  const [ivInterviewerId, setIvInterviewerId] = useState("");
  const [ivRoundName, setIvRoundName] = useState("");
  const [ivScheduledAt, setIvScheduledAt] = useState("");
  const [ivSubmitting, setIvSubmitting] = useState(false);

  const [feedbackTargetId, setFeedbackTargetId] = useState<string | null>(null);
  const [fbRating, setFbRating] = useState("5");
  const [fbRecommendation, setFbRecommendation] = useState("yes");
  const [fbNotes, setFbNotes] = useState("");
  const [fbSubmitting, setFbSubmitting] = useState(false);

  const [hireEmployeeProfileId, setHireEmployeeProfileId] = useState("");
  const [hireSubmitting, setHireSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const appRes = await fetch(`/api/v1/projexa/recruitment/applications/${applicationId}`);
      const app: Application = await appRes.json().catch(() => null);
      if (!appRes.ok) throw new Error((app as unknown as { error?: string })?.error ?? "Couldn't load this application");

      const [openingRes, candRes, ivRes, empRes] = await Promise.all([
        fetch(`/api/v1/projexa/recruitment/job-openings/${app.jobOpeningId}`).catch(() => null),
        fetch("/api/v1/projexa/recruitment/candidates").catch(() => null),
        fetch(`/api/v1/projexa/recruitment/applications/${applicationId}/interviews`).catch(() => null),
        fetch("/api/v1/projexa/employees").catch(() => null),
      ]);
      setApplication(app);
      setJobOpening(openingRes?.ok ? await openingRes.json() : null);
      const candData = candRes?.ok ? await candRes.json() : { candidates: [] };
      setCandidate((candData.candidates ?? []).find((c: Candidate) => c.id === app.candidateId) ?? null);
      const ivData = ivRes?.ok ? await ivRes.json() : { interviews: [] };
      setInterviews(ivData.interviews ?? []);
      const empData = empRes?.ok ? await empRes.json() : { employees: [] };
      setEmployees(empData.employees ?? []);
      setLoadError(null);
    } catch (err) {
      setApplication(null);
      setLoadError(err instanceof Error && err.message ? err.message : "Couldn't load this application");
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => { load(); }, [load]);

  async function moveStage(toStage: string) {
    setStageBusy(true);
    try {
      const res = await fetch(`/api/v1/projexa/recruitment/applications/${applicationId}/stage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: toStage,
          rejectedReason: toStage === "rejected" ? (rejectReason || undefined) : undefined,
          offerAmount: toStage === "offer" && offerAmount ? Number(offerAmount) : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to move application stage");
      toast.success(`Moved to ${STAGE_LABEL[toStage]}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't move application stage");
    } finally {
      setStageBusy(false);
    }
  }

  async function scheduleInterview() {
    if (!ivInterviewerId || !ivRoundName.trim() || !ivScheduledAt) { toast.error("Interviewer, round name, and date/time are required"); return; }
    setIvSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projexa/recruitment/applications/${applicationId}/interviews`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewerId: ivInterviewerId, roundName: ivRoundName, scheduledAt: ivScheduledAt }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to schedule interview");
      toast.success("Interview scheduled");
      setIvInterviewerId(""); setIvRoundName(""); setIvScheduledAt("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't schedule interview");
    } finally {
      setIvSubmitting(false);
    }
  }

  async function submitFeedback() {
    if (!feedbackTargetId) return;
    setFbSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projexa/recruitment/interviews/${feedbackTargetId}/feedback`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: Number(fbRating), recommendation: fbRecommendation, feedback: fbNotes || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to submit feedback");
      toast.success("Feedback submitted");
      setFeedbackTargetId(null); setFbNotes("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit feedback");
    } finally {
      setFbSubmitting(false);
    }
  }

  async function linkHire() {
    if (!hireEmployeeProfileId) return;
    setHireSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projexa/recruitment/applications/${applicationId}/hire`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeProfileId: hireEmployeeProfileId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to link hired employee");
      toast.success("Linked to employee record");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't link hired employee");
    } finally {
      setHireSubmitting(false);
    }
  }

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-4">
      <Link href="/px/recruitment?tab=pipeline" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ArrowLeft className="size-3.5" /> Back to Recruitment
      </Link>

      {loadError || !application ? (
        <p role="alert" className="text-sm text-ct-error">{loadError ?? "Application not found."}</p>
      ) : (
        <>
          {(() => {
            const nextStages = VALID_TRANSITIONS[application.stage] ?? [];
            return (
              <>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-heading text-ct-navy">{candidate?.name ?? "—"} — {jobOpening?.title ?? "—"}</h1>
                    <Badge className={`text-xs border-0 ${STAGE_BADGE[application.stage] ?? "bg-ct-cloud text-ct-muted"}`}>{STAGE_LABEL[application.stage]}</Badge>
                  </div>
                </div>

                {(application.offerAmount || application.rejectedReason) && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {application.offerAmount && (
                      <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-4"><p className="text-xs text-ct-muted">Offer</p><p className="text-xl font-heading text-ct-navy">{application.offerAmount}</p></CardContent></Card>
                    )}
                    {application.rejectedReason && (
                      <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-4"><p className="text-xs text-ct-muted">Rejection Reason</p><p className="text-sm text-ct-navy">{application.rejectedReason}</p></CardContent></Card>
                    )}
                  </div>
                )}

                {nextStages.length > 0 && (
                  <Card className="rounded-xl shadow-card bg-white">
                    <CardHeader><CardTitle className="text-base text-ct-navy">Move Stage</CardTitle></CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap items-end gap-2">
                        {nextStages.map((next) => (
                          <Button key={next} size="sm" variant={next === "rejected" ? "outline" : "default"} className={next === "rejected" ? "" : "bg-ct-saffron hover:bg-ct-saffron-hover text-white"} disabled={stageBusy} onClick={() => moveStage(next)}>
                            {STAGE_LABEL[next]}
                          </Button>
                        ))}
                        {nextStages.includes("rejected") && (
                          <Input placeholder="Rejection reason (optional)" className="w-56" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                        )}
                        {nextStages.includes("offer") && (
                          <Input type="number" placeholder="Offer amount (optional)" className="w-44" value={offerAmount} onChange={(e) => setOfferAmount(e.target.value)} />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card className="rounded-xl shadow-card bg-white">
                  <CardHeader><CardTitle className="text-base text-ct-navy">Interviews</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {interviews.length === 0 ? (
                      <p className="text-xs text-ct-muted">No interviews scheduled yet.</p>
                    ) : (
                      <Table>
                        <TableBody>
                          {interviews.map((iv) => (
                            <TableRow key={iv.id}>
                              <TableCell className="text-sm text-ct-navy">{iv.roundName}</TableCell>
                              <TableCell className="text-xs text-ct-muted">{new Date(iv.scheduledAt).toLocaleString()}</TableCell>
                              <TableCell>
                                {iv.completedAt ? (
                                  <Badge variant="outline">{iv.recommendation}</Badge>
                                ) : feedbackTargetId === iv.id ? (
                                  <span className="text-xs text-ct-muted">Filling out feedback below…</span>
                                ) : (
                                  <Button size="sm" variant="ghost" onClick={() => { setFeedbackTargetId(iv.id); setFbRating("5"); setFbRecommendation("yes"); setFbNotes(""); }}>Add Feedback</Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {feedbackTargetId && (
                      <div className="space-y-2 rounded-md border border-ct-border p-3">
                        <p className="text-xs font-medium text-ct-navy">Interview Feedback</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-ct-muted uppercase">Rating (1–5)</Label>
                            <Select value={fbRating} onValueChange={setFbRating}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-ct-muted uppercase">Recommendation</Label>
                            <Select value={fbRecommendation} onValueChange={setFbRecommendation}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="strong_yes">Strong Yes</SelectItem>
                                <SelectItem value="yes">Yes</SelectItem>
                                <SelectItem value="no">No</SelectItem>
                                <SelectItem value="strong_no">Strong No</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <Input placeholder="Notes (optional)" value={fbNotes} onChange={(e) => setFbNotes(e.target.value)} />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={fbSubmitting} onClick={submitFeedback} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">{fbSubmitting ? "Submitting…" : "Submit"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setFeedbackTargetId(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 border-t border-ct-border pt-3">
                      <p className="text-xs font-medium text-ct-navy">Schedule Interview</p>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-ct-muted uppercase">Interviewer</Label>
                          <Select value={ivInterviewerId} onValueChange={setIvInterviewerId}>
                            <SelectTrigger className="w-48"><SelectValue placeholder="Select interviewer" /></SelectTrigger>
                            <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Round Name</Label><Input className="w-40" value={ivRoundName} onChange={(e) => setIvRoundName(e.target.value)} placeholder="e.g. Technical Round 1" /></div>
                        <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Scheduled At</Label><Input type="datetime-local" className="w-56" value={ivScheduledAt} onChange={(e) => setIvScheduledAt(e.target.value)} /></div>
                        <Button size="sm" variant="outline" disabled={ivSubmitting} onClick={scheduleInterview}>{ivSubmitting ? "Scheduling…" : "Schedule"}</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {application.stage === "hired" && !application.hiredEmployeeProfileId && (
                  <Card className="rounded-xl shadow-card bg-white">
                    <CardHeader><CardTitle className="text-base text-ct-navy flex items-center gap-1.5"><UserCheck className="size-4" /> Link to Employee Record</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-xs text-ct-muted">Requires an existing employee profile (create one on the Employees page first — the person must already have a user account and a saved employee profile).</p>
                      <div className="flex gap-2">
                        <Select value={hireEmployeeProfileId} onValueChange={setHireEmployeeProfileId}>
                          <SelectTrigger className="w-64"><SelectValue placeholder="Select employee profile" /></SelectTrigger>
                          <SelectContent>
                            {employees.filter((e) => e.profile).map((e) => (
                              <SelectItem key={e.profile!.id} value={e.profile!.id}>{e.name}{e.profile?.employeeCode ? ` (${e.profile.employeeCode})` : ""}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" disabled={hireSubmitting || !hireEmployeeProfileId} onClick={linkHire} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">Link</Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {application.hiredEmployeeProfileId && (
                  <p className="text-xs text-ct-success">Linked to employee profile {application.hiredEmployeeProfileId}.</p>
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
