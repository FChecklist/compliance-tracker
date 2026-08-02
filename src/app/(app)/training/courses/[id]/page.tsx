"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// VERIDIAN Review Framework remediation, Wave B (2026-07-17): course
// detail page. Two modes depending on role: a trainer/manager sees an
// authoring view (add modules/lessons, build the quiz); an employee sees a
// learner view (read lessons in order, take the quiz, mark complete).
// Document attachments on a lesson reuse the EXISTING POST /api/documents
// endpoint directly (linkedEntityType=training_lesson) rather than a new
// upload path.
import { useEffect, useState, useCallback, use } from "react";
import { toast } from "sonner";
import { Loader2, Plus, FileText, Video, Paperclip, CheckCircle2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Lesson = { id: string; title: string; contentType: string; content: string | null; videoUrl: string | null; sortOrder: number };
type Module = { id: string; title: string; description: string | null; sortOrder: number; lessons: Lesson[] };
type Assessment = { id: string; title: string; passingScorePercent: number | null; maxAttempts: number | null } | null;
type CourseDetail = {
  id: string; title: string; description: string | null; status: string; isMandatory: boolean;
  passingScorePercent: number; modules: Module[]; assessment: Assessment;
};
type Question = { id: string; questionText: string; questionType: string; options: { id: string; text: string }[]; correctAnswer?: unknown; points: number };
type EnrollmentDetail = {
  id: string; status: string; courseId: string;
  attempts: { id: string; scorePercent: string; passed: boolean; attemptNumber: number }[];
  completion: { completedAt: string } | null;
};

export default function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: courseId } = use(params);

  const [myRole, setMyRole] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [enrollment, setEnrollment] = useState<EnrollmentDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // authoring state
  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [newLessonTitleByModule, setNewLessonTitleByModule] = useState<Record<string, string>>({});
  const [newLessonContentByModule, setNewLessonContentByModule] = useState<Record<string, string>>({});
  const [newLessonTypeByModule, setNewLessonTypeByModule] = useState<Record<string, string>>({});
  const [savingAuthoring, setSavingAuthoring] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState("");
  const [newQuestionOptions, setNewQuestionOptions] = useState(["", ""]);
  const [newQuestionCorrect, setNewQuestionCorrect] = useState("0");

  const isManager = myRole === "manager" || myRole === "admin" || myRole === "veridian_admin" || myRole === "branch_manager";

  const loadMe = useCallback(async () => {
    const res = await fetch("/api/me");
    const data = await res.json();
    setMyRole(data.role ?? null);
    setMyId(data.id ?? null);
  }, []);

  const loadCourse = useCallback(async () => {
    const res = await fetch(`/api/training/courses/${courseId}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    setCourse(data);
    if (data.assessment) {
      const qRes = await fetch(`/api/training/assessments/${data.assessment.id}/questions`);
      const qData = await qRes.json();
      setQuestions(qData.questions ?? []);
    }
    setLoading(false);
  }, [courseId]);

  const loadMyEnrollment = useCallback(async () => {
    const res = await fetch(`/api/training/enrollments?courseId=${courseId}`);
    if (!res.ok) return;
    const data = await res.json();
    const mine = (data.enrollments ?? [])[0];
    if (mine) {
      const detailRes = await fetch(`/api/training/enrollments/${mine.id}`);
      if (detailRes.ok) setEnrollment(await detailRes.json());
    }
  }, [courseId]);

  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { loadCourse(); }, [loadCourse]);
  useEffect(() => { if (myId) loadMyEnrollment(); }, [myId, loadMyEnrollment]);

  const startIfNeeded = useCallback(async () => {
    if (enrollment && enrollment.status === "not_started") {
      await fetch(`/api/training/enrollments/${enrollment.id}/start`, { method: "POST" });
      await loadMyEnrollment();
    }
  }, [enrollment, loadMyEnrollment]);
  useEffect(() => { startIfNeeded(); }, [startIfNeeded]);

  const addModule = async () => {
    if (!newModuleTitle.trim()) return;
    setSavingAuthoring(true);
    try {
      const res = await fetch(`/api/training/courses/${courseId}/modules`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newModuleTitle }),
      });
      if (!res.ok) throw new Error();
      setNewModuleTitle("");
      toast.success("Module added");
      await loadCourse();
    } catch { toast.error("Failed to add module"); } finally { setSavingAuthoring(false); }
  };

  const addLesson = async (moduleId: string) => {
    const title = newLessonTitleByModule[moduleId];
    if (!title?.trim()) return;
    setSavingAuthoring(true);
    try {
      const contentType = newLessonTypeByModule[moduleId] || "rich_text";
      const content = newLessonContentByModule[moduleId] || "";
      const body: Record<string, unknown> = { title, contentType };
      if (contentType === "video_url") body.videoUrl = content; else if (contentType === "rich_text") body.content = content;
      const res = await fetch(`/api/training/modules/${moduleId}/lessons`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setNewLessonTitleByModule((p) => ({ ...p, [moduleId]: "" }));
      setNewLessonContentByModule((p) => ({ ...p, [moduleId]: "" }));
      toast.success("Lesson added");
      await loadCourse();
    } catch { toast.error("Failed to add lesson"); } finally { setSavingAuthoring(false); }
  };

  const createAssessmentForCourse = async () => {
    setSavingAuthoring(true);
    try {
      const res = await fetch(`/api/training/courses/${courseId}/assessment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `${course?.title ?? "Course"} Assessment`, passingScorePercent: course?.passingScorePercent ?? 70 }),
      });
      if (!res.ok) throw new Error();
      toast.success("Assessment created -- add questions below");
      await loadCourse();
    } catch { toast.error("Failed to create assessment"); } finally { setSavingAuthoring(false); }
  };

  const addQuestion = async () => {
    if (!course?.assessment || !newQuestionText.trim()) return;
    const validOptions = newQuestionOptions.filter((o) => o.trim());
    if (validOptions.length < 2) { toast.error("Add at least 2 options"); return; }
    setSavingAuthoring(true);
    try {
      const options = validOptions.map((text, i) => ({ id: String(i), text }));
      const res = await fetch(`/api/training/assessments/${course.assessment.id}/questions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionText: newQuestionText, questionType: "multiple_choice", options, correctAnswer: newQuestionCorrect }),
      });
      if (!res.ok) throw new Error();
      setNewQuestionText(""); setNewQuestionOptions(["", ""]); setNewQuestionCorrect("0");
      toast.success("Question added");
      await loadCourse();
    } catch { toast.error("Failed to add question"); } finally { setSavingAuthoring(false); }
  };

  const publishCourse = async () => {
    try {
      const res = await fetch(`/api/training/courses/${courseId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "published" }),
      });
      if (!res.ok) throw new Error();
      toast.success("Course published");
      await loadCourse();
    } catch { toast.error("Failed to publish course"); }
  };

  const submitQuiz = async () => {
    if (!course?.assessment || !enrollment) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/training/enrollments/${enrollment.id}/attempts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessmentId: course.assessment.id, answers }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      const attempt = await res.json();
      toast[attempt.passed ? "success" : "error"](attempt.passed ? `Passed with ${attempt.scorePercent}%!` : `Scored ${attempt.scorePercent}% -- did not meet the passing threshold`);
      await loadMyEnrollment();
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Failed to submit"); } finally { setSubmitting(false); }
  };

  const markComplete = async () => {
    if (!enrollment) return;
    try {
      const res = await fetch(`/api/training/enrollments/${enrollment.id}/complete`, { method: "POST" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      toast.success("Course marked complete");
      await loadMyEnrollment();
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Failed to mark complete"); }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!course) return <p className="text-sm text-ct-error">Course not found.</p>;

  return (
    <div className="space-y-4">
      <Link href="/training" className="text-xs text-ct-muted hover:text-ct-navy inline-flex items-center gap-1"><ArrowLeft className="size-3.5" /> Back to Training</Link>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">{course.title}</h1>
            <Badge className={`text-[10px] border-0 ${course.status === "published" ? "bg-ct-teal/15 text-ct-teal" : "bg-ct-cloud text-ct-muted"}`}>{course.status}</Badge>
            {course.isMandatory && <Badge className="text-[10px] border-0 bg-ct-error/15 text-ct-error">Mandatory</Badge>}
          </div>
          {course.description && <p className="text-sm text-ct-muted mt-1">{course.description}</p>}
        </div>
        {isManager && course.status === "draft" && (
          <Button onClick={publishCourse} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">Publish Course</Button>
        )}
      </div>

      {!isManager && enrollment?.status === "completed" && (
        <Card className="rounded-xl shadow-card bg-ct-teal/10 border-ct-teal/30">
          <CardContent className="pt-4 pb-4 flex items-center gap-2 text-ct-teal text-sm font-medium">
            <CheckCircle2 className="size-5" /> Completed{enrollment.completion ? ` on ${new Date(enrollment.completion.completedAt).toLocaleDateString()}` : ""}
          </CardContent>
        </Card>
      )}

      {/* ── Modules & Lessons ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-ct-navy">Modules</h2>
        {course.modules.map((m) => (
          <Card key={m.id} className="rounded-xl shadow-card bg-white">
            <CardContent className="pt-4 pb-4 space-y-2">
              <p className="text-sm font-medium text-ct-navy">{m.title}</p>
              <div className="space-y-1.5">
                {m.lessons.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-ct-cloud/40">
                    {l.contentType === "video_url" ? <Video className="size-4 text-ct-muted shrink-0" /> : l.contentType === "document" ? <Paperclip className="size-4 text-ct-muted shrink-0" /> : <FileText className="size-4 text-ct-muted shrink-0" />}
                    <span className="flex-1 min-w-0 text-ct-navy">{l.title}</span>
                  </div>
                ))}
                {m.lessons.length === 0 && <p className="text-xs text-ct-muted px-3">No lessons yet.</p>}
              </div>
              {isManager && (
                <div className="pt-2 border-t border-ct-border flex items-end gap-2 flex-wrap">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-semibold text-ct-muted uppercase">Lesson Title</Label>
                    <Input className="w-48" value={newLessonTitleByModule[m.id] ?? ""} onChange={(e) => setNewLessonTitleByModule((p) => ({ ...p, [m.id]: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-semibold text-ct-muted uppercase">Type</Label>
                    <Select value={newLessonTypeByModule[m.id] ?? "rich_text"} onValueChange={(v) => setNewLessonTypeByModule((p) => ({ ...p, [m.id]: v }))}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rich_text">Text</SelectItem>
                        <SelectItem value="video_url">Video URL</SelectItem>
                        <SelectItem value="document">Document</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {(newLessonTypeByModule[m.id] ?? "rich_text") !== "document" && (
                    <div className="space-y-1 flex-1 min-w-40">
                      <Label className="text-[10px] font-semibold text-ct-muted uppercase">{(newLessonTypeByModule[m.id] ?? "rich_text") === "video_url" ? "Video URL" : "Content"}</Label>
                      <Input value={newLessonContentByModule[m.id] ?? ""} onChange={(e) => setNewLessonContentByModule((p) => ({ ...p, [m.id]: e.target.value }))} />
                    </div>
                  )}
                  <Button size="sm" onClick={() => addLesson(m.id)} disabled={savingAuthoring || !newLessonTitleByModule[m.id]?.trim()} variant="outline">
                    <Plus className="size-3.5 mr-1" /> Add Lesson
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {isManager && (
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-ct-muted uppercase">New Module Title</Label>
              <Input className="w-64" value={newModuleTitle} onChange={(e) => setNewModuleTitle(e.target.value)} placeholder="Module 1: Introduction" />
            </div>
            <Button onClick={addModule} disabled={savingAuthoring || !newModuleTitle.trim()} className="bg-ct-teal hover:bg-ct-teal/90 text-white">
              <Plus className="size-4 mr-1.5" /> Add Module
            </Button>
          </div>
        )}
      </div>

      {/* ── Assessment ────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-ct-navy">Assessment</h2>
        {!course.assessment ? (
          isManager ? (
            <Button onClick={createAssessmentForCourse} disabled={savingAuthoring} variant="outline">
              <Plus className="size-4 mr-1.5" /> Add a Quiz to this Course
            </Button>
          ) : (
            <p className="text-xs text-ct-muted">This course has no quiz -- mark it complete once you&apos;ve reviewed the material.</p>
          )
        ) : isManager ? (
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="pt-4 pb-4 space-y-3">
              <p className="text-sm font-medium text-ct-navy">{course.assessment.title} (passing: {course.assessment.passingScorePercent}%)</p>
              <div className="space-y-1.5">
                {questions.map((q, i) => (
                  <div key={q.id} className="text-sm px-3 py-2 rounded-lg bg-ct-cloud/40">{i + 1}. {q.questionText}</div>
                ))}
              </div>
              <div className="pt-2 border-t border-ct-border space-y-2">
                <Label className="text-[10px] font-semibold text-ct-muted uppercase">New Question</Label>
                <Textarea value={newQuestionText} onChange={(e) => setNewQuestionText(e.target.value)} placeholder="Question text" rows={2} />
                <div className="space-y-1.5">
                  {newQuestionOptions.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="radio" name="correct" checked={newQuestionCorrect === String(i)} onChange={() => setNewQuestionCorrect(String(i))} />
                      <Input value={opt} onChange={(e) => setNewQuestionOptions((p) => p.map((o, oi) => oi === i ? e.target.value : o))} placeholder={`Option ${i + 1}`} />
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => setNewQuestionOptions((p) => [...p, ""])}><Plus className="size-3.5 mr-1" /> Add Option</Button>
                </div>
                <Button size="sm" onClick={addQuestion} disabled={savingAuthoring || !newQuestionText.trim()} className="bg-ct-teal hover:bg-ct-teal/90 text-white">
                  Add Question
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="pt-4 pb-4 space-y-3">
              <p className="text-sm font-medium text-ct-navy">{course.assessment.title}</p>
              {enrollment?.attempts && enrollment.attempts.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {enrollment.attempts.map((a) => (
                    <Badge key={a.id} className={`text-[10px] border-0 ${a.passed ? "bg-ct-teal/15 text-ct-teal" : "bg-ct-error/15 text-ct-error"}`}>Attempt {a.attemptNumber}: {a.scorePercent}%</Badge>
                  ))}
                </div>
              )}
              {enrollment?.status !== "completed" && (
                <div className="space-y-3">
                  {questions.map((q, i) => (
                    <div key={q.id} className="space-y-1.5">
                      <p className="text-sm text-ct-navy">{i + 1}. {q.questionText}</p>
                      {q.options.map((opt) => (
                        <label key={opt.id} className="flex items-center gap-2 text-sm text-ct-muted">
                          <input type="radio" name={q.id} checked={answers[q.id] === opt.id} onChange={() => setAnswers((p) => ({ ...p, [q.id]: opt.id }))} />
                          {opt.text}
                        </label>
                      ))}
                    </div>
                  ))}
                  <Button onClick={submitQuiz} disabled={submitting || questions.length === 0} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                    {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Submit Assessment
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {!isManager && !course.assessment && enrollment && enrollment.status !== "completed" && (
        <Button onClick={markComplete} className="bg-ct-teal hover:bg-ct-teal/90 text-white">
          <CheckCircle2 className="size-4 mr-2" /> Mark Course Complete
        </Button>
      )}
    </div>
  );
}
