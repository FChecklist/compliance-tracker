"use client";

// Three "Join us as..." cards feeding one shared Contact Us form below --
// picking a card pre-selects that category in the form's own category
// dropdown (still editable from there), and scrolls the form into view.
import { useState, useRef } from "react";
import { ContactUsForm } from "@/components/ContactUsForm";

const CARDS: { value: string; label: string; body: string }[] = [
  { value: "associate", label: "Join us as Associate", body: "Work alongside the research and engineering practice building VERIDIAN's products." },
  { value: "sales_partner", label: "Join us as Sales Partner & Resellers", body: "Bring VERIDIAN to your network — one partner programme across the whole portfolio." },
  { value: "ai_researcher", label: "Join us as AI Researcher", body: "Contribute to the cognitive research behind layered reasoning, purpose-bound agents, and capability memory." },
];

export function JoinUsSection() {
  const [category, setCategory] = useState<string | undefined>(undefined);
  const formRef = useRef<HTMLDivElement>(null);

  function pick(value: string) {
    setCategory(value);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        {CARDS.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => pick(c.value)}
            className={`group flex flex-col items-start rounded-2xl border px-6 py-6 text-left transition-colors ${
              category === c.value ? "border-[#1a1a17] bg-[#EDE9DC]" : "border-[#1a1a17]/15 bg-[#F9F7F0] hover:border-[#1a1a17]/40"
            }`}
          >
            <h3 className="font-heading text-lg text-[#1a1a17]">{c.label}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[#1a1a17]/70">{c.body}</p>
          </button>
        ))}
      </div>

      <div ref={formRef} className="mt-12">
        <ContactUsForm initialCategory={category} showCategoryPicker />
      </div>
    </>
  );
}
