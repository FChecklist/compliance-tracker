"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const STEPS = [
  { id: 1, title: "Organisation Profile", required: true, desc: "Set up your organisation details" },
  { id: 2, title: "Add Departments", required: true, desc: "Create at least one department" },
  { id: 3, title: "Invite Users", required: false, desc: "Add team members (optional)" },
  { id: 4, title: "Compliance Categories", required: true, desc: "Choose compliance types to track" },
  { id: 5, title: "AI Library", required: false, desc: "Generate compliance library with AI (optional)" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  async function advance(skip = false) {
    setLoading(true);
    await fetch("/api/onboarding/complete-step", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, skip_ai: step === 5 ? skip : undefined }),
    });
    if (step >= 5) { router.push("/dashboard"); return; }
    setStep(s => s + 1);
    setLoading(false);
  }

  const current = STEPS[step - 1];
  const progress = ((step - 1) / 5) * 100;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="h-2 bg-gray-100"><div className="h-2 bg-blue-600 transition-all" style={{width:`${progress}%`}}/></div>
        <div className="p-8">
          <div className="flex items-center gap-2 mb-6">
            {STEPS.map(s => (
              <div key={s.id} className={`flex-1 h-1 rounded ${s.id <= step ? "bg-blue-600" : "bg-gray-200"}`} />
            ))}
          </div>
          <p className="text-sm text-blue-600 font-medium mb-1">Step {step} of 5</p>
          <h2 className="text-xl font-bold text-gray-900 mb-1">{current.title}</h2>
          <p className="text-sm text-gray-500 mb-8">{current.desc}</p>
          <div className="bg-gray-50 rounded-xl p-6 mb-8 min-h-24 flex items-center justify-center text-gray-400 text-sm">
            {current.title} form fields will be rendered here
          </div>
          <div className="flex gap-3">
            {!current.required && (
              <button onClick={() => advance(true)} disabled={loading} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
                Skip
              </button>
            )}
            <button onClick={() => advance(false)} disabled={loading} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading ? "Saving..." : step === 5 ? "Complete Setup" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}