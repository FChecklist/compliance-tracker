"use client";

// Shared Contact Us form -- used standalone on /contact (general inquiry,
// replaces the old "Sign in" CTA) and embedded on /join-us (with a
// pre-selected category from one of the three "Join us as..." cards). Every
// keystroke pause autosaves a draft via /api/contact/draft (visitor_id-keyed,
// so nothing is lost even if the visitor never submits) -- final submit goes
// through /api/contact/submit and swaps in a thank-you state.

import { useEffect, useRef, useState } from "react";
import { getVisitorId } from "@/lib/visitor-id";

const CATEGORY_LABELS: Record<string, string> = {
  associate: "Join us as Associate",
  sales_partner: "Join us as Sales Partner & Resellers",
  ai_researcher: "Join us as AI Researcher",
};

export function ContactUsForm({
  heading = "Contact Us",
  initialCategory,
  showCategoryPicker = false,
}: {
  heading?: string;
  initialCategory?: string;
  showCategoryPicker?: boolean;
}) {
  const [category, setCategory] = useState(initialCategory ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (initialCategory) setCategory(initialCategory);
  }, [initialCategory]);

  // Debounced autosave -- fires ~1.5s after the visitor stops typing, and
  // only once they've actually touched a field (no autosave of an empty form).
  useEffect(() => {
    if (!dirtyRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const payload = JSON.stringify({ visitorId: getVisitorId(), category: category || undefined, name, email, mobile, message });
      fetch("/api/contact/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
    }, 1500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [category, name, email, mobile, message]);

  function markDirty() {
    dirtyRef.current = true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/contact/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId: getVisitorId(), category: category || undefined, name, email, mobile, message }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
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
      <div className="rounded-2xl border border-[#1a1a17]/15 bg-[#F9F7F0] px-8 py-12 text-center">
        <h3 className="font-heading text-2xl text-[#1a1a17]">Thank you</h3>
        <p className="mx-auto mt-4 max-w-md leading-relaxed text-[#1a1a17]/70">
          We&apos;ve received your message. Please check your email — including your spam folder — and
          confirm your address so we can get back to you.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#1a1a17]/15 bg-[#F9F7F0] px-8 py-10">
      <h3 className="font-heading text-2xl text-[#1a1a17]">{heading}</h3>

      {showCategoryPicker && (
        <div className="mt-6">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1a1a17]/50">I&apos;m interested in</label>
          <select
            value={category}
            onChange={(e) => { markDirty(); setCategory(e.target.value); }}
            className="mt-2 w-full rounded-lg border border-[#1a1a17]/20 bg-white px-4 py-2.5 text-sm text-[#1a1a17] focus:outline-none focus:ring-2 focus:ring-[#1a1a17]/20"
          >
            <option value="">General inquiry</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1a1a17]/50">Name</label>
            <input
              required
              value={name}
              onChange={(e) => { markDirty(); setName(e.target.value); }}
              className="mt-2 w-full rounded-lg border border-[#1a1a17]/20 bg-white px-4 py-2.5 text-sm text-[#1a1a17] focus:outline-none focus:ring-2 focus:ring-[#1a1a17]/20"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1a1a17]/50">Email</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => { markDirty(); setEmail(e.target.value); }}
              className="mt-2 w-full rounded-lg border border-[#1a1a17]/20 bg-white px-4 py-2.5 text-sm text-[#1a1a17] focus:outline-none focus:ring-2 focus:ring-[#1a1a17]/20"
              placeholder="you@company.com"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1a1a17]/50">Mobile number</label>
          <input
            type="tel"
            value={mobile}
            onChange={(e) => { markDirty(); setMobile(e.target.value); }}
            className="mt-2 w-full rounded-lg border border-[#1a1a17]/20 bg-white px-4 py-2.5 text-sm text-[#1a1a17] focus:outline-none focus:ring-2 focus:ring-[#1a1a17]/20"
            placeholder="+91 9XXXXXXXXX"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1a1a17]/50">Message (optional)</label>
          <textarea
            value={message}
            onChange={(e) => { markDirty(); setMessage(e.target.value); }}
            rows={4}
            className="mt-2 w-full rounded-lg border border-[#1a1a17]/20 bg-white px-4 py-2.5 text-sm text-[#1a1a17] focus:outline-none focus:ring-2 focus:ring-[#1a1a17]/20"
            placeholder="Tell us a little more..."
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-fit items-center gap-2 rounded-full bg-[#1a1a17] px-7 py-3 text-sm font-medium text-[#F4F1E8] disabled:opacity-50"
        >
          {submitting ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
}
