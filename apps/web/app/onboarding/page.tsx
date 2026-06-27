"use client";
import { useState } from "react";
import { Button, Input, Select } from "@compliance/ui";
import { Check, ArrowRight, ArrowLeft, Building2, Users, ClipboardCheck, Sparkles } from "lucide-react";

const STEPS = [
  { id: 1, label: "Organisation", icon: Building2, description: "Set up your organisation" },
  { id: 2, label: "Team", icon: Users, description: "Invite your team members" },
  { id: 3, label: "Compliance", icon: ClipboardCheck, description: "Select compliance types" },
  { id: 4, label: "Done", icon: Sparkles, description: "You're all set!" },
];

const COMPLIANCE_TYPES = [
  { label: "IT Security", value: "it" },
  { label: "Tax Compliance", value: "tax" },
  { label: "Legal & Regulatory", value: "legal" },
  { label: "Operational", value: "operational" },
  { label: "Environmental", value: "environmental" },
  { label: "HR & Employment", value: "hr" },
  { label: "Financial", value: "finance" },
];

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [orgName, setOrgName] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [complete, setComplete] = useState(false);

  const toggleType = (value: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const canNext = () => {
    if (step === 1) return orgName.trim().length > 0;
    return true;
  };

  const handleNext = () => {
    if (step === 3) {
      setComplete(true);
      setStep(4);
    } else {
      setStep(step + 1);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFFDF9] flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        {/* Progress Bar */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-shrink-0">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  step >= s.id ? "bg-[#F5820A] text-white" : "bg-gray-200 text-gray-500"
                }`}>
                  {step > s.id ? <Check className="w-5 h-5" /> : s.id}
                </div>
                <span className="text-[10px] mt-1.5 text-gray-500 hidden sm:block">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 ${step > s.id ? "bg-[#F5820A]" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
          {step === 1 && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-[#FFF3E0] flex items-center justify-center mx-auto mb-4">
                  <Building2 className="w-8 h-8 text-[#F5820A]" />
                </div>
                <h2 className="text-xl font-bold text-gray-900" style={{ fontFamily: "var(--font-heading)" }}>What's your organisation called?</h2>
                <p className="text-sm text-gray-500 mt-1">This will appear in your dashboard and reports</p>
              </div>
              <Input
                label="Organisation Name"
                placeholder="e.g., Acme Corp"
                value={orgName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOrgName(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900" style={{ fontFamily: "var(--font-heading)" }}>Invite your team</h2>
                <p className="text-sm text-gray-500 mt-1">You can also invite members later from Settings</p>
              </div>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input placeholder="Email address" className="flex-1" />
                  <Button>Invite</Button>
                </div>
                <p className="text-xs text-gray-400 text-center">Skip for now — you can invite team members later</p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <ClipboardCheck className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900" style={{ fontFamily: "var(--font-heading)" }}>What do you need to track?</h2>
                <p className="text-sm text-gray-500 mt-1">Select the compliance types relevant to your organisation</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {COMPLIANCE_TYPES.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => toggleType(type.value)}
                    className={`p-3 rounded-xl border-2 text-sm text-left transition-colors ${
                      selectedTypes.has(type.value)
                        ? "border-[#F5820A] bg-[#FFF3E0] text-[#F5820A] font-medium"
                        : "border-gray-200 hover:border-gray-300 text-gray-700"
                    }`}
                  >
                    {selectedTypes.has(type.value) && <Check className="w-4 h-4 inline mr-1" />}
                    {type.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="text-center py-8">
              <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
                <Sparkles className="w-10 h-10 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "var(--font-heading)" }}>You're all set!</h2>
              <p className="text-gray-500 mt-2 mb-6">Your organisation <strong>{orgName}</strong> is ready.</p>
              <Button size="lg" onClick={() => { window.location.href = "/dashboard"; }}>
                Go to Dashboard <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {/* Navigation */}
          {step < 4 && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
              {step > 1 ? (
                <Button variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
              ) : <div />}
              <div className="flex gap-2">
                {step < 3 && <Button variant="outline" onClick={handleNext}>Skip</Button>}
                <Button onClick={handleNext} disabled={!canNext()}>
                  {step === 3 ? "Complete" : "Continue"} <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}