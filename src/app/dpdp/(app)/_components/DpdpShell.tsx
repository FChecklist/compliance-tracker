"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { dpdpFetch } from "../../_lib/api"

type NavItem = { href: string; label: string }
type NavGroup = { label: string; items: NavItem[] }

function navFor(level: "owner" | "staff", capabilities: string[]): NavGroup[] {
  const groups: NavGroup[] = [
    { label: "Start here", items: [{ href: "/dpdp/home", label: "Home" }, { href: "/dpdp/lifecycle", label: "Where we are" }] },
  ]

  if (level === "owner") {
    groups.push({
      label: "Our practice",
      items: [
        { href: "/dpdp/data-map", label: "Where our data is" },
        { href: "/dpdp/people", label: "Our people" },
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
  } else {
    groups.push({ label: "My jobs", items: [{ href: "/dpdp/obligations?mine=1", label: "My jobs" }] })
  }

  if (capabilities.includes("processor") || capabilities.includes("auditor") || capabilities.includes("advisor")) {
    groups.push({ label: "Who we work for", items: [{ href: "/dpdp/relationships?as=served", label: "Who we work for" }] })
  }

  groups.push({ label: "Always", items: [{ href: "/dpdp/record", label: "Everything that happened" }] })
  return groups
}

export function DpdpShell({ orgName, level, capabilities, children }: { orgName: string; level: "owner" | "staff"; capabilities: string[]; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const groups = navFor(level, capabilities)

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
    </div>
  )
}
