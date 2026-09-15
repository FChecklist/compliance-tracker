"use client"

import { use, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { dpdpFetch } from "../../_lib/api"

type NoticeCtx = { notice: { docKind: string; version: string; languages: string[] } | null; orgId: string; actedAt: string | null }

const PURPOSES = [
  { key: "order", label: "Taking and delivering my orders", note: "we cannot serve you without this", required: true },
  { key: "offers", label: "Sending me offers and new products", note: "entirely up to you", required: false },
  { key: "share", label: "Sharing with delivery partners outside our usual area", note: "only if you say so", required: false },
]

export default function PrincipalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [ctx, setCtx] = useState<NoticeCtx | null>(null)
  const [step, setStep] = useState<"notice" | "consent" | "done">("notice")
  const [granted, setGranted] = useState<Record<string, boolean>>({ order: true })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dpdpFetch<NoticeCtx>(`/api/dpdp/p/${token}`).then(setCtx).catch((e) => setError(e.message))
  }, [token])

  async function saveConsent() {
    const purposes = PURPOSES.map((p) => ({ purposeKey: p.key, granted: granted[p.key] ?? p.required }))
    await dpdpFetch(`/api/dpdp/p/${token}/consent`, { method: "POST", body: JSON.stringify({ purposes, language: "en" }) })
    setStep("done")
  }

  async function raiseRequest(kind: string) {
    await dpdpFetch(`/api/dpdp/p/${token}/rights-request`, { method: "POST", body: JSON.stringify({ kind }) })
    alert("Your request is in. They must answer within 90 days.")
  }

  if (error) return <div className="min-h-screen flex items-center justify-center text-sm text-red-600">{error}</div>
  if (!ctx) return <div className="min-h-screen flex items-center justify-center text-sm text-[#8E86AD]">Loading…</div>

  return (
    <div className="min-h-screen bg-[#F8F6FF] flex items-center justify-center px-4 py-10">
      <div className="max-w-md w-full bg-[#160F2E] rounded-3xl p-2">
        <div className="bg-white rounded-2xl overflow-hidden min-h-[420px] p-5">
          {step === "notice" && (
            <div>
              <h3 className="text-lg font-bold mb-1">What we hold about you</h3>
              <p className="text-xs text-[#8E86AD] mb-4">Written plainly. {ctx.notice ? `${ctx.notice.docKind} v${ctx.notice.version}` : ""}</p>
              <Button className="w-full bg-gradient-to-r from-[#6D28D9] to-[#DB2777]" onClick={() => setStep("consent")}>Now tell us what you agree to →</Button>
            </div>
          )}
          {step === "consent" && (
            <div>
              <h3 className="text-lg font-bold mb-1">Tick only what you agree to</h3>
              <p className="text-xs text-[#8E86AD] mb-4">You can change any of this later, on this same link.</p>
              <div className="space-y-2 mb-4">
                {PURPOSES.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => !p.required && setGranted({ ...granted, [p.key]: !granted[p.key] })}
                    className={`w-full text-left border rounded-xl p-3 flex gap-3 ${granted[p.key] || p.required ? "border-[#059669] bg-[#DCFCE7]" : "border-[#E6E2F5]"}`}
                  >
                    <div className={`w-5 h-5 rounded shrink-0 flex items-center justify-center text-white text-xs ${granted[p.key] || p.required ? "bg-[#059669]" : "bg-[#8E86AD]"}`}>{(granted[p.key] || p.required) && "✓"}</div>
                    <div>
                      <div className="font-semibold text-sm">{p.label}</div>
                      <div className="text-xs text-[#564D77]">{p.note}{p.required && " · we cannot proceed without this"}</div>
                    </div>
                  </button>
                ))}
              </div>
              <Button className="w-full bg-[#059669] hover:bg-[#047857]" onClick={saveConsent}>Save my answer</Button>
            </div>
          )}
          {step === "done" && (
            <div>
              <h3 className="text-lg font-bold mb-1">✅ Saved, thank you</h3>
              <p className="text-xs text-[#8E86AD] mb-4">Your answer is recorded with today&apos;s date.</p>
              <div className="space-y-2">
                <button onClick={() => raiseRequest("access")} className="w-full text-left border rounded-xl p-3 hover:bg-[#F2ECFF]"><b className="text-sm">👁️ See everything they hold about me</b></button>
                <button onClick={() => raiseRequest("correction")} className="w-full text-left border rounded-xl p-3 hover:bg-[#F2ECFF]"><b className="text-sm">✏️ Correct something that is wrong</b></button>
                <button onClick={() => raiseRequest("erasure")} className="w-full text-left border rounded-xl p-3 hover:bg-[#F2ECFF]"><b className="text-sm">🗑️ Ask them to delete my data</b></button>
                <button onClick={() => setStep("consent")} className="w-full text-left border rounded-xl p-3 hover:bg-[#F2ECFF]"><b className="text-sm">🔕 Change my mind about the ticks above</b></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
