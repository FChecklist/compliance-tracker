"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { dpdpFetch } from "../_lib/api"

function readEditionCookie(): "firm" | "institution" {
  if (typeof document === "undefined") return "firm"
  const match = document.cookie.match(/(?:^|; )dpdp_edition=(firm|institution)/)
  return match ? (match[1] as "firm" | "institution") : "firm"
}

export default function DpdpOnboardingPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [sector, setSector] = useState("")
  // WO-DPDP-010 §6: pre-filled from the dpdp_edition cookie DpdpMarketingPage
  // sets when the visitor clicked "Start free" on /dpdp-firm or
  // /dpdp-institution -- still just a default, changeable here, since the
  // cookie can be missing (a magic link opened on a different device).
  const [product, setProduct] = useState<"firm" | "institution">("firm")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setProduct(readEditionCookie()) }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await dpdpFetch("/api/dpdp/organisations", { method: "POST", body: JSON.stringify({ name, sector, product }) })
      router.push("/dpdp/home")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F6FF] px-4">
      <Card className="w-full max-w-md border-[#E6E2F5]">
        <CardHeader>
          <div className="text-[#6D28D9] font-bold text-lg tracking-tight">VERIDIAN</div>
          <CardTitle className="text-2xl">Open the account</CardTitle>
          <CardDescription>One person, free forever. You&apos;ll be able to add colleagues afterwards.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Organisation name</label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Kapoor Exports Pvt Ltd" />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">What are you setting this up for?</label>
              <div className="grid grid-cols-2 gap-2">
                {(["firm", "institution"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProduct(p)}
                    className={`rounded-lg border-[1.5px] px-3 py-2 text-sm font-medium text-left ${product === p ? "border-[#6D28D9] bg-[#F2ECFF] text-[#1F1B3A]" : "border-[#E6E2F5] text-[#564D77]"}`}
                  >
                    {p === "firm" ? "🏭 A business, NGO or firm" : "🏫 A school"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Sector (optional)</label>
              <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Trading" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full bg-gradient-to-r from-[#6D28D9] to-[#DB2777] hover:opacity-90">
              {busy ? "Creating…" : "Create the organisation"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
