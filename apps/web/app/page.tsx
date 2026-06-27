import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#FFFDF9]">
      {/* Nav */}
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-[#1C2B3A] flex items-center justify-center">
              <ShieldIcon className="w-5 h-5 text-[#F5820A]" />
            </div>
            <span className="font-bold text-[#1C2B3A] text-lg">ComplianceTrack</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-gray-600">
            <a href="#features" className="hover:text-gray-900">Features</a>
            <a href="#pricing" className="hover:text-gray-900">Pricing</a>
            <a href="#" className="hover:text-gray-900">Docs</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">Log in</Link>
            <Link href="/register" className="text-sm font-medium bg-[#1C2B3A] text-white px-5 py-2.5 rounded-lg hover:bg-[#1C2B3A]/90 transition-colors">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FFF3E0] text-[#F5820A] text-xs font-medium mb-6">
            One Portal. One Truth.
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-[#1C2B3A] leading-tight mb-6" style={{ fontFamily: "var(--font-heading, Georgia, serif)" }}>
            Compliance Management<br />
            <span className="text-[#F5820A]">for the AI Era</span>
          </h1>
          <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
            Track, manage, and automate compliance across your entire organisation. Built for accountants, auditors, and compliance officers.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/register" className="bg-[#F5820A] text-white px-8 py-3.5 rounded-lg font-medium hover:bg-[#F5820A]/90 transition-colors text-base">
              Start Free Trial
            </Link>
            <a href="#features" className="border border-gray-300 text-gray-700 px-8 py-3.5 rounded-lg font-medium hover:bg-gray-50 transition-colors text-base">
              See How It Works
            </a>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="bg-[#1C2B3A] py-10">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: "10,000+", label: "Compliance Items Tracked" },
            { value: "99.9%", label: "Uptime SLA" },
            { value: "18", label: "Compliance Modules" },
            { value: "69+", label: "API Endpoints" },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-3xl font-bold text-[#F5820A]">{stat.value}</p>
              <p className="text-sm text-gray-400 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-[#1C2B3A]" style={{ fontFamily: "var(--font-heading, Georgia, serif)" }}>Everything You Need</h2>
          <p className="text-gray-500 mt-2">One platform to manage all your compliance requirements</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { icon: "📋", title: "Compliance Engine", desc: "Full CRUD with 8 status types, priority levels, and smart filtering across all departments." },
            { icon: "🔍", title: "Audit Points", desc: "Break down compliance into verifiable checkpoints with evidence tracking." },
            { icon: "📊", title: "Pendency View", desc: "8-bucket pendency tracking from delayed to 365+ days with visual breakdowns." },
            { icon: "🤖", title: "AI Assistant", desc: "Powered by Claude AI — get summaries, recommendations, and generate checklists." },
            { icon: "👥", title: "Multi-Tenancy & RBAC", desc: "4-tier role system: Account Admin, Dept Admin, Editor, Viewer with full permission scoping." },
            { icon: "📱", title: "Mobile App", desc: "Capture documents on-the-go, get push notifications, and manage tasks from anywhere." },
            { icon: "📧", title: "Smart Notifications", desc: "Deadline reminders, assignment alerts, and status change notifications via email and in-app." },
            { icon: "🔗", title: "Integrations", desc: "Export to CSV/Excel/PDF, WhatsApp triggers, Google Drive, webhooks, and API tokens." },
            { icon: "🏛️", title: "Audit Trail", desc: "Complete audit log with IP tracking, machine ID, and immutable history of all actions." },
          ].map((feature) => (
            <div key={feature.title} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
              <span className="text-3xl">{feature.icon}</span>
              <h3 className="text-lg font-semibold text-gray-900 mt-4 mb-2">{feature.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-gray-50 py-20">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-[#1C2B3A]" style={{ fontFamily: "var(--font-heading, Georgia, serif)" }}>Simple, Transparent Pricing</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl border border-gray-200 p-8">
              <h3 className="text-lg font-bold text-gray-900">Single Entity</h3>
              <p className="text-sm text-gray-500 mt-1">For individual organisations</p>
              <div className="mt-6">
                <span className="text-4xl font-bold text-[#1C2B3A]">₹30,000</span>
                <span className="text-gray-500 text-sm">/one-time</span>
              </div>
              <ul className="mt-6 space-y-3 text-sm text-gray-600">
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-500" /> Unlimited compliance items</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-500" /> Up to 10 users</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-500" /> All 18 modules</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-500" /> Email support</li>
              </ul>
              <Link href="/register" className="mt-8 block text-center bg-[#1C2B3A] text-white py-3 rounded-lg font-medium hover:bg-[#1C2B3A]/90">
                Get Started
              </Link>
            </div>
            <div className="bg-[#1C2B3A] rounded-2xl p-8 text-white relative">
              <div className="absolute -top-3 right-6 bg-[#F5820A] text-white text-xs font-bold px-3 py-1 rounded-full">Popular</div>
              <h3 className="text-lg font-bold">Multi-Client</h3>
              <p className="text-sm text-gray-400 mt-1">For firms managing multiple clients</p>
              <div className="mt-6">
                <span className="text-4xl font-bold">₹30,000</span>
                <span className="text-gray-400 text-sm"> + ₹3,000/client</span>
              </div>
              <ul className="mt-6 space-y-3 text-sm text-gray-300">
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-[#F5820A]" /> Everything in Single Entity</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-[#F5820A]" /> Unlimited clients</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-[#F5820A]" /> Agent portal + commissions</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-[#F5820A]" /> Priority support + onboarding</li>
              </ul>
              <Link href="/register" className="mt-8 block text-center bg-[#F5820A] text-white py-3 rounded-lg font-medium hover:bg-[#F5820A]/90">
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="bg-[#1C2B3A] rounded-2xl p-12 text-center">
          <h2 className="text-3xl font-bold text-white" style={{ fontFamily: "var(--font-heading, Georgia, serif)" }}>Ready to streamline your compliance?</h2>
          <p className="text-gray-400 mt-3 mb-8">Join thousands of organisations managing compliance with ComplianceTrack.</p>
          <Link href="/register" className="inline-block bg-[#F5820A] text-white px-8 py-3.5 rounded-lg font-medium hover:bg-[#F5820A]/90 transition-colors">
            Start Your Free Trial →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500">© 2025 ComplianceTrack. All rights reserved.</p>
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <a href="#" className="hover:text-gray-900">Privacy</a>
            <a href="#" className="hover:text-gray-900">Terms</a>
            <a href="#" className="hover:text-gray-900">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function CheckCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}