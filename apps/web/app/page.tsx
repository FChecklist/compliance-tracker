import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">CT</span>
          </div>
          <span className="text-xl font-bold text-slate-900">ComplianceTrack</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm text-slate-600">
          <a href="#features" className="hover:text-blue-600 transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-blue-600 transition-colors">How It Works</a>
          <a href="#pricing" className="hover:text-blue-600 transition-colors">Pricing</a>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm font-medium text-slate-700 hover:text-blue-600 transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
          >
            Get Started Free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 py-20 md:py-32 text-center max-w-4xl mx-auto">
        <div className="inline-block px-3 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full mb-6">
          Trusted by 500+ Compliance Professionals
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold text-slate-900 leading-tight mb-6">
          One Portal. One Truth.
          <br />
          <span className="text-blue-600">Every Compliance Deadline.</span>
        </h1>
        <p className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto mb-10">
          Manage IT, tax, legal, regulatory, operational, and environmental compliance
          from a single dashboard. Never miss a deadline again.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/register"
            className="w-full sm:w-auto text-center px-8 py-3 text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-lg shadow-blue-200 transition-all"
          >
            Start Free Trial
          </Link>
          <Link
            href="#features"
            className="w-full sm:w-auto text-center px-8 py-3 text-base font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all"
          >
            See Features
          </Link>
        </div>
      </section>

      {/* Trust Bar */}
      <section className="px-6 py-10 border-y border-slate-100 bg-white">
        <p className="text-center text-sm text-slate-400 mb-6">
          Built for Chartered Accountants, Audit Firms, CFOs, and Compliance Officers
        </p>
        <div className="flex flex-wrap justify-center gap-8 text-slate-300">
          {["TDS", "GST", "ROC", "SEBI", "RBI", "IT Act", "Labour Law", "Environmental"].map((item) => (
            <span key={item} className="text-sm font-semibold text-slate-400">{item}</span>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-6 py-20 max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center text-slate-900 mb-4">
          Everything You Need
        </h2>
        <p className="text-center text-slate-500 mb-14 max-w-2xl mx-auto">
          18 modules, 69 API endpoints, one unified platform for complete compliance management.
        </p>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              icon: "📋",
              title: "Multi-Type Compliance",
              description: "IT, tax, legal, regulatory, operational, environmental — track every compliance type in one place with unified workflows.",
            },
            {
              icon: "👥",
              title: "Multi-Tenant SaaS",
              description: "Manage multiple client organisations from a single portal. Perfect for CA firms and audit companies handling many clients.",
            },
            {
              icon: "🔔",
              title: "Smart Notifications",
              description: "Email, WhatsApp, and in-app reminders. Never miss a deadline with escalation alerts and pendency bucket tracking.",
            },
            {
              icon: "📊",
              title: "Dashboard & Analytics",
              description: "Real-time dashboards with compliance status breakdowns, pendency views, department-wise analytics, and exportable reports.",
            },
            {
              icon: "🤖",
              title: "AI-Powered Insights",
              description: "Claude AI integration for compliance descriptions, risk assessments, and intelligent recommendations to speed up your workflow.",
            },
            {
              icon: "📱",
              title: "Web + Mobile",
              description: "Full-featured web app and React Native mobile app. Capture documents on the go, quick-add compliance items from your phone.",
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="p-6 rounded-2xl border border-slate-100 bg-white hover:shadow-lg hover:border-blue-100 transition-all"
            >
              <div className="text-3xl mb-4">{feature.icon}</div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">{feature.title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="px-6 py-20 bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-14">Get Started in 3 Steps</h2>
          <div className="grid md:grid-cols-3 gap-10">
            {[
              { step: "01", title: "Create Your Account", desc: "Sign up, set up your organisation profile, and invite your team members in under 5 minutes." },
              { step: "02", title: "Add Compliance Items", desc: "Create compliance tasks manually or import them. Assign to departments and team members with deadlines." },
              { step: "03", title: "Track & Never Miss", desc: "Dashboard gives you full visibility. Automated reminders ensure every deadline is met, every time." },
            ].map((item) => (
              <div key={item.step}>
                <div className="text-5xl font-extrabold text-blue-400 mb-3">{item.step}</div>
                <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-slate-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 py-20 max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center text-slate-900 mb-4">Simple Pricing</h2>
        <p className="text-center text-slate-500 mb-14">Start free. Upgrade when you are ready.</p>
        <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {[
            {
              name: "Single Entity",
              price: "Free",
              desc: "For individual organisations managing their own compliance.",
              features: ["Up to 50 compliance items", "1 organisation", "Dashboard & analytics", "Email notifications"],
              cta: "Get Started",
              highlight: false,
            },
            {
              name: "Multi-Client",
              price: "Contact Us",
              desc: "For CA firms, audit firms, and compliance service providers.",
              features: ["Unlimited compliance items", "Unlimited client organisations", "WhatsApp notifications", "AI-powered insights", "API access & webhooks", "Priority support"],
              cta: "Contact Sales",
              highlight: true,
            },
          ].map((plan) => (
            <div
              key={plan.name}
              className={`p-8 rounded-2xl border-2 ${
                plan.highlight
                  ? "border-blue-600 bg-blue-50/50 shadow-xl"
                  : "border-slate-200 bg-white"
              }`}
            >
              <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
              <div className="mt-2 mb-4">
                <span className="text-3xl font-extrabold text-slate-900">{plan.price}</span>
              </div>
              <p className="text-sm text-slate-500 mb-6">{plan.desc}</p>
              <ul className="space-y-3 mb-8">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="text-green-500">&#10003;</span> {f}
                  </li>
                ))}
              </ul>
              <Link
                href={plan.highlight ? "/register" : "/register"}
                className={`block text-center px-6 py-3 rounded-xl text-sm font-semibold transition-colors ${
                  plan.highlight
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-10 border-t border-slate-100 bg-white text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
            <span className="text-white font-bold text-xs">CT</span>
          </div>
          <span className="font-semibold text-slate-900">ComplianceTrack</span>
        </div>
        <p className="text-sm text-slate-400">
          &copy; {new Date().getFullYear()} ComplianceTrack. All rights reserved.
        </p>
      </footer>
    </div>
  );
}