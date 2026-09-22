"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { dpdpFetch } from "../../_lib/api"

type NavItem = { href: string; label: string }
type NavGroup = { label: string; items: NavItem[] }

// WO-DPDP-003 Section 5.1: "Sidebar order starts: Dashboard → 🛡️ Proof → …"
// and per-capability navigation (advisor/fiduciary/processor/auditor), not
// one unified fiduciary-style menu. `capabilities` is an org's set (an org
// can hold more than one, e.g. a CA firm that also processes for a
// client), so groups add per capability rather than picking one branch.
function navFor(level: "owner" | "staff", capabilities: string[], caClientCount: number): NavGroup[] {
  const isAdvisor = capabilities.includes("advisor")
  const isProcessor = capabilities.includes("processor")
  const isAuditor = capabilities.includes("auditor")

  const groups: NavGroup[] = [
    { label: "Start here", items: [{ href: "/dpdp/home", label: "Home" }, { href: "/dpdp/proof", label: "🛡️ Proof" }, { href: "/dpdp/lifecycle", label: "Where we are" }] },
  ]

  // WO-DPDP-010 §3 "CA firm view": shown for ANY identity named CA manager/
  // partner on at least one client org, regardless of their level/
  // capabilities in the CURRENT org -- this is a cross-org fact about the
  // person, not something the current org's own nav config could know.
  if (caClientCount > 0) {
    groups.push({ label: "CA firm", items: [{ href: "/dpdp/ca-clients", label: `🧾 My clients (${caClientCount})` }] })
  }

  if (level === "owner") {
    groups.push({
      label: isAdvisor ? "Our practice" : "Our fiduciary duties",
      items: [
        { href: "/dpdp/data-map", label: "Where our data is" },
        { href: isAdvisor ? "/dpdp/people?as=team" : "/dpdp/people", label: isAdvisor ? "Our people" : "Our people" },
        { href: "/dpdp/relationships", label: "Outside firms" },
      ],
    })
    groups.push({
      label: "Telling people",
      items: [
        { href: "/dpdp/grievance-officer", label: "Grievance Officer" },
        { href: "/dpdp/public-page", label: "Our public page" },
        { href: "/dpdp/notices", label: "Our notices" },
      ],
    })
    groups.push({
      label: "People who ask us things",
      items: [
        { href: "/dpdp/consent", label: "Asking for consent" },
        { href: "/dpdp/rights-requests", label: "Requests from people" },
        { href: "/dpdp/grievances", label: "Complaints" },
        { href: "/dpdp/breach", label: "If data leaks" },
      ],
    })
    groups.push({ label: "The to-do list", items: [{ href: "/dpdp/obligations", label: "Everyone's jobs" }, { href: "/dpdp/review", label: "Things to check" }, { href: "/dpdp/exposure", label: "Work out what you hold" }] })
    groups.push({ label: "Finishing", items: [{ href: "/dpdp/attest", label: "✍️ Confirm and sign off" }] })
  } else {
    groups.push({ label: "My jobs", items: [{ href: "/dpdp/obligations?mine=1", label: "My jobs" }, { href: "/dpdp/mydata", label: "What you hold about me" }] })
  }

  if (isAdvisor || isProcessor || isAuditor) {
    groups.push({
      label: isAuditor ? "Audits" : "Who we work for",
      items: [{ href: "/dpdp/relationships?as=served", label: isAuditor ? "What we're auditing" : "Who we work for" }],
    })
  }
  if (isAuditor) {
    groups.push({ label: "Independence", items: [{ href: "/dpdp/access-log", label: "👁️ Who looked at what" }] })
  }

  groups.push({
    label: "Always",
    items: [
      { href: "/dpdp/record", label: "Everything that happened" },
      { href: "/dpdp/ai-link", label: "🤖 AI Link" },
      { href: "/dpdp/outbox", label: "Emails sent" },
      { href: "/dpdp/edge", label: "If something goes wrong" },
      { href: "/dpdp/refer", label: "🎁 Refer and earn" },
    ],
  })
  return groups
}

export function DpdpShell({ orgName, level, capabilities, caClientCount = 0, children }: { orgName: string; level: "owner" | "staff"; capabilities: string[]; caClientCount?: number; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const groups = navFor(level, capabilities, caClientCount)

  async function logout() {
    await dpdpFetch("/api/dpdp/auth/logout", { method: "POST" })
    router.push("/dpdp/login")
  }

  return (
    <div className="min-h-screen bg-[#F8F6FF]">
      <div className="bg-gradient-to-r from-[#6D28D9] via-[#9333EA] to-[#DB2777] text-white px-4 py-3 flex items-center justify-between">
        <div className="font-extrabold tracking-tight">VERIDIAN</div>
        <div className="flex items-center gap-3 text-sm">
          <span className="opacity-90">{orgName} · {level === "owner" ? "👑 Boss" : "👤 Staff"}</span>
          <button onClick={logout} className="bg-white/20 hover:bg-white/30 rounded-full px-3 py-1 text-xs font-semibold">Sign out</button>
        </div>
      </div>
      <div className="grid grid-cols-[220px_1fr] min-h-[calc(100vh-52px)]">
        <nav className="bg-white border-r border-[#E6E2F5] p-2">
          {groups.map((g) => (
            <div key={g.label} className="mb-3">
              <div className="text-[10px] font-bold tracking-wider uppercase text-[#8E86AD] px-2 py-1">{g.label}</div>
              {g.items.map((item) => {
                const active = pathname === item.href.split("?")[0]
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block text-sm rounded-lg px-3 py-2 mb-0.5 ${active ? "bg-gradient-to-r from-[#6D28D9] to-[#9333EA] text-white font-semibold" : "text-[#564D77] hover:bg-[#F2ECFF]"}`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
        <main className="p-6 max-w-4xl">{children}</main>
      </div>
      <Link
        href="/dpdp/partner"
        className="fixed left-3 bottom-3 bg-white border border-[#E6E2F5] rounded-full px-3 py-1.5 text-xs font-semibold text-[#564D77] shadow-sm hover:bg-[#F2ECFF]"
      >
        Partner programme
      </Link>
    </div>
  )
}
