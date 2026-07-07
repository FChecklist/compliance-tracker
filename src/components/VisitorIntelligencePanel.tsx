"use client";

// Wave 113: the Sales HQ face of VERIDIAN SALES AI. Renders the 30-day
// public-site funnel (visitors, views, CTA clicks, offers, signups), traffic
// per product, and the drop-off table ("where they stopped") — plus an
// on-demand AI analysis button that runs the real Layer-1 pass over the
// funnel and renders its recommendations.

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { BarChart3, Brain, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Totals = { visitors: number; pageViews: number; ctaClicks: number; offersShown: number; offersClicked: number; signups: number };
type ByProduct = { productKey: string; views: number; visitors: number };
type DropOff = { product_key: string; section: string; stopped_here: number };
type Analysis = { summary: string; biggestLeak: string; recommendations: string[] };

export function VisitorIntelligencePanel() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [byProduct, setByProduct] = useState<ByProduct[]>([]);
  const [dropOffs, setDropOffs] = useState<DropOff[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sales-hq/visitors");
      if (!res.ok) return;
      const d = await res.json();
      setTotals(d.totals ?? null);
      setByProduct(d.byProduct ?? []);
      setDropOffs(Array.isArray(d.dropOffs) ? d.dropOffs : []);
    } catch {
      /* panel is best-effort */
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function runAnalysis() {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/sales-hq/visitors/analyze", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Analysis failed");
      setAnalysis(d.analysis);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  const stat = (label: string, value: number | undefined) => (
    <div className="rounded-lg border border-ct-border/60 bg-ct-cream px-4 py-3">
      <div className="text-2xl font-semibold text-ct-navy">{value ?? "—"}</div>
      <div className="text-xs text-ct-muted">{label}</div>
    </div>
  );

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-heading text-lg text-ct-navy">
            <BarChart3 className="size-5 text-ct-teal" /> Visitor Intelligence — last 30 days
          </h2>
          <Button onClick={runAnalysis} disabled={analyzing} variant="outline" className="rounded-full">
            {analyzing ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Brain className="size-4 mr-1.5 text-ct-saffron" />}
            Run VERIDIAN SALES AI analysis
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
          {stat("Visitors", totals?.visitors)}
          {stat("Page views", totals?.pageViews)}
          {stat("CTA clicks", totals?.ctaClicks)}
          {stat("Offers shown", totals?.offersShown)}
          {stat("Offers clicked", totals?.offersClicked)}
          {stat("Signups", totals?.signups)}
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-ct-navy">Traffic by product</h3>
            {byProduct.length === 0 ? (
              <p className="mt-2 text-xs text-ct-muted">No product-page traffic recorded yet.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {byProduct.map((p) => (
                  <div key={p.productKey} className="flex items-center justify-between border-b border-ct-border/60 py-1.5 text-sm last:border-0">
                    <span className="font-medium text-ct-navy">{p.productKey}</span>
                    <span className="text-ct-muted">{p.visitors} visitors · {p.views} views</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ct-navy">Where visitors stop (last section before exit)</h3>
            {dropOffs.length === 0 ? (
              <p className="mt-2 text-xs text-ct-muted">No drop-off data yet.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {dropOffs.map((d, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-ct-border/60 py-1.5 text-sm last:border-0">
                    <span className="text-ct-navy">{d.product_key} · <span className="font-medium">#{d.section}</span></span>
                    <span className="text-ct-muted">{d.stopped_here} stopped here</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {analysis && (
          <div className="mt-6 rounded-xl border border-ct-teal/30 bg-ct-teal/5 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ct-navy">
              <Brain className="size-4 text-ct-teal" /> VERIDIAN SALES AI
            </h3>
            <p className="mt-2 text-sm text-ct-slate">{analysis.summary}</p>
            <p className="mt-2 text-sm text-ct-slate"><span className="font-semibold text-ct-navy">Biggest leak:</span> {analysis.biggestLeak}</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ct-slate">
              {analysis.recommendations.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
