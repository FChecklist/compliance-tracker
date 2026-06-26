"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Item = {
  id: string; title: string; compliance_type: string; status: string; priority: string;
  due_date: string | null; description: string | null; unique_url_slug: string;
};

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
};

export default function SlugPage() {
  const { slug } = useParams<{ slug: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch("/api/compliance")
      .then((r) => r.json())
      .then((d) => {
        const found = (d.data?.compliance ?? d.compliance ?? []).find(
          (c: Item) => c.unique_url_slug === slug
        );
        if (found) setItem(found);
        else setNotFound(true);
        setLoading(false);
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [slug]);

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;
  if (notFound) return <div className="p-8 text-center"><h1 className="text-2xl font-bold text-gray-900">Not Found</h1><p className="text-gray-500 mt-2">This compliance item does not exist.</p><Link href="/compliance" className="text-blue-600 text-sm mt-4 inline-block">Back to Compliance</Link></div>;
  if (!item) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/compliance" className="text-blue-600 text-sm mb-6 inline-block">&larr; Back to Compliance</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">{item.title}</h1>
      <div className="flex gap-2 mb-6">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[item.status] ?? "bg-gray-100"}`}>{item.status.replace(/_/g, " ")}</span>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{item.compliance_type}</span>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{item.priority}</span>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div><span className="text-sm text-gray-500">Due Date</span><p className="font-medium">{item.due_date ? new Date(item.due_date).toLocaleDateString("en-IN") : "Not set"}</p></div>
        <div><span className="text-sm text-gray-500">Description</span><p>{item.description ?? "No description provided."}</p></div>
      </div>
    </div>
  );
}