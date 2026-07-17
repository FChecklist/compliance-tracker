"use client";

export const dynamic = "force-dynamic";

// VERIDIAN Review Framework remediation, Wave B: Training / LMS course
// player -- an enrolled employee works through modules/lessons (marking
// each complete) and takes any attached assessments. Course completion
// (trainingCompletions) is computed server-side by training-service.ts /
// training-assessment-service.ts as a side effect of these same calls; this
// page just reflects whatever the server has already decided.
import { useEffect, useState, useCallback, use as usePromise } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ChevronLeft, FileText, Video, Paperclip, CheckCircle2, Circle, ClipboardCheck, Award } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

type Lesson = { id: string; title: string; contentType: string; content: string | null; videoUrl: string | null; estimatedDurationMinutes: number | null };
type Module = { id: string; title: string; description: string | null; lessons: Lesson[] };
type Assessment = { id: string; title: string; description: string | null; passingScorePercent: number | null; maxAttempts: number | null };
type CourseDetail = { course: { id: string; title: string; description: string | null; passingScorePercent: number }; modules: Module[]; assessments: Assessment[]; totalLessons: number };
type Enrollment = { id: string; status: string; courseId: string };
type LessonProgress = { lessonId: string; status: string };
type QuizQuestion = { id: string; questionText: string; questionType: string; options: string[] };
type Attempt = { id: string; scorePercent: string; passed: boolean; attemptNumber: number };

