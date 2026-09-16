"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { dpdpFetch } from "../../_lib/api"

type LinkData = { token: string | null; expiresAt: string; isNew: boolean; reads: { at: string }[] }

const CAN_SEE = [
  "Duties — what's done and what's late",
  "Where each kind of data is kept",
  "Which outside firms hold your data, and whether they've signed",
  "How many people are in each group — counts only",
  "Open requests and complaints, by reference number",
]
const CANNOT_SEE = [
  "Any customer, employee or parent's name, phone or email",
  "Any evidence file — only whether one exists",
  "Your staff's email addresses",
  "The contents of a complaint",
  "Anything about your other organisations",
]

export default function AiLinkPage() {
  const [data, setData] = useState<LinkData | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [origin, setOrigin] = useState("")

  async function load() {
    try {
      setData(await dpdpFetch<LinkData>("/api/dpdp/ai-link"))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    load()
    setOrigin(window.location.origin)
  }, [])

  async function rotate() {
    await dpdpFetch("/api/dpdp/ai-link", { method: "POST" })
    await load()
  }

  const url = data?.token ? `${origin}/api/dpdp/ai/${data.token}` : null

  function copy() {
    if (!url) return
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🤖 AI Link</h1>
      <p className="text-sm text-[#564D77] mb-4">
        Paste this link into ChatGPT, Claude, Gemini or any other AI. It can read where you stand and tell you what to do about it. <b>It cannot change anything.</b> Whatever it suggests, you enter yourself, inside the product.
      </p>

      {error && <Card className="mb-4 bg-[#FFE4E9]"><CardContent className="pt-6 text-sm">{error}</CardContent></Card>}

      {url ? (
        <>
          <Card className="mb-2"><CardContent className="pt-6">
            <div className="font-mono text-xs break-all text-[#6D28D9]">{url}</div>
          </CardContent></Card>
          <Button onClick={copy} className="bg-gradient-to-r from-[#6D28D9] to-[#9333EA]">{copied ? "✓ Copied" : "📋 Copy my AI Link"}</Button>
          <span className="text-xs text-[#8E86AD] ml-3">Read-only · expires {data?.expiresAt ? new Date(data.expiresAt).toLocaleDateString("en-IN") : "—"}</span>
        </>
      ) : (
        <Card className="mb-4 bg-[#F2ECFF]"><CardContent className="pt-6 text-sm">
          You already have a link. The raw value is only ever shown once (when created or replaced) — never stored in a way that could be shown again.
          <div className="mt-3"><Button onClick={rotate} className="bg-white text-[#6D28D9] border border-[#E6E2F5]">🔄 Replace my link</Button></div>
        </CardContent></Card>
      )}

      <div className="grid grid-cols-2 gap-3 my-4">
        <Card className="bg-[#DCFCE7]"><CardContent className="pt-6"><b className="block mb-2">✅ What it can see</b><ul className="text-sm list-disc pl-4 space-y-1">{CAN_SEE.map((x) => <li key={x}>{x}</li>)}</ul></CardContent></Card>
        <Card className="bg-[#FFE4E9]"><CardContent className="pt-6"><b className="block mb-2">🚫 What it can never see</b><ul className="text-sm list-disc pl-4 space-y-1">{CANNOT_SEE.map((x) => <li key={x}>{x}</li>)}</ul></CardContent></Card>
      </div>

      <Card className="mb-4 bg-[#FEF3C7]"><CardContent className="pt-6 text-sm">
        <b>Why this is built the way it is:</b> we sell you protection against personal data leaving your control. It would be absurd if our own feature sent your customers&rsquo; names to a server elsewhere. Nothing personal is in that link — it carries the shape of your compliance, never the people inside it.
      </CardContent></Card>

      {data?.reads && data.reads.length > 0 && (
        <Card><CardContent className="pt-6">
          <b className="block mb-2 text-sm">👁️ Who has opened your link</b>
          {data.reads.map((a, i) => <div key={i} className="text-sm text-[#564D77]">{new Date(a.at).toLocaleString("en-IN")}</div>)}
        </CardContent></Card>
      )}
    </div>
  )
}
