"use client";

// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// "Explain Business Terminology" -- a hover/inline explainer wrapping any
// piece of platform text (e.g. "SPI", "GST", "orgId") with a real
// definition looked up from the new business_terminology_glossary table
// (GET /api/glossary/lookup?term=...), instead of leaving domain jargon
// unexplained wherever it appears in the UI. Falls back to rendering the
// plain children (no wrapper) when nothing matches, so wrapping a term that
// isn't in the glossary yet is always safe -- never shows a broken/empty
// tooltip.
import { useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

type GlossaryTerm = { term: string; definition: string; category: string | null };

export function GlossaryTermTooltip({ term, children }: { term: string; children: React.ReactNode }) {
  const [entry, setEntry] = useState<GlossaryTerm | null | undefined>(undefined); // undefined = not yet fetched
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (entry !== undefined || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/glossary/lookup?term=${encodeURIComponent(term)}`);
      const data = await res.json();
      setEntry(data.term ?? null);
    } catch {
      setEntry(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <HoverCard onOpenChange={(open) => open && load()}>
      <HoverCardTrigger asChild>
        <span className="underline decoration-dotted decoration-ct-muted underline-offset-2 cursor-help">{children}</span>
      </HoverCardTrigger>
      <HoverCardContent className="text-xs">
        {entry === undefined || loading ? (
          <p className="text-ct-muted">Loading…</p>
        ) : entry === null ? (
          <p className="text-ct-muted">No glossary definition for &ldquo;{term}&rdquo; yet.</p>
        ) : (
          <div className="space-y-1">
            <p className="font-medium text-ct-navy">{entry.term}</p>
            <p className="text-ct-navy/90">{entry.definition}</p>
            {entry.category && <p className="text-ct-muted">{entry.category}</p>}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