export default function CoursePlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: courseId } = usePromise(params);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [progress, setProgress] = useState<LessonProgress[]>([]);
  const [marking, setMarking] = useState<string | null>(null);
  const [activeAssessmentId, setActiveAssessmentId] = useState<string | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [attempts, setAttempts] = useState<Record<string, Attempt[]>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [detailRes, enrollRes] = await Promise.all([
      fetch(`/api/training/courses/${courseId}`),
      fetch(`/api/training/enrollments?courseId=${courseId}`),
    ]);
    const [detailData, enrollData]: [CourseDetail, { enrollments: Enrollment[] }] = await Promise.all([detailRes.json(), enrollRes.json()]);
    setDetail(detailData);
    const myEnrollment = enrollData.enrollments?.[0] ?? null;
    setEnrollment(myEnrollment);
    if (myEnrollment) {
      const progRes = await fetch(`/api/training/enrollments/${myEnrollment.id}/lessons`);
      const progData = await progRes.json();
      setProgress(progData.progress ?? []);
      if (detailData.assessments?.length) {
        const attemptResults = await Promise.all(
          detailData.assessments.map((a) => fetch(`/api/training/assessments/${a.id}/attempts`).then((r) => r.json()))
        );
        const byAssessment: Record<string, Attempt[]> = {};
        detailData.assessments.forEach((a, i) => { byAssessment[a.id] = attemptResults[i]?.attempts ?? []; });
        setAttempts(byAssessment);
      }
    }
    setLoading(false);
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  const enroll = async () => {
    try {
      const res = await fetch("/api/training/enrollments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId }) });
      if (!res.ok) throw new Error();
      toast.success("Enrolled");
      await load();
    } catch { toast.error("Failed to enroll"); }
  };

  const progressByLesson = new Map(progress.map((p) => [p.lessonId, p.status]));

  const markLesson = async (lessonId: string, status: "in_progress" | "completed") => {
    setMarking(lessonId);
    try {
      const res = await fetch(`/api/training/lessons/${lessonId}/progress`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch { toast.error("Failed to update progress"); }
    finally { setMarking(null); }
  };

  const openAssessment = async (assessmentId: string) => {
    setActiveAssessmentId(assessmentId);
    setAnswers({});
    const res = await fetch(`/api/training/assessments/${assessmentId}/take`);
    const data = await res.json();
    setQuizQuestions(data.questions ?? []);
  };

  const submitQuiz = async (assessmentId: string) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/training/assessments/${assessmentId}/attempts`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast[data.passed ? "success" : "error"](`Scored ${data.scorePercent}% -- ${data.passed ? "Passed" : "Not passed"}`);
      setActiveAssessmentId(null);
      await load();
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Failed to submit"); }
    finally { setSubmitting(false); }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!detail) return <p className="text-sm text-ct-error">Course not found.</p>;

  const { course, modules, assessments, totalLessons } = detail;
  const completedLessons = progress.filter((p) => p.status === "completed").length;

  return (
    <div className="space-y-4">
      <Link href="/training" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ChevronLeft className="size-3.5" /> Back to Training
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">{course.title}</h1>
          {course.description && <p className="text-sm text-ct-muted mt-1">{course.description}</p>}
        </div>
        {enrollment ? (
          <Badge className={`border-0 ${enrollment.status === "completed" ? "bg-ct-teal/15 text-ct-teal" : "bg-ct-saffron/20 text-ct-saffron"}`}>
            {enrollment.status === "completed" ? <Award className="size-3.5 mr-1" /> : null}
            {enrollment.status === "completed" ? "Completed" : `${completedLessons}/${totalLessons} lessons`}
          </Badge>
        ) : (
          <Button onClick={enroll} className="bg-ct-teal hover:bg-ct-teal/90 text-white">Enroll</Button>
        )}
      </div>

      {!enrollment && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-6 pb-6 text-center text-sm text-ct-muted">Enroll to start tracking your progress through this course.</CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {modules.map((m) => (
          <Card key={m.id} className="rounded-xl shadow-card bg-white">
            <CardContent className="pt-4 pb-4 space-y-2">
              <p className="text-sm font-semibold text-ct-navy">{m.title}</p>
              {m.description && <p className="text-xs text-ct-muted">{m.description}</p>}
              <div className="divide-y divide-ct-border">
                {m.lessons.map((l) => {
                  const status = progressByLesson.get(l.id) ?? "not_started";
                  const Icon = l.contentType === "video" ? Video : l.contentType === "document" ? Paperclip : FileText;
                  return (
                    <div key={l.id} className="py-2.5 flex items-start gap-2.5">
                      <button
                        disabled={!enrollment || marking === l.id}
                        onClick={() => markLesson(l.id, status === "completed" ? "in_progress" : "completed")}
                        className="mt-0.5 shrink-0"
                        title={status === "completed" ? "Mark incomplete" : "Mark complete"}
                      >
                        {marking === l.id ? <Loader2 className="size-4 animate-spin text-ct-muted" /> : status === "completed" ? <CheckCircle2 className="size-4 text-ct-teal" /> : <Circle className="size-4 text-ct-muted" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Icon className="size-3.5 text-ct-muted" />
                          <p className="text-sm text-ct-navy">{l.title}</p>
                          {l.estimatedDurationMinutes && <span className="text-xs text-ct-muted">· {l.estimatedDurationMinutes} min</span>}
                        </div>
                        {l.contentType === "text" && l.content && <p className="text-xs text-ct-muted mt-1 whitespace-pre-wrap">{l.content}</p>}
                        {l.contentType === "video" && l.videoUrl && (
                          <a href={l.videoUrl} target="_blank" rel="noreferrer" className="text-xs text-ct-teal underline mt-1 inline-block">Watch video</a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}

        {assessments.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-ct-navy flex items-center gap-1.5"><ClipboardCheck className="size-4" /> Assessments</p>
            {assessments.map((a) => {
              const priorAttempts = attempts[a.id] ?? [];
              const passedAny = priorAttempts.some((at) => at.passed);
              const isActive = activeAssessmentId === a.id;
              return (
                <Card key={a.id} className="rounded-xl shadow-card bg-white">
                  <CardContent className="pt-4 pb-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <p className="text-sm font-medium text-ct-navy">{a.title}</p>
                        {a.description && <p className="text-xs text-ct-muted">{a.description}</p>}
                        <p className="text-xs text-ct-muted mt-0.5">
                          Pass mark {a.passingScorePercent ?? course.passingScorePercent}% · {priorAttempts.length} attempt(s){a.maxAttempts ? ` of ${a.maxAttempts}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {passedAny && <Badge className="border-0 bg-ct-teal/15 text-ct-teal">Passed</Badge>}
                        {enrollment && !isActive && (
                          <Button size="sm" variant="outline" onClick={() => openAssessment(a.id)}>
                            {priorAttempts.length > 0 ? "Retake" : "Start"}
                          </Button>
                        )}
                      </div>
                    </div>

                    {isActive && (
                      <div className="space-y-3 border-t border-ct-border pt-3">
                        {quizQuestions.map((q, qi) => (
                          <div key={q.id} className="space-y-1.5">
                            <p className="text-sm text-ct-navy">{qi + 1}. {q.questionText}</p>
                            {q.questionType === "multiple_choice" && (
                              <RadioGroup value={String(answers[q.id] ?? "")} onValueChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: Number(v) }))}>
                                {q.options.map((opt, oi) => (
                                  <div key={oi} className="flex items-center gap-2">
                                    <RadioGroupItem value={String(oi)} id={`${q.id}-${oi}`} />
                                    <Label htmlFor={`${q.id}-${oi}`} className="text-xs font-normal">{opt}</Label>
                                  </div>
                                ))}
                              </RadioGroup>
                            )}
                            {q.questionType === "true_false" && (
                              <RadioGroup value={String(answers[q.id] ?? "")} onValueChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v === "true" }))}>
                                <div className="flex items-center gap-2"><RadioGroupItem value="true" id={`${q.id}-t`} /><Label htmlFor={`${q.id}-t`} className="text-xs font-normal">True</Label></div>
                                <div className="flex items-center gap-2"><RadioGroupItem value="false" id={`${q.id}-f`} /><Label htmlFor={`${q.id}-f`} className="text-xs font-normal">False</Label></div>
                              </RadioGroup>
                            )}
                            {q.questionType === "short_answer" && (
                              <input
                                className="w-full rounded-md border border-ct-border px-2.5 py-1.5 text-xs"
                                value={String(answers[q.id] ?? "")}
                                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                              />
                            )}
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <Button size="sm" disabled={submitting} onClick={() => submitQuiz(a.id)} className="bg-ct-teal hover:bg-ct-teal/90 text-white">
                            {submitting ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null} Submit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setActiveAssessmentId(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
