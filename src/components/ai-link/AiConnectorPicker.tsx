// R63 (owner directive, 2026-08-29): one-click "connect your AI" picker.
// Data-driven from platform.ai_connector_providers -- adding a future
// provider (once it ships real one-click support) is a DB row, never a
// code change to this component. A provider with no confirmed deep link
// (hasOneClickLink === false) never shows a misleading "Connect" button --
// only its honest, provider-specific instructions.
'use client'

import { useEffect, useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'

type SupportLevel = 'native_one_click' | 'requires_paid_plan' | 'enterprise_admin_only' | 'developer_only'

interface Provider {
  providerKey: string
  displayName: string
  supportLevel: SupportLevel
  deepLinkTemplate: string | null
  instructionsMd: string
  requiresPlan: string | null
}

const SUPPORT_LABEL: Record<SupportLevel, string> = {
  native_one_click: 'One-click',
  requires_paid_plan: 'Paid plan required',
  enterprise_admin_only: 'Enterprise admin only',
  developer_only: 'Developer/API only',
}

export function AiConnectorPicker() {
  const [aiLinkUrl, setAiLinkUrl] = useState<string | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ai-link').then((r) => (r.ok ? r.json() : null)).then((d) => setAiLinkUrl(d?.url ?? null))
    fetch('/api/ai-link/providers').then((r) => (r.ok ? r.json() : null)).then((d) => setProviders(d?.providers ?? []))
  }, [])

  async function copyLink() {
    if (!aiLinkUrl) return
    await navigator.clipboard.writeText(aiLinkUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleConnect(provider: Provider) {
    // Copy the link first -- whichever tab the provider opens, the user's
    // very next action is almost always "paste the URL", so this removes
    // one manual step regardless of that provider's exact flow.
    if (aiLinkUrl) navigator.clipboard.writeText(aiLinkUrl).catch(() => {})
    if (provider.deepLinkTemplate) {
      window.open(provider.deepLinkTemplate, '_blank', 'noopener,noreferrer')
    } else {
      setExpanded(provider.providerKey)
    }
  }

  if (!aiLinkUrl) return null

  return (
    <div className="rounded-lg border border-ct-border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-ct-navy">Your AI link</div>
          <div className="text-[11px] text-ct-slate truncate" title={aiLinkUrl}>{aiLinkUrl}</div>
        </div>
        <button type="button" onClick={copyLink} className="shrink-0 rounded p-1.5 hover:bg-ct-cloud" title="Copy link">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {providers.map((p) => (
          <div key={p.providerKey}>
            <button
              type="button"
              onClick={() => handleConnect(p)}
              className="w-full flex items-center justify-between gap-2 rounded-md border border-ct-border px-2.5 py-2 text-left hover:bg-ct-cloud"
            >
              <span className="text-[12px] font-medium">{p.displayName}</span>
              <span className="flex items-center gap-1 text-[10px] text-ct-slate">
                {SUPPORT_LABEL[p.supportLevel]}
                {p.deepLinkTemplate && <ExternalLink className="size-3" />}
              </span>
            </button>
            {expanded === p.providerKey && (
              <div className="mt-1 rounded-md bg-ct-cloud p-2 text-[11px] text-ct-slate">
                {p.requiresPlan && <div className="mb-1 font-medium">Requires: {p.requiresPlan}</div>}
                <div>{p.instructionsMd}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
