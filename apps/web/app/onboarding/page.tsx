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

const COMPLIANCE_TYPES = [
  { value: "it", label: "IT Compliance" },
  { value: "tax", label: "Tax Compliance" },
  { value: "legal", label: "Legal Compliance" },
  { value: "regulatory", label: "Regulatory Compliance" },
  { value: "operational", label: "Operational Compliance" },
  { value: "environmental", label: "Environmental Compliance" },
  { value: "hr", label: "HR / Labour Law" },
  { value: "finance", label: "Finance Compliance" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1 state
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState("single_entity");
  const [financialYear, setFinancialYear] = useState("apr");
  const [timezone, setTimezone] = useState("Asia/Kolkata");

  // Step 2 state
  const [departments, setDepartments] = useState([{ name: "", head: "" }]);
  const [newDept, setNewDept] = useState("");

  // Step 3 state
  const [invites, setInvites] = useState([{ email: "", role: "viewer" }]);

  // Step 4 state
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data?.organisation?.name) setOrgName(data.organisation.name);
      })
      .catch(() => {});
  }, []);

  async function advance(skip = false) {
    setLoading(true);
    try {
      const body: Record<string, unknown> = { step };
      if (skip) body.skip_ai = true;
      if (step === 1) body.org_data = { name: orgName, plan_type: orgType, financial_year_start: financialYear, timezone };
      if (step === 2) body.departments = departments.filter((d) => d.name.trim());
      if (step === 3) body.invites = invites.filter((i) => i.email.trim());
      if (step === 4) body.compliance_types = selectedTypes;

      await fetch("/api/onboarding/complete-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (step >= 5) {
        router.push("/dashboard");
        return;
      }
      setStep((s) => s + 1);
    } catch (err) {
      console.error("Onboarding step failed:", err);
    } finally {
      setLoading(false);
    }
  }

  function toggleType(type: string) {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  const current = STEPS[step - 1];
  const progress = ((step - 1) / 5) * 100;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg overflow-hidden">
        {/* Progress bar */}
        <div className="h-2 bg-gray-100">
          <div className="h-2 bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
        </div>

        <div className="p-8">
          {/* Step indicators */}
          <div className="flex items-center gap-2 mb-6">
            {STEPS.map((s) => (
              <div key={s.id} className={`flex-1 h-1 rounded ${s.id <= step ? "bg-blue-600" : "bg-gray-200"}`} />
            ))}
          </div>
          <p className="text-sm text-blue-600 font-medium mb-1">Step {step} of 5</p>
          <h2 className="text-xl font-bold text-gray-900 mb-1">{current.title}</h2>
          <p className="text-sm text-gray-500 mb-8">{current.desc}</p>

          {/* Step 1: Organisation Profile */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Organisation Name</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Organisation Type</label>
                <select
                  value={orgType}
                  onChange={(e) => setOrgType(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="single_entity">Single Entity</option>
                  <option value="multi_client">Multi-Client (CA / Audit Firm)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Financial Year Starts</label>
                <select
                  value={financialYear}
                  onChange={(e) => setFinancialYear(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="apr">April (India)</option>
                  <option value="jan">January</option>
                  <option value="jul">July</option>
                  <option value="oct">October</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">America/New_York (EST)</option>
                  <option value="America/Chicago">America/Chicago (CST)</option>
                  <option value="Europe/London">Europe/London (GMT)</option>
                  <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                  <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                </select>
              </div>
            </div>
          )}

          {/* Step 2: Departments */}
          {step === 2 && (
            <div className="space-y-4">
              {departments.map((dept, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="text"
                    value={dept.name}
                    onChange={(e) => {
                      const d = [...departments];
                      d[idx].name = e.target.value;
                      setDepartments(d);
                    }}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Department name"
                  />
                  <input
                    type="text"
                    value={dept.head}
                    onChange={(e) => {
                      const d = [...departments];
                      d[idx].head = e.target.value;
                      setDepartments(d);
                    }}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Head name (optional)"
                  />
                  {departments.length > 1 && (
                    <button
                      onClick={() => setDepartments(departments.filter((_, i) => i !== idx))}
                      className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newDept.trim()) {
                      setDepartments([...departments, { name: newDept.trim(), head: "" }]);
                      setNewDept("");
                    }
                  }}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="New department name"
                />
                <button
                  onClick={() => {
                    if (newDept.trim()) {
                      setDepartments([...departments, { name: newDept.trim(), head: "" }]);
                      setNewDept("");
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Invite Users */}
          {step === 3 && (
            <div className="space-y-4">
              {invites.map((inv, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="email"
                    value={inv.email}
                    onChange={(e) => {
                      const d = [...invites];
                      d[idx].email = e.target.value;
                      setInvites(d);
                    }}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="colleague@company.com"
                  />
                  <select
                    value={inv.role}
                    onChange={(e) => {
                      const d = [...invites];
                      d[idx].role = e.target.value;
                      setInvites(d);
                    }}
                    className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="client_department_admin">Dept Admin</option>
                  </select>
                  {invites.length > 1 && (
                    <button
                      onClick={() => setInvites(invites.filter((_, i) => i !== idx))}
                      className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setInvites([...invites, { email: "", role: "viewer" }])}
                className="w-full border border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-500 hover:bg-gray-50 hover:border-gray-400"
              >
                + Add Another Invite
              </button>
            </div>
          )}

          {/* Step 4: Compliance Categories */}
          {step === 4 && (
            <div className="grid grid-cols-2 gap-3">
              {COMPLIANCE_TYPES.map((ct) => {
                const selected = selectedTypes.includes(ct.value);
                return (
                  <button
                    key={ct.value}
                    onClick={() => toggleType(ct.value)}
                    className={`p-3 rounded-xl border-2 text-left text-sm transition-all ${
                      selected
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-gray-200 hover:border-gray-300 text-gray-600"
                    }`}
                  >
                    <span className="font-medium">{ct.label}</span>
                    {selected && <span className="block text-xs mt-1 text-blue-500">Selected</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Step 5: AI Library */}
          {step === 5 && (
            <div className="text-center space-y-4">
              <div className="text-5xl mb-4">&#129302;</div>
              <h3 className="text-lg font-semibold text-gray-900">AI-Powered Compliance Library</h3>
              <p className="text-sm text-gray-500">
                Let our AI generate a pre-built compliance library based on your selected categories
                and organisation type. This saves hours of manual setup.
              </p>
              <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-700">
                {selectedTypes.length} categories selected. AI will generate relevant compliance items.
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 mt-8">
            {!current.required && (
              <button
                onClick={() => advance(true)}
                disabled={loading}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Skip
              </button>
            )}
            <button
              onClick={() => advance(false)}
              disabled={loading || (step === 1 && !orgName.trim()) || (step === 2 && !departments.some((d) => d.name.trim())) || (step === 4 && selectedTypes.length === 0)}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Saving..." : step === 5 ? "Complete Setup" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}