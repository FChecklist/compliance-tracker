"use client";

export const dynamic = "force-dynamic";

// VERIDIAN Review Framework remediation, Wave B: Training / LMS course
// authoring detail -- edit course metadata, build modules/lessons, build
// assessments/question banks. Manager-or-above only (server-enforced).
import { useEffect, useState, useCallback, use as usePromise } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ChevronLeft, Plus, Trash2, ClipboardCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Lesson = { id: string; title: string; contentType: string; content: string | null; videoUrl: string | null };
type Module = { id: string; title: string; lessons: Lesson[] };
type Course = { id: string; title: string; description: string | null; category: string | null; isMandatory: boolean; status: string; passingScorePercent: number; targetRole: string | null };
type Assessment = { id: string; title: string; passingScorePercent: number | null; maxAttempts: number | null };
type Question = { id: string; questionText: string; questionType: string; options: string[]; correctAnswer: unknown; points: number };

export default function CourseAuthoringDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: courseId } = usePromise(params);
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [savingMeta, setSavingMeta] = useState(false);
  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [newAssessmentTitle, setNewAssessmentTitle] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/training/courses/${courseId}`);
    const data = await res.json();
    setCourse(data.course);
    setModules(data.modules ?? []);
    setAssessments(data.assessments ?? []);
    setLoading(false);
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  const saveMeta = async (patch: Partial<Course>) => {
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/training/courses/${courseId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCourse(data);
      toast.success("Saved");
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Failed to save"); }
    finally { setSavingMeta(false); }
  };

  const addModule = async () => {
    if (!newModuleTitle.trim()) return;
    const res = await fetch(`/api/training/courses/${courseId}/modules`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newModuleTitle, sortOrder: modules.length }),
    });
    if (res.ok) { setNewModuleTitle(""); await load(); } else toast.error("Failed to add module");
  };

  const deleteModule = async (moduleId: string) => {
    await fetch(`/api/training/modules/${moduleId}`, { method: "DELETE" });
    await load();
  };

  const addLesson = async (moduleId: string, title: string) => {
    if (!title.trim()) return;
    const module_ = modules.find((m) => m.id === moduleId);
    await fetch(`/api/training/modules/${moduleId}/lessons`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, sortOrder: module_?.lessons.length ?? 0 }),
    });
    await load();
  };

  const deleteLesson = async (lessonId: string) => {
    await fetch(`/api/training/lessons/${lessonId}`, { method: "DELETE" });
    await load();
  };

  const updateLesson = async (lessonId: string, patch: Partial<Lesson>) => {
    await fetch(`/api/training/lessons/${lessonId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    await load();
  };

  const addAssessment = async () => {
    if (!newAssessmentTitle.trim()) return;
    const res = await fetch(`/api/training/courses/${courseId}/assessments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newAssessmentTitle }),
    });
    if (res.ok) { setNewAssessmentTitle(""); await load(); } else toast.error("Failed to add assessment");
  };

  const deleteAssessment = async (assessmentId: string) => {
    await fetch(`/api/training/assessments/${assessmentId}`, { method: "DELETE" });
    await load();
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!course) return <p className="text-sm text-ct-error">Course not found.</p>;

  return (
    <div className="space-y-4">
      <Link href="/training/authoring" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ChevronLeft className="size-3.5" /> Back to Authoring
      </Link>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Input
              className="text-lg font-heading text-ct-navy border-0 shadow-none px-0 h-auto focus-visible:ring-0"
              defaultValue={course.title}
              onBlur={(e) => e.target.value !== course.title && saveMeta({ title: e.target.value })}
            />
            {savingMeta && <Loader2 className="size-4 animate-spin text-ct-muted shrink-0" />}
          </div>
          <Textarea
            defaultValue={course.description ?? ""}
            placeholder="Course description"
            onBlur={(e) => e.target.value !== (course.description ?? "") && saveMeta({ description: e.target.value })}
            rows={2}
          />
          <div className="flex gap-3 flex-wrap items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={course.status} onValueChange={(v) => saveMeta({ status: v as Course["status"] })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Input className="w-40 h-9" defaultValue={course.category ?? ""} onBlur={(e) => saveMeta({ category: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Passing score %</Label>
              <Input type="number" className="w-24 h-9" defaultValue={course.passingScorePercent} onBlur={(e) => saveMeta({ passingScorePercent: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Target role</Label>
              <Input className="w-36 h-9" defaultValue={course.targetRole ?? ""} onBlur={(e) => saveMeta({ targetRole: e.target.value })} />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-ct-muted pb-2">
              <input type="checkbox" checked={course.isMandatory} onChange={(e) => saveMeta({ isMandatory: e.target.checked })} /> Mandatory
            </label>
            {course.status === "published" && <Badge className="border-0 bg-ct-teal/15 text-ct-teal">Live</Badge>}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="assessments"><ClipboardCheck className="size-3.5 mr-1.5" /> Assessments</TabsTrigger>
        </TabsList>

        {/* ── Content: modules/lessons ─────────────────────────────── */}
        <TabsContent value="content" className="mt-4 space-y-3">
          {modules.map((m) => (
            <Card key={m.id} className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-4 pb-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ct-navy">{m.title}</p>
                  <Button size="icon" variant="ghost" onClick={() => deleteModule(m.id)}><Trash2 className="size-4 text-ct-error" /></Button>
                </div>
                <div className="divide-y divide-ct-border">
                  {m.lessons.map((l) => (
                    <div key={l.id} className="py-2 flex items-center gap-2">
                      <span className="flex-1 text-sm text-ct-navy">{l.title}</span>
                      <Select value={l.contentType} onValueChange={(v) => updateLesson(l.id, { contentType: v as Lesson["contentType"] })}>
                        <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Text</SelectItem>
                          <SelectItem value="video">Video</SelectItem>
                          <SelectItem value="document">Document</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" onClick={() => deleteLesson(l.id)}><Trash2 className="size-3.5 text-ct-error" /></Button>
                    </div>
                  ))}
                </div>
                <AddLessonRow onAdd={(title) => addLesson(m.id, title)} />
              </CardContent>
            </Card>
          ))}
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="pt-4 pb-4 flex gap-2 items-end">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">New module</Label>
                <Input value={newModuleTitle} onChange={(e) => setNewModuleTitle(e.target.value)} placeholder="Module 1: Introduction" />
              </div>
              <Button onClick={addModule} disabled={!newModuleTitle.trim()} className="bg-ct-teal hover:bg-ct-teal/90 text-white"><Plus className="size-4 mr-2" /> Add Module</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Assessments/quizzes ──────────────────────────────────── */}
        <TabsContent value="assessments" className="mt-4 space-y-3">
          {assessments.map((a) => <AssessmentEditor key={a.id} assessment={a} onDelete={() => deleteAssessment(a.id)} />)}
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="pt-4 pb-4 flex gap-2 items-end">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">New assessment</Label>
                <Input value={newAssessmentTitle} onChange={(e) => setNewAssessmentTitle(e.target.value)} placeholder="Final Quiz" />
              </div>
              <Button onClick={addAssessment} disabled={!newAssessmentTitle.trim()} className="bg-ct-teal hover:bg-ct-teal/90 text-white"><Plus className="size-4 mr-2" /> Add Assessment</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AddLessonRow({ onAdd }: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  return (
    <div className="flex gap-2 pt-1">
      <Input className="h-8 text-xs flex-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a lesson..." />
      <Button size="sm" variant="outline" onClick={() => { onAdd(title); setTitle(""); }} disabled={!title.trim()}>Add</Button>
    </div>
  );
}

function AssessmentEditor({ assessment, onDelete }: { assessment: Assessment; onDelete: () => void }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [qText, setQText] = useState("");
  const [qType, setQType] = useState<"multiple_choice" | "true_false" | "short_answer">("multiple_choice");
  const [qOptions, setQOptions] = useState("");
  const [qCorrectIndex, setQCorrectIndex] = useState(0);
  const [qCorrectBool, setQCorrectBool] = useState("true");
  const [qCorrectText, setQCorrectText] = useState("");
  const [adding, setAdding] = useState(false);

  const loadQuestions = useCallback(async () => {
    const res = await fetch(`/api/training/assessments/${assessment.id}`);
    const data = await res.json();
    setQuestions(data.questions ?? []);
  }, [assessment.id]);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next) await loadQuestions();
  };

  const addQuestion = async () => {
    if (!qText.trim()) return;
    setAdding(true);
    try {
      const options = qType === "multiple_choice" ? qOptions.split(",").map((o) => o.trim()).filter(Boolean) : [];
      const correctAnswer = qType === "multiple_choice" ? qCorrectIndex : qType === "true_false" ? qCorrectBool === "true" : qCorrectText;
      const res = await fetch(`/api/training/assessments/${assessment.id}/questions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionText: qText, questionType: qType, options, correctAnswer, points: 1 }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      setQText(""); setQOptions(""); setQCorrectIndex(0); setQCorrectText("");
      await loadQuestions();
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Failed to add question"); }
    finally { setAdding(false); }
  };

  const deleteQuestion = async (id: string) => {
    await fetch(`/api/training/questions/${id}`, { method: "DELETE" });
    await loadQuestions();
  };

  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={toggle} className="text-sm font-medium text-ct-navy">{assessment.title} ({questions.length || (expanded ? 0 : "…")} questions)</button>
          <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="size-4 text-ct-error" /></Button>
        </div>
        {expanded && (
          <div className="space-y-3 border-t border-ct-border pt-3">
            <ul className="space-y-1.5">
              {questions.map((q) => (
                <li key={q.id} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 text-ct-navy">{q.questionText} <span className="text-ct-muted">({q.questionType})</span></span>
                  <Button size="icon" variant="ghost" onClick={() => deleteQuestion(q.id)}><Trash2 className="size-3.5 text-ct-error" /></Button>
                </li>
              ))}
            </ul>
            <div className="space-y-2 border-t border-ct-border pt-3">
              <Input className="h-8 text-xs" value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Question text" />
              <div className="flex gap-2 items-end flex-wrap">
                <Select value={qType} onValueChange={(v) => setQType(v as typeof qType)}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                    <SelectItem value="true_false">True/False</SelectItem>
                    <SelectItem value="short_answer">Short Answer</SelectItem>
                  </SelectContent>
                </Select>
                {qType === "multiple_choice" && (
                  <>
                    <Input className="h-8 text-xs w-64" value={qOptions} onChange={(e) => setQOptions(e.target.value)} placeholder="Option A, Option B, Option C" />
                    <Input type="number" className="h-8 text-xs w-28" value={qCorrectIndex} onChange={(e) => setQCorrectIndex(Number(e.target.value))} placeholder="Correct index" />
                  </>
                )}
                {qType === "true_false" && (
                  <Select value={qCorrectBool} onValueChange={setQCorrectBool}>
                    <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="true">True</SelectItem><SelectItem value="false">False</SelectItem></SelectContent>
                  </Select>
                )}
                {qType === "short_answer" && (
                  <Input className="h-8 text-xs w-56" value={qCorrectText} onChange={(e) => setQCorrectText(e.target.value)} placeholder="Correct answer" />
                )}
                <Button size="sm" disabled={adding || !qText.trim()} onClick={addQuestion} className="bg-ct-teal hover:bg-ct-teal/90 text-white">
                  {adding ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Plus className="size-3.5 mr-1.5" />} Add Question
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
