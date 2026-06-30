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
  if (c >= 0.85) return <Badge className="bg-green-900/40 text-green-300 border-green-700 text-[10px]">{Math.round(c * 100)}% sure</Badge>
  if (c >= 0.6) return <Badge className="bg-yellow-900/40 text-yellow-300 border-yellow-700 text-[10px]">{Math.round(c * 100)}% sure</Badge>
  return <Badge className="bg-red-900/40 text-red-300 border-red-700 text-[10px]">{Math.round(c * 100)}% sure</Badge>
}

function rowBg(item: IngestItem) {
  if (item.reviewStatus === 'rejected') return 'opacity-40 bg-red-950/20'
  if (item.isDuplicate) return 'bg-yellow-950/20 border-l-2 border-yellow-600'
  if (item.warnings.length > 0 || item.confidence < 0.7) return 'bg-yellow-950/10'
  if (item.reviewStatus === 'approved' || item.reviewStatus === 'edited') return 'bg-green-950/20'
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
    <div className="min-h-screen bg-[#0f1117] text-gray-100 p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Import Compliance Data</h1>
        <p className="text-gray-400 text-sm mt-1">
          Upload your existing compliance data from Excel, CSV, or PDF. AI extracts the items. You review before anything is saved.
        </p>
      </div>

      {/* ── Upload zone ── */}
      {!batch && !uploading && (
        <div
          className={`border-2 border-dashed rounded-xl p-16 text-center transition-colors cursor-pointer
            ${dragOver ? 'border-blue-500 bg-blue-900/10' : 'border-gray-700 hover:border-gray-500 bg-gray-900/30'}`}
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
          <Upload className="mx-auto mb-4 text-gray-500" size={40} />
          <p className="text-lg font-medium text-gray-300 mb-1">Drop your file here or click to browse</p>
          <p className="text-sm text-gray-500 mb-6">Supports Excel (.xlsx, .xls), CSV (.csv), and PDF (.pdf) — up to 10 MB</p>
          <div className="flex justify-center gap-6 text-xs text-gray-600">
            <span className="flex items-center gap-1"><FileSpreadsheet size={14} /> Tally exports</span>
            <span className="flex items-center gap-1"><FileSpreadsheet size={14} /> GST portal CSVs</span>
            <span className="flex items-center gap-1"><FileText size={14} /> Compliance tracker sheets</span>
            <span className="flex items-center gap-1"><FileText size={14} /> CA-prepared PDFs</span>
          </div>
        </div>
      )}

      {/* ── Upload error ── */}
      {uploadError && (
        <div className="mt-4 p-4 bg-red-900/20 border border-red-700 rounded-lg flex items-start gap-3">
          <XCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-red-300 font-medium text-sm">Upload failed</p>
            <p className="text-red-400 text-xs mt-1">{uploadError}</p>
            <Button variant="ghost" size="sm" className="mt-2 text-red-400 hover:text-red-300 h-7 px-2 text-xs" onClick={() => { setUploadError(null); fileRef.current?.click() }}>
              Try again
            </Button>
          </div>
        </div>
      )}

      {/* ── Processing ── */}
      {uploading && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Loader2 size={36} className="text-blue-400 animate-spin" />
          <p className="text-gray-300 font-medium">Parsing file and extracting compliance items with AI…</p>
          <p className="text-gray-500 text-sm">This takes 10–30 seconds depending on file size.</p>
        </div>
      )}

      {/* ── Confirmed result ── */}
      {confirmResult && (
        <div className="mb-6 p-5 bg-green-900/20 border border-green-700 rounded-xl">
          <div className="flex items-center gap-3">
            <CheckCircle size={20} className="text-green-400" />
            <p className="text-green-300 font-semibold">{confirmResult.message}</p>
          </div>
          {confirmResult.failed > 0 && (
            <p className="mt-2 text-yellow-400 text-sm">{confirmResult.failed} items failed to import. Check the console logs for details.</p>
          )}
          <Button variant="ghost" size="sm" className="mt-3 text-gray-400 text-xs" onClick={() => { setBatch(null); setConfirmResult(null) }}>
            <RotateCcw size={12} className="mr-1" /> Import another file
          </Button>
        </div>
      )}

      {/* ── Review table ── */}
      {batch && !confirmResult && (
        <>
          {/* Stats bar */}
          <div className="mb-4 p-4 bg-gray-900/50 rounded-xl border border-gray-800 flex flex-wrap gap-6 items-center justify-between">
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-gray-400">File: <span className="text-white font-medium">{batch.fileName}</span></span>
              <span className="text-gray-400">Rows parsed: <span className="text-white">{batch.stats.totalRowsParsed}</span></span>
              <span className="text-gray-400">Items extracted: <span className="text-white">{batch.stats.itemsExtracted}</span></span>
              {batch.stats.skippedRows > 0 && <span className="text-yellow-400">{batch.stats.skippedRows} rows skipped</span>}
            </div>
            <div className="flex gap-3 text-xs">
              <span className="px-2 py-1 rounded bg-green-900/30 text-green-300 border border-green-800">✓ {approvedCount} approved</span>
              <span className="px-2 py-1 rounded bg-yellow-900/30 text-yellow-300 border border-yellow-800">⏳ {pendingCount} pending</span>
              <span className="px-2 py-1 rounded bg-red-900/30 text-red-300 border border-red-800">✕ {rejectedCount} rejected</span>
              {batch.stats.duplicates > 0 && <span className="px-2 py-1 rounded bg-orange-900/30 text-orange-300 border border-orange-800">⚠ {batch.stats.duplicates} duplicates</span>}
            </div>
          </div>

          {/* Bulk actions */}
          <div className="mb-3 flex gap-2">
            <Button size="sm" variant="outline" className="text-xs border-green-800 text-green-400 hover:bg-green-900/20" onClick={approveAll}>
              Approve all non-rejected
            </Button>
            <Button size="sm" variant="outline" className="text-xs border-gray-700 text-gray-400 hover:bg-gray-800" onClick={() => { setBatch(null) }}>
              Cancel import
            </Button>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-gray-800 overflow-hidden mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-900 text-gray-400 text-left">
                  <th className="px-3 py-2 w-8">#</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2 w-28">Type</th>
                  <th className="px-3 py-2 w-24">Due Date</th>
                  <th className="px-3 py-2 w-20">Priority</th>
                  <th className="px-3 py-2 w-20">Confidence</th>
                  <th className="px-3 py-2 w-20">Warnings</th>
                  <th className="px-3 py-2 w-32 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {batch.items.map(item => (
                  <>
                    <tr key={item.id} className={`hover:bg-gray-800/30 transition-colors ${rowBg(item)}`}>
                      <td className="px-3 py-2.5 text-gray-500">{item.sourceRow}</td>
                      <td className="px-3 py-2.5">
                        {editingItem === item.id ? (
                          <Input
                            value={editDraft.title ?? ''}
                            onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                            className="h-6 text-xs bg-gray-800 border-gray-600"
                          />
                        ) : (
                          <span className={item.title ? 'text-gray-200' : 'text-red-400 italic'}>
                            {item.title ?? 'No title — must be set before import'}
                          </span>
                        )}
                        {item.isDuplicate && <span className="ml-2 text-orange-400">[possible duplicate]</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {editingItem === item.id ? (
                          <Select value={editDraft.complianceType ?? 'OTHER'} onValueChange={v => setEditDraft(d => ({ ...d, complianceType: v }))}>
                            <SelectTrigger className="h-6 text-xs bg-gray-800 border-gray-600"><SelectValue /></SelectTrigger>
                            <SelectContent>{COMPLIANCE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-blue-800 text-blue-300">{item.complianceType ?? '?'}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {editingItem === item.id ? (
                          <Input type="date" value={editDraft.dueDate ?? ''} onChange={e => setEditDraft(d => ({ ...d, dueDate: e.target.value }))} className="h-6 text-xs bg-gray-800 border-gray-600" />
                        ) : (
                          <span className={item.dueDate ? 'text-gray-300' : 'text-red-400 italic'}>
                            {item.dueDate ?? 'Missing'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {editingItem === item.id ? (
                          <Select value={editDraft.priority ?? 'medium'} onValueChange={v => setEditDraft(d => ({ ...d, priority: v }))}>
                            <SelectTrigger className="h-6 text-xs bg-gray-800 border-gray-600"><SelectValue /></SelectTrigger>
                            <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <span className={item.priority === 'critical' ? 'text-red-400' : item.priority === 'high' ? 'text-orange-400' : 'text-gray-400'}>
                            {item.priority}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">{confidenceBadge(item.confidence)}</td>
                      <td className="px-3 py-2.5">
                        {item.warnings.length > 0 && (
                          <button onClick={() => setExpandedRow(expandedRow === item.id ? null : item.id)} className="flex items-center gap-1 text-yellow-400 hover:text-yellow-300">
                            <AlertTriangle size={11} />
                            <span>{item.warnings.length}</span>
                            {expandedRow === item.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {saving === item.id ? (
                          <Loader2 size={12} className="animate-spin text-gray-400 ml-auto" />
                        ) : editingItem === item.id ? (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" className="h-5 text-[10px] px-2 bg-blue-700 hover:bg-blue-600" onClick={() => saveEdit(item.id)}>Save</Button>
                            <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1 text-gray-400" onClick={() => setEditingItem(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => startEdit(item)} className="px-2 py-0.5 rounded text-[10px] text-gray-400 hover:text-gray-200 hover:bg-gray-700">Edit</button>
                            {item.reviewStatus !== 'approved' && item.reviewStatus !== 'edited' ? (
                              <button onClick={() => setReviewStatus(item.id, 'approved')} className="px-2 py-0.5 rounded text-[10px] bg-green-900/40 text-green-300 hover:bg-green-800/50">✓</button>
                            ) : (
                              <span className="px-2 py-0.5 text-[10px] text-green-500">✓ OK</span>
                            )}
                            {item.reviewStatus !== 'rejected' ? (
                              <button onClick={() => setReviewStatus(item.id, 'rejected')} className="px-2 py-0.5 rounded text-[10px] bg-red-900/40 text-red-300 hover:bg-red-800/50">✕</button>
                            ) : (
                              <button onClick={() => setReviewStatus(item.id, 'pending')} className="px-2 py-0.5 rounded text-[10px] text-gray-500 hover:text-gray-300">↩</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {/* Warnings expansion row */}
                    {expandedRow === item.id && item.warnings.length > 0 && (
                      <tr key={`${item.id}-warnings`} className="bg-yellow-950/10">
                        <td colSpan={8} className="px-4 py-2">
                          <ul className="space-y-0.5">
                            {item.warnings.map((w, i) => (
                              <li key={i} className="text-yellow-400 text-[11px] flex items-start gap-1.5">
                                <AlertTriangle size={10} className="mt-0.5 flex-shrink-0" /> {w}
                              </li>
                            ))}
                          </ul>
                          {Object.keys(item.extraData).length > 0 && (
                            <details className="mt-2">
                              <summary className="text-gray-500 text-[10px] cursor-pointer">Extra data from file ({Object.keys(item.extraData).length} columns)</summary>
                              <pre className="text-[10px] text-gray-500 mt-1">{JSON.stringify(item.extraData, null, 2)}</pre>
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
          <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-xl border border-gray-800">
            <div className="text-sm text-gray-400">
              <span className="text-white font-medium">{approvedCount} items</span> will be imported.{' '}
              <span className="text-gray-500">{rejectedCount} rejected, {pendingCount} still pending review.</span>
              {pendingCount > 0 && <span className="text-yellow-400 ml-2">Pending items will be skipped.</span>}
            </div>
            <div className="flex gap-3">
              {batch.stats.duplicates > 0 && (
                <Button
                  variant="outline"
                  className="border-orange-800 text-orange-400 hover:bg-orange-900/20 text-sm"
                  onClick={() => confirmImport(true)}
                  disabled={confirming || approvedCount === 0}
                >
                  Import including duplicates
                </Button>
              )}
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-sm px-6"
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
