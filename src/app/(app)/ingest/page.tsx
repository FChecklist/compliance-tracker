'use client'

import { useState, useCallback, useRef } from 'react'
import { Upload, FileSpreadsheet, FileText, CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronUp, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface IngestItem {
  id: string
  sourceRow: number
  title: string | null
  complianceType: string | null
  dueDate: string | null
  status: string | null
  priority: string | null
  departmentName: string | null
  departmentId: string | null
  assignedToName: string | null
  description: string | null
  confidence: number
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'edited'
  warnings: string[]
  missingFields: string[]
  isDuplicate: boolean
  duplicateOfId: string | null
  extraData: Record<string, unknown>
}

interface BatchStats {
  totalRowsParsed: number
  itemsExtracted: number
  skippedRows: number
  readyToImport: number
  needsReview: number
  hasErrors: number
  duplicates: number
}

interface Batch {
  batchId: string
  fileName: string
  stats: BatchStats
  items: IngestItem[]
}

const COMPLIANCE_TYPES = ['GST','TDS','MCA','PF','ESIC','INCOME_TAX','ROC','LABOUR','ENVIRONMENTAL','OTHER']
const STATUSES = ['pending','in_progress','completed','overdue','not_applicable','draft']
const PRIORITIES = ['low','medium','high','critical']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function confidenceBadge(c: number) {
  if (c >= 0.85) return <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">{Math.round(c * 100)}% sure</Badge>
  if (c >= 0.6) return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-[10px]">{Math.round(c * 100)}% sure</Badge>
  return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">{Math.round(c * 100)}% sure</Badge>
}

function rowBg(item: IngestItem) {
  if (item.reviewStatus === 'rejected') return 'opacity-50 bg-red-50'
  if (item.isDuplicate) return 'bg-yellow-50 border-l-2 border-yellow-400'
  if (item.warnings.length > 0 || item.confidence < 0.7) return 'bg-yellow-50/50'
  if (item.reviewStatus === 'approved' || item.reviewStatus === 'edited') return 'bg-green-50'
  return ''
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function IngestPage() {
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [batch, setBatch] = useState<Batch | null>(null)
  const [saving, setSaving] = useState<string | null>(null) // itemId being saved
  const [confirming, setConfirming] = useState(false)
  const [confirmResult, setConfirmResult] = useState<{ confirmed: number; failed: number; message: string } | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<IngestItem>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------
  const handleFile = useCallback(async (file: File) => {
    setUploadError(null)
    setUploading(true)
    setBatch(null)
    setConfirmResult(null)

    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/ingest', { method: 'POST', body: form })
      const data = await res.json() as { batchId?: string; stats?: BatchStats; error?: string }
      if (!res.ok || !data.batchId) throw new Error(data.error ?? 'Upload failed')

      // Fetch full batch with items
      const batchRes = await fetch(`/api/ingest/${data.batchId}`)
      const batchData = await batchRes.json() as { items?: IngestItem[] }

      setBatch({ batchId: data.batchId, fileName: file.name, stats: data.stats!, items: batchData.items ?? [] })
    } catch (err) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  // ---------------------------------------------------------------------------
  // Item actions
  // ---------------------------------------------------------------------------
  async function setReviewStatus(itemId: string, status: 'approved' | 'rejected') {
    if (!batch) return
    setSaving(itemId)
    await fetch(`/api/ingest/${batch.batchId}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewStatus: status }),
    })
    setBatch(prev => prev ? {
      ...prev,
      items: prev.items.map(i => i.id === itemId ? { ...i, reviewStatus: status } : i),
    } : prev)
    setSaving(null)
  }

  function startEdit(item: IngestItem) {
    setEditingItem(item.id)
    setEditDraft({
      title: item.title ?? '',
      complianceType: item.complianceType ?? 'OTHER',
      dueDate: item.dueDate ?? '',
      status: item.status ?? 'pending',
      priority: item.priority ?? 'medium',
    })
  }

  async function saveEdit(itemId: string) {
    if (!batch) return
    setSaving(itemId)
    const res = await fetch(`/api/ingest/${batch.batchId}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editDraft, reviewStatus: 'edited' }),
    })
    const updated = await res.json() as Partial<IngestItem>
    setBatch(prev => prev ? {
      ...prev,
      items: prev.items.map(i => i.id === itemId ? { ...i, ...updated, reviewStatus: 'edited' } : i),
    } : prev)
    setEditingItem(null)
    setSaving(null)
  }

  function approveAll() {
    if (!batch) return
    batch.items.forEach(item => {
      if (item.reviewStatus !== 'rejected') setReviewStatus(item.id, 'approved')
    })
  }

  // ---------------------------------------------------------------------------
  // Confirm
  // ---------------------------------------------------------------------------
  async function confirmImport(forceDuplicates = false) {
    if (!batch) return
    setConfirming(true)
    const res = await fetch(`/api/ingest/${batch.batchId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force_duplicates: forceDuplicates }),
    })
    const data = await res.json() as { confirmed: number; failed: number; message: string }
    setConfirmResult(data)
    setConfirming(false)
  }

  // ---------------------------------------------------------------------------
  // Counts
  // ---------------------------------------------------------------------------
  const approvedCount = batch?.items.filter(i => i.reviewStatus === 'approved' || i.reviewStatus === 'edited').length ?? 0
  const rejectedCount = batch?.items.filter(i => i.reviewStatus === 'rejected').length ?? 0
  const pendingCount = batch?.items.filter(i => i.reviewStatus === 'pending').length ?? 0

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Import Compliance Data</h1>
        <p className="text-sm text-ct-muted mt-1">
          Upload your existing compliance data from Excel, CSV, or PDF. AI extracts the items. You review before anything is saved.
        </p>
      </div>

      {/* ── Upload zone ── */}
      {!batch && !uploading && (
        <div
          className={`border-2 border-dashed rounded-xl p-16 text-center transition-colors cursor-pointer bg-white
            ${dragOver ? 'border-ct-saffron bg-ct-saffron/5' : 'border-ct-border hover:border-ct-saffron/50'}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".xlsx,.xls,.csv,.pdf"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
          <Upload className="mx-auto mb-4 text-ct-saffron" size={40} />
          <p className="text-lg font-medium text-ct-navy mb-1">Drop your file here or click to browse</p>
          <p className="text-sm text-ct-muted mb-6">Supports Excel (.xlsx, .xls), CSV (.csv), and PDF (.pdf) — up to 10 MB</p>
          <div className="flex justify-center gap-6 text-xs text-ct-muted">
            <span className="flex items-center gap-1"><FileSpreadsheet size={14} /> Tally exports</span>
            <span className="flex items-center gap-1"><FileSpreadsheet size={14} /> GST portal CSVs</span>
            <span className="flex items-center gap-1"><FileText size={14} /> Compliance tracker sheets</span>
            <span className="flex items-center gap-1"><FileText size={14} /> CA-prepared PDFs</span>
          </div>
        </div>
      )}

      {/* ── Upload error ── */}
      {uploadError && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <XCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-red-700 font-medium text-sm">Upload failed</p>
            <p className="text-red-600 text-xs mt-1">{uploadError}</p>
            <Button variant="ghost" size="sm" className="mt-2 text-red-600 hover:text-red-700 h-7 px-2 text-xs" onClick={() => { setUploadError(null); fileRef.current?.click() }}>
              Try again
            </Button>
          </div>
        </div>
      )}

      {/* ── Processing ── */}
      {uploading && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 bg-white rounded-xl border border-ct-border">
          <Loader2 size={36} className="text-ct-saffron animate-spin" />
          <p className="text-ct-navy font-medium">Parsing file and extracting compliance items with AI…</p>
          <p className="text-ct-muted text-sm">This takes 10–30 seconds depending on file size.</p>
        </div>
      )}

      {/* ── Confirmed result ── */}
      {confirmResult && (
        <div className="mb-6 p-5 bg-green-50 border border-green-200 rounded-xl">
          <div className="flex items-center gap-3">
            <CheckCircle size={20} className="text-green-600" />
            <p className="text-green-700 font-semibold">{confirmResult.message}</p>
          </div>
          {confirmResult.failed > 0 && (
            <p className="mt-2 text-amber-600 text-sm">{confirmResult.failed} items failed to import. Check the console logs for details.</p>
          )}
          <Button variant="ghost" size="sm" className="mt-3 text-ct-muted text-xs" onClick={() => { setBatch(null); setConfirmResult(null) }}>
            <RotateCcw size={12} className="mr-1" /> Import another file
          </Button>
        </div>
      )}

      {/* ── Review table ── */}
      {batch && !confirmResult && (
        <>
          {/* Stats bar */}
          <div className="p-4 bg-white rounded-xl border border-ct-border shadow-card flex flex-wrap gap-6 items-center justify-between">
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-ct-muted">File: <span className="text-ct-navy font-medium">{batch.fileName}</span></span>
              <span className="text-ct-muted">Rows parsed: <span className="text-ct-navy">{batch.stats.totalRowsParsed}</span></span>
              <span className="text-ct-muted">Items extracted: <span className="text-ct-navy">{batch.stats.itemsExtracted}</span></span>
              {batch.stats.skippedRows > 0 && <span className="text-amber-600">{batch.stats.skippedRows} rows skipped</span>}
            </div>
            <div className="flex gap-3 text-xs">
              <span className="px-2 py-1 rounded bg-green-100 text-green-700 border border-green-200">✓ {approvedCount} approved</span>
              <span className="px-2 py-1 rounded bg-amber-100 text-amber-700 border border-amber-200">⏳ {pendingCount} pending</span>
              <span className="px-2 py-1 rounded bg-red-100 text-red-700 border border-red-200">✕ {rejectedCount} rejected</span>
              {batch.stats.duplicates > 0 && <span className="px-2 py-1 rounded bg-orange-100 text-orange-700 border border-orange-200">⚠ {batch.stats.duplicates} duplicates</span>}
            </div>
          </div>

          {/* Bulk actions */}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="text-xs border-green-300 text-green-700 hover:bg-green-50" onClick={approveAll}>
              Approve all non-rejected
            </Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => { setBatch(null) }}>
              Cancel import
            </Button>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-ct-border overflow-hidden bg-white shadow-card">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-ct-cloud text-ct-navy text-left border-b border-ct-border">
                  <th className="px-3 py-2.5 w-8 font-semibold">#</th>
                  <th className="px-3 py-2.5 font-semibold">Title</th>
                  <th className="px-3 py-2.5 w-28 font-semibold">Type</th>
                  <th className="px-3 py-2.5 w-24 font-semibold">Due Date</th>
                  <th className="px-3 py-2.5 w-20 font-semibold">Priority</th>
                  <th className="px-3 py-2.5 w-20 font-semibold">Confidence</th>
                  <th className="px-3 py-2.5 w-20 font-semibold">Warnings</th>
                  <th className="px-3 py-2.5 w-32 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ct-border">
                {batch.items.map(item => (
                  <>
                    <tr key={item.id} className={`hover:bg-ct-cloud/50 transition-colors ${rowBg(item)}`}>
                      <td className="px-3 py-2.5 text-ct-muted">{item.sourceRow}</td>
                      <td className="px-3 py-2.5">
                        {editingItem === item.id ? (
                          <Input
                            value={editDraft.title ?? ''}
                            onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                            className="h-6 text-xs"
                          />
                        ) : (
                          <span className={item.title ? 'text-ct-navy' : 'text-red-500 italic'}>
                            {item.title ?? 'No title — must be set before import'}
                          </span>
                        )}
                        {item.isDuplicate && <span className="ml-2 text-amber-600">[possible duplicate]</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {editingItem === item.id ? (
                          <Select value={editDraft.complianceType ?? 'OTHER'} onValueChange={v => setEditDraft(d => ({ ...d, complianceType: v }))}>
                            <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{COMPLIANCE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-ct-border text-ct-slate">{item.complianceType ?? '?'}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {editingItem === item.id ? (
                          <Input type="date" value={editDraft.dueDate ?? ''} onChange={e => setEditDraft(d => ({ ...d, dueDate: e.target.value }))} className="h-6 text-xs" />
                        ) : (
                          <span className={item.dueDate ? 'text-ct-navy' : 'text-red-500 italic'}>
                            {item.dueDate ?? 'Missing'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {editingItem === item.id ? (
                          <Select value={editDraft.priority ?? 'medium'} onValueChange={v => setEditDraft(d => ({ ...d, priority: v }))}>
                            <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <span className={item.priority === 'critical' ? 'text-red-600 font-medium' : item.priority === 'high' ? 'text-orange-600' : 'text-ct-muted'}>
                            {item.priority}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">{confidenceBadge(item.confidence)}</td>
                      <td className="px-3 py-2.5">
                        {item.warnings.length > 0 && (
                          <button onClick={() => setExpandedRow(expandedRow === item.id ? null : item.id)} className="flex items-center gap-1 text-amber-600 hover:text-amber-700">
                            <AlertTriangle size={11} />
                            <span>{item.warnings.length}</span>
                            {expandedRow === item.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {saving === item.id ? (
                          <Loader2 size={12} className="animate-spin text-ct-muted ml-auto" />
                        ) : editingItem === item.id ? (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" className="h-5 text-[10px] px-2 bg-ct-teal hover:bg-ct-teal text-white" onClick={() => saveEdit(item.id)}>Save</Button>
                            <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1 text-ct-muted" onClick={() => setEditingItem(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => startEdit(item)} className="px-2 py-0.5 rounded text-[10px] text-ct-muted hover:text-ct-navy hover:bg-ct-cloud">Edit</button>
                            {item.reviewStatus !== 'approved' && item.reviewStatus !== 'edited' ? (
                              <button onClick={() => setReviewStatus(item.id, 'approved')} className="px-2 py-0.5 rounded text-[10px] bg-green-100 text-green-700 hover:bg-green-200">✓</button>
                            ) : (
                              <span className="px-2 py-0.5 text-[10px] text-green-600">✓ OK</span>
                            )}
                            {item.reviewStatus !== 'rejected' ? (
                              <button onClick={() => setReviewStatus(item.id, 'rejected')} className="px-2 py-0.5 rounded text-[10px] bg-red-100 text-red-700 hover:bg-red-200">✕</button>
                            ) : (
                              <button onClick={() => setReviewStatus(item.id, 'pending')} className="px-2 py-0.5 rounded text-[10px] text-ct-muted hover:text-ct-navy">↩</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {/* Warnings expansion row */}
                    {expandedRow === item.id && item.warnings.length > 0 && (
                      <tr key={`${item.id}-warnings`} className="bg-amber-50">
                        <td colSpan={8} className="px-4 py-2">
                          <ul className="space-y-0.5">
                            {item.warnings.map((w, i) => (
                              <li key={i} className="text-amber-700 text-[11px] flex items-start gap-1.5">
                                <AlertTriangle size={10} className="mt-0.5 flex-shrink-0" /> {w}
                              </li>
                            ))}
                          </ul>
                          {Object.keys(item.extraData).length > 0 && (
                            <details className="mt-2">
                              <summary className="text-ct-muted text-[10px] cursor-pointer">Extra data from file ({Object.keys(item.extraData).length} columns)</summary>
                              <pre className="text-[10px] text-ct-muted mt-1">{JSON.stringify(item.extraData, null, 2)}</pre>
                            </details>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Confirm button */}
          <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-ct-border shadow-card">
            <div className="text-sm text-ct-muted">
              <span className="text-ct-navy font-medium">{approvedCount} items</span> will be imported.{' '}
              <span className="text-ct-muted">{rejectedCount} rejected, {pendingCount} still pending review.</span>
              {pendingCount > 0 && <span className="text-amber-600 ml-2">Pending items will be skipped.</span>}
            </div>
            <div className="flex gap-3">
              {batch.stats.duplicates > 0 && (
                <Button
                  variant="outline"
                  className="border-orange-300 text-orange-700 hover:bg-orange-50 text-sm"
                  onClick={() => confirmImport(true)}
                  disabled={confirming || approvedCount === 0}
                >
                  Import including duplicates
                </Button>
              )}
              <Button
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white text-sm px-6"
                onClick={() => confirmImport(false)}
                disabled={confirming || approvedCount === 0}
              >
                {confirming ? <><Loader2 size={14} className="animate-spin mr-2" />Importing…</> : `Confirm Import (${approvedCount} items)`}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
