"use client"

import "./dpdp-onepage-tokens.css"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { RoleKind } from "@/lib/dpdp-onepage/view-model"

const ROLE_LABEL: Partial<Record<RoleKind, string>> = {
  go: "Grievance Officer",
  coord: "DPDP coordinator",
}

// WO-DPDP-010 §4 "First visit, for every role" -- the generic welcome screen
// for anyone named into a role who isn't the client owner (owner gets their
// own 3-step FirstVisitWizard instead). Two things only: say what they've
// been named, and give them an escape hatch if the org named the wrong
// person.
export function RoleWelcome({
  orgName, roleKind, jobCount, onAcknowledge, onNotMe,
}: {
  orgName: string
  roleKind: RoleKind
  jobCount: number
  onAcknowledge: () => Promise<void>
  onNotMe: () => Promise<void>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmingNotMe, setConfirmingNotMe] = useState(false)
  const roleLabel = ROLE_LABEL[roleKind]

  function runAndRefresh(action: () => Promise<void>) {
    startTransition(async () => {
      await action()
      router.refresh()
    })
  }

  return (
    <div className="dpdp-onepage">
      <div className="max-w-[760px] mx-auto px-5 py-14">
        <div className="rounded-[22px] border p-8 text-center" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>👋</div>
          <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 26, fontWeight: 700, margin: "0 0 8px", color: "var(--dpdp-ink)" }}>
            Welcome to VERIDIAN
          </h1>
          <p style={{ fontSize: 15.5, color: "var(--dpdp-ink2)", margin: "0 auto 22px", maxWidth: "48ch" }}>
            <b>{orgName}</b> named you {roleLabel ? <>as their <b>{roleLabel}</b></> : "as someone who looks after some of their DPDP jobs"}
            {jobCount > 0 ? (
              <> — you have <b>{jobCount} job{jobCount === 1 ? "" : "s"}</b> of your own.</>
            ) : (
              <>.</>
            )}
          </p>
          {!confirmingNotMe ? (
            <div className="flex gap-2.5 items-center justify-center flex-wrap">
              <button
                type="button"
                disabled={pending}
                onClick={() => runAndRefresh(onAcknowledge)}
                className="font-bold text-white"
                style={{ background: "var(--dpdp-v)", fontSize: 15, padding: "13px 22px", borderRadius: 14, opacity: pending ? 0.6 : 1 }}
              >
                Got it — show me my jobs
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmingNotMe(true)}
                style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, padding: "13px 10px", textDecoration: "underline" }}
              >
                This isn&rsquo;t me
              </button>
            </div>
          ) : (
            <div className="rounded-2xl p-4" style={{ background: "var(--dpdp-rL)", border: "1px solid #FBC5CF" }}>
              <p style={{ fontSize: 14, margin: "0 0 12px", color: "var(--dpdp-ink)" }}>
                We&rsquo;ll tell the owner this needs reassigning, and won&rsquo;t show your name on these jobs as done.
              </p>
              <div className="flex gap-2.5 items-center justify-center flex-wrap">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => runAndRefresh(onNotMe)}
                  className="font-bold text-white"
                  style={{ background: "var(--dpdp-r)", fontSize: 14, padding: "11px 18px", borderRadius: 12, opacity: pending ? 0.6 : 1 }}
                >
                  Yes, tell the owner
                </button>
                <button type="button" disabled={pending} onClick={() => setConfirmingNotMe(false)} style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, padding: "11px 10px" }}>
                  Never mind
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
