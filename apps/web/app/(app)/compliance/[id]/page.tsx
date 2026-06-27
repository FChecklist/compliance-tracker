"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Item = { id:string; title:string; compliance_type:string; status:string; priority:string; due_date:string; description:string; assignee_id:string };

const STATUS_COLOR: Record<string,string> = { pending:"bg-yellow-100 text-yellow-800", in_progress:"bg-blue-100 text-blue-800", completed:"bg-green-100 text-green-800", overdue:"bg-red-100 text-red-800" };

export default function ComplianceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<Item | null>(null);

  useEffect(() => {
    fetch(`/api/compliance/${id}`).then(r=>r.json()).then(d=>setItem(d.compliance)).catch(()=>router.push("/compliance"));
  }, [id]);

  if (!item) return <div className="p-8 text-center text-gray-400">Loading...</div>;

  return (
    <div className="max-w-3xl">
      <button onClick={()=>router.back()} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back</button>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{item.title}</h1>
            <p className="text-sm text-gray-500 mt-1">{item.compliance_type.toUpperCase().replace("_"," ")}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLOR[item.status]??""}`}>{item.status}</span>
        </div>
        {item.description && <p className="text-sm text-gray-600 mb-4">{item.description}</p>}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-gray-500">Priority:</span> <span className="font-medium capitalize">{item.priority}</span></div>
          <div><span className="text-gray-500">Due date:</span> <span className="font-medium">{item.due_date ? new Date(item.due_date).toLocaleDateString() : "-"}</span></div>
        </div>
      </div>
      <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Comments</h2>
        <p className="text-sm text-gray-400">No comments yet.</p>
      </div>
    </div>
  );
}