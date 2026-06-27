"use client";
import { useState } from "react";

export default function AILibraryPage() {
  const [prompt, setPrompt] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function generate() {
    if (!prompt.trim()) return;
    setLoading(true);
    const res = await fetch("/api/ai/generate", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ prompt }) });
    const data = await res.json();
    setSuggestions(data.suggestions ?? []);
    setLoading(false);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">AI Compliance Library</h1>
      <p className="text-sm text-gray-500 mb-6">Describe your business and let AI suggest compliance requirements.</p>
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={3} placeholder="e.g. We are an IT company with 50 employees registered in Maharashtra..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3" />
        <button onClick={generate} disabled={loading||!prompt.trim()} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {loading ? "Generating..." : "Generate Suggestions"}
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Suggestions ({suggestions.length})</h2>
          <ul className="space-y-2">
            {suggestions.map((s,i) => (
              <li key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg text-sm">
                <span className="text-blue-500 mt-0.5">✓</span>
                <span className="text-gray-700">{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}