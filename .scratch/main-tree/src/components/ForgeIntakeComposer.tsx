"use client";

// FORGE's project-intake composer -- the same Mode Pills + cascading Chain
// Selector mechanism as VERIDIAN AI OS's own VeriComposer (src/components/
// veri-chat/VeriComposer.tsx), repurposed for public lead qualification
// instead of internal task dispatch. The problem this solves: most visitors
// don't know how to describe the software they want in free text, and
// free-text-only intake produces badly-scoped requirements. Clicking through
// a small cascading tree captures the same signal with near-zero typing --
// free text here is optional elaboration, not the primary input. No
// attachment pin (unlike the real composer) -- this collects a lead, not a
// task with files.
import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { getVisitorId } from "@/lib/visitor-id";

type IntakeNode = { key: string; label: string; leaf?: boolean; children?: IntakeNode[] };

// Shared terminal step every branch converges into -- "not sure" is a valid
// answer at every level, so a visitor who genuinely doesn't know still ends
// up with a usable, honestly-vague submission rather than being stuck.
const STAGE_OPTIONS: IntakeNode[] = [
  { key: "idea", label: "Just an idea", leaf: true },
  { key: "rough_spec", label: "I have rough notes", leaf: true },
  { key: "detailed_spec", label: "I have a detailed spec ready", leaf: true },
  { key: "has_existing", label: "Something exists — needs improvement", leaf: true },
];

const INTAKE_TREE: IntakeNode[] = [
  {
    key: "website", label: "Website / Landing Page",
    children: [
      { key: "marketing_site", label: "Marketing / brochure site", children: STAGE_OPTIONS },
      { key: "portfolio", label: "Portfolio site", children: STAGE_OPTIONS },
      { key: "blog_content", label: "Blog / content site", children: STAGE_OPTIONS },
      { key: "not_sure_website", label: "Not sure — just need a web presence", children: STAGE_OPTIONS },
    ],
  },
  {
    key: "mobile_app", label: "Mobile App",
    children: [
      { key: "ios", label: "iOS only", children: STAGE_OPTIONS },
      { key: "android", label: "Android only", children: STAGE_OPTIONS },
      { key: "both_platforms", label: "Both (cross-platform)", children: STAGE_OPTIONS },
      { key: "not_sure_platform", label: "Not sure which platform", children: STAGE_OPTIONS },
    ],
  },
  {
    key: "web_app_saas", label: "Web App / SaaS Platform",
    children: [
      { key: "internal_saas", label: "For my own business (internal use)", children: STAGE_OPTIONS },
      { key: "b2b_saas", label: "To sell to other businesses (B2B)", children: STAGE_OPTIONS },
      { key: "b2c_saas", label: "To sell to consumers (B2C)", children: STAGE_OPTIONS },
      { key: "marketplace_saas", label: "A marketplace connecting two sides", children: STAGE_OPTIONS },
    ],
  },
  {
    key: "ai_agent", label: "AI Agent / Automation",
    children: [
      { key: "support_agent", label: "Customer support agent", children: STAGE_OPTIONS },
      { key: "sales_agent", label: "Sales / lead-generation agent", children: STAGE_OPTIONS },
      { key: "workflow_automation", label: "Internal workflow automation", children: STAGE_OPTIONS },
      { key: "data_agent", label: "Data analysis / reporting agent", children: STAGE_OPTIONS },
    ],
  },
  {
    key: "internal_tool", label: "Internal Business Tool",
    children: [
      { key: "crm_sales", label: "CRM / sales tracking", children: STAGE_OPTIONS },
      { key: "ops_inventory", label: "Inventory / operations", children: STAGE_OPTIONS },
      { key: "hr_team", label: "HR / team management", children: STAGE_OPTIONS },
      { key: "finance_accounting", label: "Finance / accounting", children: STAGE_OPTIONS },
    ],
  },
  {
    key: "ecommerce", label: "E-commerce / Marketplace",
    children: [
      { key: "single_store", label: "Online store (single seller)", children: STAGE_OPTIONS },
      { key: "multi_vendor", label: "Multi-vendor marketplace", children: STAGE_OPTIONS },
      { key: "booking", label: "Booking / reservation platform", children: STAGE_OPTIONS },
    ],
  },
  { key: "not_sure_top", label: "Not sure yet — help me figure it out", children: STAGE_OPTIONS },
];

function nodeChildrenAt(tree: IntakeNode[], path: string[], depth: number): IntakeNode[] | null {
  let level = tree;
  for (let i = 0; i < depth; i++) {
    const found = level.find((n) => n.key === path[i]);
    if (!found || found.leaf) return null;
    level = found.children ?? [];
  }
  return level;
}

function resolveLabels(tree: IntakeNode[], path: string[]): string[] {
  const labels: string[] = [];
  let level = tree;
  for (const key of path) {
    const found = level.find((n) => n.key === key);
    if (!found) break;
    labels.push(found.label);
    level = found.children ?? [];
  }
  return labels;
}

