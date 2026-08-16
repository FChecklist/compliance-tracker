"use client";

// Shared "real feel of the product" demo, used on every product page's demo
// section in place of the old per-product illustrated mockups (AgentWindow /
// PracticeCockpit / ChecklistPhone / BuildLog). Every frame here is a
// faithful recreation of screens actually observed live in the deployed app
// (logged into the demo org, veridian-ai-os.vercel.app/home) -- real nav
// items, real mode pills, real stat numbers -- not an invented scenario.
// Browser-chrome frame styling matches this codebase's existing convention
// (see office/page.tsx's AgentWindow).
import { useEffect, useState } from "react";
import { Search, Bell, Moon, ChevronDown, Sparkles, Paperclip, Send } from "lucide-react";

const FRAMES = [
  {
    url: "veridian-ai-os.vercel.app/home",
    caption: "Every morning, VERIDIAN tells you exactly where things stand — before you ask.",
  },
  {
    url: "veridian-ai-os.vercel.app/home",
    caption: "Tell it what to do in plain steps. It routes to the right system on its own — no forms, no data entry.",
  },
  {
    url: "veridian-ai-os.vercel.app/home",
    caption: "You stay in the loop on everything that actually needs a decision. Nothing else.",
  },
];

function Chrome({ children }: { children: React.ReactNode; url: string }) {
  return (
    <div className="rounded-2xl border border-ct-border bg-white shadow-card overflow-hidden text-left">
      <div className="flex items-center gap-2 border-b border-ct-border bg-ct-cloud px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-red-300" />
        <span className="size-2.5 rounded-full bg-yellow-300" />
        <span className="size-2.5 rounded-full bg-green-300" />
        <div className="ml-3 flex-1 truncate rounded-md bg-white px-3 py-1 text-xs text-ct-muted">
          {FRAMES[0].url}
        </div>
      </div>
      {children}
    </div>
  );
}

function TopbarStrip() {
  return (
    <div className="flex items-center gap-3 bg-ct-navy px-4 py-2.5 text-white/90">
      <span className="text-xs font-medium">Demo Company Pvt. Ltd.</span>
      <div className="ml-auto flex items-center gap-3 text-white/70">
        <span className="flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-[11px]">
          <Search className="size-3" /> Search
        </span>
        <Moon className="size-3.5" />
        <Bell className="size-3.5" />
        <span className="flex items-center gap-1 text-[11px]">
          <span className="grid size-5 place-items-center rounded-full bg-ct-saffron text-[10px] font-bold">C</span>
          ceo <ChevronDown className="size-3" />
        </span>
      </div>
    </div>
  );
}

function FrameHome() {
  return (
    <div>
      <TopbarStrip />
      <div className="flex items-center gap-2 border-b border-ct-border bg-ct-cream px-4 py-2.5 text-[11px] font-medium">
        <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">3 Overdue</span>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-700">3 Due in 30 days</span>
        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">1 Safe</span>
      </div>
      <div className="p-5 sm:p-7 min-h-[280px] bg-gradient-to-b from-white to-ct-cream">
        <div className="flex items-start gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-ct-saffron/15 text-ct-saffron shrink-0">
            <Sparkles className="size-4" />
          </span>
          <div>
            <div className="font-heading text-lg text-ct-navy">Good evening.</div>
            <div className="mt-1 text-sm text-ct-muted max-w-sm">
              I&apos;m VERI, your assistant — tell me what you need and I&apos;ll do it for you. Here&apos;s where
              things stand.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FrameComposer() {
  const pills = ["Discuss", "Chats", "To Do", "VERI GRC AI", "VERI PROJECTS AI", "VERI ERP", "Product", "Customer", "Vendor"];
  const chips = ["VERI GRC AI", "VERI PROJECTS AI", "VERI ERP", "Product", "Customer", "Vendor"];
  return (
    <div>
      <TopbarStrip />
      <div className="p-5 sm:p-7 min-h-[280px] bg-gradient-to-b from-white to-ct-cream">
        <div className="flex flex-wrap gap-1.5">
          {pills.map((p) => (
            <span key={p} className="rounded-full bg-ct-cloud px-2.5 py-1 text-[11px] font-medium text-ct-slate">
              {p}
            </span>
          ))}
        </div>
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
          <div className="text-[13px] font-semibold text-ct-navy">Select the task you want me to do.</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-full border border-ct-border2 bg-white px-2.5 py-1 text-xs text-ct-navy">
                {c}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-ct-border bg-white px-3 py-2.5 text-sm text-ct-muted">
          <Paperclip className="size-4 shrink-0" />
          Select a task above to begin…
          <Send className="ml-auto size-4 shrink-0 text-ct-saffron" />
        </div>
      </div>
    </div>
  );
}

function FrameVeriChat() {
  const tabs = ["Overview", "Tasks", "Chats", "To Do"];
  return (
    <div>
      <TopbarStrip />
      <div className="p-5 sm:p-7 min-h-[280px] bg-gradient-to-b from-white to-ct-cream">
        <div className="font-heading text-base text-ct-navy">VERI Chat</div>
        <div className="mt-3 flex gap-4 border-b border-ct-border text-[13px] text-ct-muted">
          {tabs.map((t, i) => (
            <span key={t} className={`pb-2 ${i === 0 ? "border-b-2 border-ct-saffron text-ct-navy font-semibold" : ""}`}>
              {t}
            </span>
          ))}
        </div>
        <div className="mt-8 flex flex-col items-center text-center text-sm text-ct-muted">
          Nothing needs your attention right now.
        </div>
      </div>
    </div>
  );
}

const FRAME_COMPONENTS = [FrameHome, FrameComposer, FrameVeriChat];

export function RealProductDemo() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % FRAMES.length), 3800);
    return () => clearInterval(id);
  }, []);

  const Frame = FRAME_COMPONENTS[i];

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Chrome url={FRAMES[i].url}>
        <div key={i} className="animate-in fade-in duration-500">
          <Frame />
        </div>
      </Chrome>
      <p className="mt-4 text-center text-sm text-ct-muted min-h-[2.5em]">{FRAMES[i].caption}</p>
      <div className="mt-3 flex items-center justify-center gap-1.5">
        {FRAMES.map((_, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setI(idx)}
            aria-label={`Show frame ${idx + 1}`}
            className={`h-1.5 rounded-full transition-all ${idx === i ? "w-6 bg-ct-saffron" : "w-1.5 bg-ct-border"}`}
          />
        ))}
      </div>
    </div>
  );
}
