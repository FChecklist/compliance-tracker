"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import {
  X,
  Calendar,
  Building2,
  Tag,
  Clock,
  User,
  CheckCircle2,
  PlayCircle,
  AlertTriangle,
  FileText,
  MessageSquare,
  History,
  ClipboardCheck,
  Send,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ChallanSection from "@/components/ChallanSection";

const STATUS_BADGE: Record<string, string> = {
  overdue: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  draft: "bg-purple-100 text-purple-700",
  not_applicable: "bg-gray-100 text-gray-600",
};

const STATUS_LABELS: Record<string, string> = {
  overdue: "Overdue",
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  draft: "Draft",
  not_applicable: "N/A",
};

const AP_STATUS_BADGE: Record<string, string> = {
  overdue: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
};

type ComplianceDetail = {
  id: string;
  title: string;
  description: string | null;
  complianceType: string;
  status: string;
  priority: string;
  dueDate: string | null;
  completedAt: string | null;
  period: string | null;
  financialYear: string | null;
  acknowledgementNumber: string | null;
  registrationNumber: string | null;
  amount: string | null;
  filedDate: string | null;
  paidDate: string | null;
  recurrenceType: string;
  createdAt: string;
  updatedAt: string;
  department: { name: string };
  assignedTo: { name: string; avatarUrl: string | null } | null;
  auditPoints: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    dueDate: string | null;
    assignedTo: { name: string } | null;
  }[];
  documents: {
    id: string;
    name: string;
    fileType: string | null;
    uploadedBy: { name: string };
    createdAt: string;
  }[];
  comments: {
    id: string;
    content: string;
    author: { name: string; avatarUrl: string | null };
    createdAt: string;
  }[];
  auditLogs: {
    id: string;
    action: string;
    details: string | null;
    userName: string;
    createdAt: string;
  }[];
};

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-4 w-32" />
      <div className="grid grid-cols-2 gap-4 mt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-24 mt-4" />
    </div>
  );
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export default function ComplianceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState<ComplianceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editPeriod, setEditPeriod] = useState('');
  const [editARN, setEditARN] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editFiledDate, setEditFiledDate] = useState('');
  const [editAssignedToId, setEditAssignedToId] = useState('');
  const [editComplianceType, setEditComplianceType] = useState('');
  const [editDepartmentId, setEditDepartmentId] = useState('');
  const [teamUsers, setTeamUsers] = useState<{id: string; name: string}[]>([]);
  const [departments, setDepartments] = useState<{id: string; name: string}[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const COMPLIANCE_TYPES = ['GST','TDS','MCA','PF','ESIC','INCOME_TAX','ROC','LABOUR','ENVIRONMENTAL','OTHER'];

  const sheetOpen = true;
  const id = params.id as string;

  const fetchDetail = () => {
    setLoading(true);
    fetch(`/api/compliance/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => {
        setData({
          ...d.item,
          auditPoints: d.auditPoints ?? [],
          documents: d.documents ?? [],
          comments: d.comments ?? [],
          auditLogs: d.auditLogs ?? [],
        });
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        toast.error("Failed to load compliance item");
      });
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const changeStatus = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/compliance/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Marked as ${STATUS_LABELS[newStatus]}`);
      fetchDetail();
    } catch {
      toast.error("Failed to update status");
    }
  };

  const startEditing = () => {
    if (!data) return;
    setEditTitle(data.title);
    setEditPriority(data.priority);
    setEditDueDate(data.dueDate ? data.dueDate.split('T')[0] : '');
    setEditPeriod(data.period ?? '');
    setEditARN(data.acknowledgementNumber ?? '');
    setEditAmount(data.amount ?? '');
    setEditFiledDate(data.filedDate ? data.filedDate.split('T')[0] : '');
    setEditAssignedToId('');
    setEditComplianceType(data.complianceType);
    setEditDepartmentId('');
    setEditing(true);
    fetch('/api/users').then(r => r.json()).then(d => setTeamUsers(d.users ?? []));
    fetch('/api/departments').then(r => r.json()).then(d => setDepartments(d.departments ?? d));
  };

  const saveEdits = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: editTitle,
        priority: editPriority,
        dueDate: editDueDate || null,
        period: editPeriod || null,
        acknowledgementNumber: editARN || null,
        amount: editAmount || null,
        filedDate: editFiledDate || null,
        complianceType: editComplianceType,
      };
      if (editAssignedToId) body.assignedToId = editAssignedToId;
      if (editDepartmentId) body.departmentId = editDepartmentId;
      const res = await fetch(`/api/compliance/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast.success('Changes saved');
      setEditing(false);
      fetchDetail();
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async () => {
    if (!confirm('Delete this compliance item? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/compliance/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error ?? 'Failed to delete');
        return;
      }
      toast.success('Compliance item deleted');
      router.push('/compliance');
    } catch {
      toast.error('Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const addComment = async () => {
    if (!commentText.trim()) return;
    try {
      const res = await fetch(`/api/compliance/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: commentText.trim() }),
      });
      if (!res.ok) throw new Error();
      toast.success('Comment added');
      setCommentText('');
      fetchDetail();
    } catch {
      toast.error('Failed to add comment');
    }
  };

  return (
    <>
      {/* Background: compliance list — user navigates back to see it */}
      <div className="space-y-4">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Compliance Register</h1>
          <p className="text-sm text-ct-muted mt-1">Select an item to view details</p>
        </div>
      </div>

      {/* Slide-over Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => {
        if (!open) router.push("/compliance");
      }}>
        <SheetContent side="right" className="w-full sm:w-[480px] p-0 overflow-y-auto">
          <SheetHeader className="sr-only">
            <SheetTitle>{data?.title ?? "Compliance Detail"}</SheetTitle>
            <SheetDescription>Compliance item details</SheetDescription>
          </SheetHeader>
          {loading ? (
            <DetailSkeleton />
          ) : !data ? (
            <div className="p-6 text-center">
              <p className="text-ct-muted">Item not found.</p>
              <Button variant="link" onClick={() => router.push("/compliance")}>
                Back to list
              </Button>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="bg-gradient-navy p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0 mr-4">
                    <h2 className="font-heading text-xl text-white leading-tight mb-2">
                      {data.title}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        className={cn(
                          "text-[10px] px-2 py-0.5 font-medium border-0",
                          STATUS_BADGE[data.status] ?? ""
                        )}
                      >
                        {STATUS_LABELS[data.status]}
                      </Badge>
                      <Badge className="text-[10px] px-2 py-0.5 bg-white/15 text-white/90 border-0">
                        {data.complianceType.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white/60 hover:text-white hover:bg-white/10"
                    onClick={() => router.push("/compliance")}
                  >
                    <X className="size-5" />
                  </Button>
                </div>
                <div className="flex items-center gap-4 text-xs text-white/60">
                  <span className="flex items-center gap-1">
                    <Building2 className="size-3" /> {data.department.name}
                  </span>
                  {data.assignedTo && (
                    <span className="flex items-center gap-1">
                      <User className="size-3" /> {data.assignedTo.name}
                    </span>
                  )}
                  {data.dueDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3" /> {format(new Date(data.dueDate), "dd MMM yyyy")}
                    </span>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <Tabs defaultValue="details" className="mt-4">
                <TabsList className="w-full justify-start rounded-none border-b border-ct-border bg-transparent h-10 px-4">
                  <TabsTrigger value="details" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-ct-saffron data-[state=active]:shadow-none rounded-none">
                    Details
                  </TabsTrigger>
                  <TabsTrigger value="audit-points" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-ct-saffron data-[state=active]:shadow-none rounded-none">
                    Audit Points
                  </TabsTrigger>
                  <TabsTrigger value="documents" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-ct-saffron data-[state=active]:shadow-none rounded-none">
                    Documents
                  </TabsTrigger>
                  <TabsTrigger value="activity" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-ct-saffron data-[state=active]:shadow-none rounded-none">
                    Activity
                  </TabsTrigger>
                  <TabsTrigger value="challans" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-ct-saffron data-[state=active]:shadow-none rounded-none">
                    Challans
                  </TabsTrigger>
                  <TabsTrigger value="comments" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-ct-saffron data-[state=active]:shadow-none rounded-none">
                    Comments
                  </TabsTrigger>
                </TabsList>

                {/* Details Tab */}
                <TabsContent value="details" className="p-4 space-y-4 mt-0">
                  {data.description && (
                    <div>
                      <p className="text-xs font-semibold text-ct-muted uppercase mb-1.5">Description</p>
                      <p className="text-sm text-ct-slate leading-relaxed">{data.description}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Type", value: data.complianceType.replace(/_/g, " "), icon: Tag },
                      { label: "Priority", value: data.priority, icon: AlertTriangle },
                      { label: "Period", value: data.period ?? "—", icon: Clock },
                      { label: "Financial Year", value: data.financialYear ? `FY ${data.financialYear}` : "—", icon: Calendar },
                      { label: "Department", value: data.department.name, icon: Building2 },
                      { label: "Assigned To", value: data.assignedTo?.name ?? "Unassigned", icon: User },
                      { label: "Due Date", value: data.dueDate ? format(new Date(data.dueDate), "dd MMM yyyy") : "—", icon: Calendar },
                      { label: "ARN / Ref", value: data.acknowledgementNumber ?? "—", icon: FileText },
                      ...(data.registrationNumber ? [{ label: "Registration", value: data.registrationNumber, icon: Tag }] : []),
                      ...(data.amount ? [{ label: "Amount", value: new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(data.amount)), icon: FileText }] : []),
                      ...(data.filedDate ? [{ label: "Filed Date", value: format(new Date(data.filedDate), "dd MMM yyyy"), icon: CheckCircle2 }] : []),
                      ...(data.paidDate ? [{ label: "Paid Date", value: format(new Date(data.paidDate), "dd MMM yyyy"), icon: CheckCircle2 }] : []),
                      ...(data.recurrenceType !== "none" ? [{ label: "Recurrence", value: data.recurrenceType.replace("_", "-"), icon: History }] : []),
                      { label: "Created", value: format(new Date(data.createdAt), "dd MMM yyyy"), icon: Clock },
                    ].map((field, idx) => (
                      <div key={field.label} className="bg-ct-cloud rounded-lg p-3">
                        <div className="flex items-center gap-1.5 text-[10px] text-ct-muted uppercase font-semibold mb-1">
                          <field.icon className="size-3" />
                          {field.label}
                        </div>
                        <p className="text-sm font-medium text-ct-navy">{field.value}</p>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                {/* Audit Points Tab */}
                <TabsContent value="audit-points" className="p-4 mt-0">
                  {data.auditPoints.length === 0 ? (
                    <div className="text-center py-8">
                      <ClipboardCheck className="size-8 text-ct-border mx-auto mb-2" />
                      <p className="text-sm text-ct-muted">No audit points defined.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {data.auditPoints.map((ap) => (
                        <div
                          key={ap.id}
                          className="flex items-start gap-3 p-3 rounded-lg bg-white border border-ct-border"
                        >
                          <Checkbox
                            checked={ap.status === "completed"}
                            className="mt-0.5"
                            onCheckedChange={async (checked) => {
                              try {
                                const res = await fetch(`/api/audit-points/${ap.id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ status: checked ? 'completed' : 'pending' }),
                                });
                                if (!res.ok) throw new Error();
                                fetchDetail();
                              } catch {
                                toast.error('Failed to update');
                              }
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-ct-navy">{ap.title}</p>
                            {ap.description && (
                              <p className="text-xs text-ct-muted mt-0.5">{ap.description}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5">
                              <Badge
                                variant="secondary"
                                className={cn(
                                  "text-[9px] px-1.5 py-0",
                                  AP_STATUS_BADGE[ap.status] ?? ""
                                )}
                              >
                                {STATUS_LABELS[ap.status] ?? ap.status}
                              </Badge>
                              {ap.assignedTo && (
                                <span className="text-[10px] text-ct-muted">{ap.assignedTo.name}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Documents Tab */}
                <TabsContent value="documents" className="p-4 mt-0">
                  {data.documents.length === 0 ? (
                    <div className="text-center py-8">
                      <FileText className="size-8 text-ct-border mx-auto mb-2" />
                      <p className="text-sm text-ct-muted">No documents uploaded.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {data.documents.map((doc) => (
                        <div
                          key={doc.id}
                          className="flex items-center gap-3 p-3 rounded-lg bg-white border border-ct-border"
                        >
                          <FileText className="size-5 text-ct-saffron shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-ct-navy truncate">{doc.name}</p>
                            <p className="text-[10px] text-ct-muted">
                              {doc.uploadedBy.name} &middot;{" "}
                              {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Activity Tab */}
                <TabsContent value="activity" className="p-4 mt-0">
                  {data.auditLogs.length === 0 ? (
                    <div className="text-center py-8">
                      <History className="size-8 text-ct-border mx-auto mb-2" />
                      <p className="text-sm text-ct-muted">No activity recorded yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {data.auditLogs.map((log) => (
                        <div key={log.id} className="flex items-start gap-3">
                          <div className="mt-1.5 size-2 rounded-full bg-ct-teal shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm text-ct-navy">{log.details ?? log.action}</p>
                            <p className="text-[10px] text-ct-muted mt-0.5">
                              {log.userName} &middot;{" "}
                              {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Challans Tab */}
                <TabsContent value="challans" className="p-4 mt-0">
                  <ChallanSection complianceItemId={id} />
                </TabsContent>

                {/* Comments Tab */}
                <TabsContent value="comments" className="p-4 mt-0">
                  <div className="space-y-3 mb-4">
                    {data.comments.length === 0 ? (
                      <p className="text-sm text-ct-muted py-4">No comments yet.</p>
                    ) : (
                      data.comments.map((c) => (
                        <div key={c.id} className="flex items-start gap-3">
                          <Avatar className="h-7 w-7 mt-0.5">
                            <AvatarFallback className="bg-ct-accent text-ct-saffron text-[10px] font-bold">
                              {getInitials(c.author.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 bg-ct-cloud rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold text-ct-navy">{c.author.name}</span>
                              <span className="text-[10px] text-ct-muted">
                                {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                              </span>
                            </div>
                            <p className="text-sm text-ct-slate">{c.content}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add a comment..."
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addComment()}
                      className="flex-1 h-9"
                    />
                    <Button
                      size="icon"
                      className="h-9 w-9 bg-ct-saffron hover:bg-ct-saffron-hover text-white shrink-0"
                      onClick={addComment}
                    >
                      <Send className="size-4" />
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>

              {/* Footer Actions */}
              <div className="flex gap-2 p-4 border-t border-ct-border flex-wrap">
                {editing ? (
                  <>
                    <Button
                      size="sm"
                      className="flex-1 bg-ct-teal hover:bg-ct-teal-hover text-white"
                      onClick={saveEdits}
                      disabled={saving}
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => setEditing(false)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    {data.status !== "completed" && (
                      <Button
                        size="sm"
                        className="flex-1 bg-ct-teal hover:bg-ct-teal-hover text-white"
                        onClick={() => changeStatus("completed")}
                      >
                        <CheckCircle2 className="size-4 mr-1.5" />
                        Mark Complete
                      </Button>
                    )}
                    {data.status === "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-blue-200 text-blue-700 hover:bg-blue-50"
                        onClick={() => changeStatus("in_progress")}
                      >
                        <PlayCircle className="size-4 mr-1.5" />
                        Start
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={startEditing}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      onClick={deleteItem}
                      disabled={deleting}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                )}
              </div>

              {/* Edit Form (shown when editing) */}
              {editing && (
                <div className="p-4 border-t border-ct-border space-y-3 bg-ct-cloud/30">
                  <p className="text-xs font-semibold text-ct-muted uppercase">Edit Details</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2 space-y-1">
                      <label className="text-[10px] font-semibold text-ct-muted uppercase">Title</label>
                      <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-ct-muted uppercase">Priority</label>
                      <select value={editPriority} onChange={e => setEditPriority(e.target.value)} className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-ct-muted uppercase">Due Date</label>
                      <Input type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-ct-muted uppercase">Period</label>
                      <Input value={editPeriod} onChange={e => setEditPeriod(e.target.value)} className="h-8 text-sm" placeholder="e.g. June 2026" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-ct-muted uppercase">ARN / Ref</label>
                      <Input value={editARN} onChange={e => setEditARN(e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-ct-muted uppercase">Amount (₹)</label>
                      <Input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-ct-muted uppercase">Filed Date</label>
                      <Input type="date" value={editFiledDate} onChange={e => setEditFiledDate(e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-ct-muted uppercase">Compliance Type</label>
                      <select value={editComplianceType} onChange={e => setEditComplianceType(e.target.value)} className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm">
                        {COMPLIANCE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                      </select>
                    </div>
                    {departments.length > 0 && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-ct-muted uppercase">Move to Department</label>
                        <select value={editDepartmentId} onChange={e => setEditDepartmentId(e.target.value)} className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm">
                          <option value="">Keep current</option>
                          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                    )}
                    {teamUsers.length > 0 && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-ct-muted uppercase">Reassign To</label>
                        <select value={editAssignedToId} onChange={e => setEditAssignedToId(e.target.value)} className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm">
                          <option value="">Keep current</option>
                          {teamUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}