function ChainRows({ path, onPick }: { path: string[]; onPick: (depth: number, key: string) => void }) {
  const rows: { depth: number; options: IntakeNode[]; parentLabel: string }[] = [];
  let options = INTAKE_TREE;
  let parentLabel = "";
  for (let depth = 0; ; depth++) {
    if (!options || options.length === 0) break;
    rows.push({ depth, options, parentLabel });
    const sel = path[depth];
    if (sel === undefined) break;
    const found = options.find((o) => o.key === sel);
    if (!found || found.leaf) break;
    options = found.children ?? [];
    parentLabel = found.label;
  }

  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.depth} className="flex flex-wrap items-center gap-2">
          {row.depth > 0 && <span className="text-xs text-ct-muted shrink-0">{row.parentLabel}:</span>}
          {row.options.map((opt) => {
            const selected = path[row.depth] === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onPick(row.depth, opt.key)}
                className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  selected
                    ? opt.leaf ? "bg-emerald-600 border-emerald-600 text-white" : "bg-ct-navy border-ct-navy text-white"
                    : "bg-white border-ct-border2 text-ct-navy hover:border-ct-navy/40"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function ForgeIntakeComposer() {
  const [path, setPath] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  const [captcha, setCaptcha] = useState<{ question: string; token: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/forge/captcha").then((r) => r.json()).then(setCaptcha).catch(() => {});
  }, []);

  const chainComplete = nodeChildrenAt(INTAKE_TREE, path, path.length) === null && path.length > 0;

  function pick(depth: number, key: string) {
    setPath((prev) => {
      const next = [...prev.slice(0, depth), key];
      return next;
    });
    if (chainComplete) {
      // picking again after completion (revising an earlier answer) --
      // scroll the detail fields back into view once the new chain settles
      requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!captcha) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/forge/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId: getVisitorId(),
          selectionPath: path,
          selectionLabels: resolveLabels(INTAKE_TREE, path),
          notes,
          email,
          captchaToken: captcha.token,
          captchaAnswer: Number(captchaAnswer),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        fetch("/api/forge/captcha").then((r) => r.json()).then(setCaptcha).catch(() => {});
        setCaptchaAnswer("");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-ct-border bg-white shadow-card px-8 py-12 text-center">
        <Sparkles className="mx-auto size-8 text-ct-saffron" />
        <h3 className="mt-4 font-heading text-2xl text-ct-navy">Congratulations on this great journey!</h3>
        <p className="mx-auto mt-3 max-w-md leading-relaxed text-ct-slate">
          We&apos;re with you. Check your email — it&apos;ll come from{" "}
          <span className="font-medium text-ct-navy">VERIDIAN AI</span>. Click the link inside to confirm your
          address (check spam if you don&apos;t see it).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-ct-border bg-white shadow-card overflow-hidden text-left">
      <div className="flex items-center gap-2 border-b border-ct-border bg-ct-cloud px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-red-300" />
        <span className="size-2.5 rounded-full bg-yellow-300" />
        <span className="size-2.5 rounded-full bg-green-300" />
        <div className="ml-3 flex-1 truncate rounded-md bg-white px-3 py-1 text-xs text-ct-muted">
          veridian-ai-os.vercel.app/forge
        </div>
      </div>

      <div className="p-5 sm:p-7 bg-gradient-to-b from-white to-ct-cream">
        <div className="flex items-start gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-ct-saffron/15 text-ct-saffron shrink-0">
            <Sparkles className="size-4" />
          </span>
          <div>
            <div className="font-heading text-lg text-ct-navy">FORGE AI</div>
            <div className="text-sm text-ct-muted">Tell me what you&apos;re building — click through, no typing required.</div>
          </div>
        </div>

        <div className="mt-5">
          <ChainRows path={path} onPick={pick} />
        </div>

        {chainComplete && (
          <div ref={detailsRef} className="mt-6 border-t border-ct-border pt-6 space-y-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ct-muted">Anything else? (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Any detail that helps us understand the project…"
                className="mt-2 w-full rounded-lg border border-ct-border bg-white px-4 py-2.5 text-sm text-ct-navy focus:outline-none focus:ring-2 focus:ring-ct-navy/20"
              />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ct-muted">Email</label>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="mt-2 w-full rounded-lg border border-ct-border bg-white px-4 py-2.5 text-sm text-ct-navy focus:outline-none focus:ring-2 focus:ring-ct-navy/20"
                />
              </div>

              {captcha && (
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ct-muted">Quick check — {captcha.question}</label>
                  <input
                    required
                    type="text"
                    inputMode="numeric"
                    value={captchaAnswer}
                    onChange={(e) => setCaptchaAnswer(e.target.value)}
                    placeholder="Your answer"
                    className="mt-2 w-full max-w-[140px] rounded-lg border border-ct-border bg-white px-4 py-2.5 text-sm text-ct-navy focus:outline-none focus:ring-2 focus:ring-ct-navy/20"
                  />
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-full bg-ct-saffron hover:bg-ct-saffron-hover px-7 py-3 text-sm font-medium text-white shadow-saffron disabled:opacity-50"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {submitting ? "Sending…" : "Start your project"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
