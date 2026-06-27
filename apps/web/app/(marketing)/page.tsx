import Link from "next/link";

const FEATURES = [
  {
    title: "Never Miss a Deadline",
    description: "Automated deadline tracking with WhatsApp and email reminders. Your entire compliance calendar in one place.",
  },
  {
    title: "Multi-Tenant SaaS",
    description: "Manage compliance for multiple organisations from a single portal. Perfect for CA firms and audit practices.",
  },
  {
    title: "AI-Powered Insights",
    description: "Get intelligent suggestions for compliance actions, risk assessments, and deadline predictions powered by Claude AI.",
  },
];

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <h1 className="text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
          Compliance<span className="text-blue-600">Track</span>
        </h1>
        <p className="text-xl text-gray-500 max-w-xl mx-auto mb-8">
          One Portal. One Truth.
        </p>
        <p className="text-gray-600 max-w-2xl mx-auto mb-10">
          The compliance management platform for organisations of all sizes. Track every type of compliance — IT, tax, legal, regulatory, operational, and environmental — from a single portal.
        </p>
        <Link
          href="/register"
          className="inline-block bg-blue-600 text-white px-8 py-3 rounded-xl text-lg font-semibold hover:bg-blue-700 transition"
        >
          Get Started Free
        </Link>
      </section>

      {/* Features */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Why ComplianceTrack?
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-sm text-gray-400">
          ComplianceTrack &copy; {new Date().getFullYear()}. All rights reserved.
        </div>
      </footer>
    </div>
  );
}