// R63 (owner directive, 2026-08-29): bottom-left-of-chat-box badge showing
// the signed-in user's own AI-delegation link. Self-contained component --
// import and place in the chat box's footer/corner; does not assume
// anything about the host component's own layout.
'use client'

import { useEffect, useState } from 'react'
import { Copy, Check, RefreshCw } from 'lucide-react'

export function AiLinkBadge() {
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/ai-link')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUrl(data?.url ?? null))
      .finally(() => setLoading(false))
  }, [])

  async function handleCopy() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleRotate() {
    setLoading(true)
    const res = await fetch('/api/ai-link', { method: 'POST' })
    const data = res.ok ? await res.json() : null
    setUrl(data?.url ?? null)
    setLoading(false)
  }

  if (loading) return null
  if (!url) return null

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-ct-slate/70 px-2 py-1">
      <span className="truncate max-w-[160px]" title={url}>
        AI link: {url}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        title="Copy your AI link -- add it as a connector in Claude.ai or another MCP-compatible AI to let it work on your behalf"
        className="shrink-0 rounded p-1 hover:bg-ct-cloud"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={handleRotate}
        title="Revoke this link and generate a new one"
        className="shrink-0 rounded p-1 hover:bg-ct-cloud"
      >
        <RefreshCw className="size-3.5" />
      </button>
    </div>
  )
}
