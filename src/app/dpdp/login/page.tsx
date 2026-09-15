"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { dpdpFetch } from "../_lib/api"

export default function DpdpLoginPage() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await dpdpFetch("/api/dpdp/auth/request-link", { method: "POST", body: JSON.stringify({ email }) })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F6FF] px-4">
      <Card className="w-full max-w-md border-[#E6E2F5]">
        <CardHeader>
          <div className="text-[#6D28D9] font-bold text-lg tracking-tight">VERIDIAN</div>
          <CardTitle className="text-2xl">A quick link to sign in</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="text-sm text-muted-foreground space-y-2">
              <p>🔑 <strong>No password.</strong> Check your email — the link signs you in, and it works for you only.</p>
              <p>↩️ Or just reply to that email and a person will read it.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-sm text-muted-foreground">You never need a password. Every email carries a link that signs you in.</p>
              <Input type="email" required placeholder="you@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full bg-gradient-to-r from-[#6D28D9] to-[#DB2777] hover:opacity-90">
                {busy ? "Sending…" : "Send me a link"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
