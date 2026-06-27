"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusBadge, Button, Tabs, EmptyState, Badge, Card, CardContent, CardHeader, CardTitle } from "@compliance/ui";
import { ArrowLeft, Clock, User, Building2, FileText, MessageSquare, Upload, Edit3 } from "lucide-react";

type ComplianceDetail = {
  id: string;
  title: string;
  description: string;
  compliance_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  unique_url_slug: string;
  assignee_id: string | null;
  department_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type AuditPoint = { id: string; title: string; description: string | null; status: string; assignee_id: string | null; due_date: string | null; evidence_required: boolean; };
type Document = { id: string; filename: string; mime_type: string; size_bytes: number; uploaded_by: string | null; version: number; created_at: string; };
type Comment = { id: string; author_id: string; body: string; created_at: string; parent_comment_id: string | null; };
type HistoryEntry = { id: string; old_status: string | null; new_status: string; changed_by: string; change_reason: string | null; created_at: string; };

const tabList = [
  { id: "overview", label: "Overview", icon: <FileText className="w-4 h-4" /> },
  { id: "audit", label: "Audit Points", icon: <Edit3 className="w-4 h-4" /> },
  { id: "documents", label: "Documents", icon: <Upload className="w-4 h-4" /> },
  { id: "activity", label: "Activity", icon: <MessageSquare className="w-4 h-4" /> },
];

export default function ComplianceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("overview");
  const [item, setItem] = useState<ComplianceDetail | null>(null);
  const [auditPoints, setAuditPoints] = useState<AuditPoint[]>([]);
  const [docs, setDocs] = useState<Document[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/compliance/${id}`).then((r) => r.json()),
      fetch(`/api/compliance/${id}`).then(() => []), // audit points and docs — will connect when endpoints are ready
    ])
      .then(([data]) => {
        if (data.compliance) setItem(data.compliance);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!item) {
    return <EmptyState title="Compliance item not found" description="The item you're looking for doesn't exist or you don't have access." action={<Button variant="outline" onClick={() => router.back()}><ArrowLeft className="w-4 h-4 mr-2" />Go Back</Button>} />;
  }

  const apCounts = { pending: auditPoints.filter((a) => a.status === "pending").length, completed: auditPoints.filter((a) => a.status === "completed").length };

  return (
    <div className="space-y-4">
      {/* Back + Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => router.back()} className="mt-1 p-2 rounded-lg hover:bg-gray-100 text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{item.title}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <StatusBadge status={item.status} />
                <StatusBadge status={item.priority} />
                <Badge className="bg-gray-100 text-gray-600 capitalize">{item.compliance_type.replace("_", " ")}</Badge>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">Edit</Button>
              <Button size="sm">Change Status</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Meta Row */}
      <div className="flex flex-wrap gap-4 text-sm text-gray-600">
        {item.due_date && (
          <div className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-gray-400" /> Due: {new Date(item.due_date).toLocaleDateString()}</div>
        )}
        <div className="flex items-center gap-1.5"><Building2 className="w-4 h-4 text-gray-400" /> Department</div>
        <div className="flex items-center gap-1.5"><User className="w-4 h-4 text-gray-400" /> Assignee</div>
        <div className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-gray-400" /> Created: {new Date(item.created_at).toLocaleDateString()}</div>
      </div>

      {/* Tabs */}
      <Tabs tabs={tabList.map((t) => ({ ...t, count: t.id === "audit" ? auditPoints.length : t.id === "documents" ? docs.length : undefined }))} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab Content */}
      <div className="min-h-[300px]">
        {activeTab === "overview" && (
          <Card>
            <CardContent className="prose prose-sm max-w-none">
              <h3 className="text-base font-semibold text-gray-800 mb-2">Description</h3>
              {item.description ? (
                <p className="text-gray-600 whitespace-pre-wrap">{item.description}</p>
              ) : (
                <p className="text-gray-400 italic">No description provided.</p>
              )}
              {item.due_date && (
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Timeline</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className="text-gray-500">Created:</span> <span className="font-medium">{new Date(item.created_at).toLocaleString()}</span></div>
                    <div><span className="text-gray-500">Last Updated:</span> <span className="font-medium">{new Date(item.updated_at).toLocaleString()}</span></div>
                    <div><span className="text-gray-500">Due Date:</span> <span className="font-medium">{new Date(item.due_date).toLocaleDateString()}</span></div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "audit" && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Audit Points</CardTitle>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add</Button>
            </CardHeader>
            <CardContent>
              {auditPoints.length === 0 ? (
                <EmptyState title="No audit points" description="Add audit checkpoints to track compliance progress." />
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-4 text-xs text-gray-500 mb-2">
                    <span>Pending: {apCounts.pending}</span>
                    <span>Completed: {apCounts.completed}</span>
                  </div>
                  {auditPoints.map((ap) => (
                    <div key={ap.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:bg-gray-50">
                      <div className="flex items-center gap-3">
                        <StatusBadge status={ap.status} />
                        <div>
                          <p className="font-medium text-sm text-gray-900">{ap.title}</p>
                          {ap.description && <p className="text-xs text-gray-500">{ap.description}</p>}
                        </div>
                      </div>
                      {ap.evidence_required && <Badge className="bg-orange-100 text-orange-700 text-xs">Evidence</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "documents" && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Documents</CardTitle>
              <Button size="sm"><Upload className="w-4 h-4 mr-1" /> Upload</Button>
            </CardHeader>
            <CardContent>
              {docs.length === 0 ? (
                <EmptyState title="No documents" description="Upload supporting documents for this compliance item." />
              ) : (
                <div className="space-y-2">
                  {docs.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:bg-gray-50">
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{doc.filename}</p>
                          <p className="text-xs text-gray-400">{(doc.size_bytes / 1024).toFixed(1)} KB · v{doc.version}</p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm">Download</Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "activity" && (
          <Card>
            <CardContent>
              {history.length === 0 ? (
                <EmptyState title="No activity yet" description="Status changes and comments will appear here." />
              ) : (
                <div className="relative pl-6 space-y-4">
                  <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-gray-200" />
                  {history.map((entry) => (
                    <div key={entry.id} className="relative">
                      <div className="absolute -left-6 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white bg-blue-500" />
                      <div className="text-sm">
                        <p className="text-gray-700">
                          <span className="font-medium">Status changed</span> from <StatusBadge status={entry.old_status ?? "draft"} /> to <StatusBadge status={entry.new_status} />
                        </p>
                        {entry.change_reason && <p className="text-gray-500 mt-0.5">&quot;{entry.change_reason}&quot;</p>}
                        <p className="text-xs text-gray-400 mt-1">{new Date(entry.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// Need Plus icon
import { Plus } from "lucide-react";