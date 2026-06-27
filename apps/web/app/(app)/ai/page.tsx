"use client";
import { useState } from "react";
import { Button } from "@compliancetrack/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@compliancetrack/ui";
import { Input } from "@compliancetrack/ui";
import { Badge } from "@compliancetrack/ui";
import { Spinner } from "@compliancetrack/ui";

export default function AILibraryPage() {
  const [prompt, setPrompt] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function generate() {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Compliance Library</h1>
        <p className="text-sm text-gray-500 mt-1">
          Describe your business and let AI suggest compliance requirements.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Business Description</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. We are an IT company with 50 employees registered in Maharashtra..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
          />
          <Button onClick={generate} disabled={loading || !prompt.trim()}>
            {loading ? <><Spinner className="mr-2 inline h-4 w-4" /> Generating...</> : "Generate Suggestions"}
          </Button>
        </CardContent>
      </Card>

      {suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Suggestions <Badge>{suggestions.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {suggestions.map((s, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg text-sm"
                >
                  <span className="text-blue-500 mt-0.5 font-bold">{i + 1}.</span>
                  <span className="text-gray-700">{s}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}