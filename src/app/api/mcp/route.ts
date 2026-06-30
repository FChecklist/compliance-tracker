/**
 * MCP Server 1 — Customer-Facing Compliance Data
 *
 * Edge runtime (Vercel). Speaks JSON-RPC 2.0 (MCP protocol).
 * Auth: Bearer <access_token> → resolves to org_id via mcp_access_codes table.
 * Connects using Supabase JS client (fetch-based — Edge compatible).
 *
 * Tools exposed:
 *   list_compliance_items, get_compliance_stats, get_overdue_items,
 *   create_compliance_item, update_compliance_status,
 *   list_departments, get_penalty_estimate
 *
 * Coordination: this server is an MCP CLIENT TARGET.
 *   Customer AI  → POST /api/mcp  (reads + writes their org data)
 *   Groq orchestrator → POST /api/mcp  (same tools, internal usage)
 * See MCP_PROTOCOL.md for full flow specification.
 */

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Supabase admin client (service role — bypasses RLS for token lookup)
// ---------------------------------------------------------------------------
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'compliance' } }
  )
}

// ---------------------------------------------------------------------------
// Auth — resolve Bearer token to org_id
// ---------------------------------------------------------------------------
async function resolveToken(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  if (!token) return null

  const sb = getAdminClient()
  const { data } = await sb
    .from('mcp_access_codes')
    .select('org_id, is_active')
    .eq('token', token)
    .single()

  if (!data?.is_active) return null

  // Update last_used_at without blocking the response
  sb.from('mcp_access_codes')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token', token)
    .then(() => {})

  return data.org_id
}

// ---------------------------------------------------------------------------
// Penalty estimation (Indian compliance defaults)
// ---------------------------------------------------------------------------
const PENALTY_RATES: Record<string, { daily: number; label: string }> = {
  GST: { daily: 50, label: '₹50/day (GSTR-3B) + 18% p.a. interest' },
  TDS: { daily: 200, label: '₹200/day + 1.5% p.m. on tax amount' },
  PF: { daily: 5, label: '5-50% p.a. depending on delay bracket' },
  ESIC: { daily: 12, label: '12% p.a. on contribution amount' },
  MCA: { daily: 100, label: '₹100/day per director' },
  INCOME_TAX: { daily: 300, label: '₹300/day u/s 271F' },
  ROC: { daily: 100, label: '₹100/day per director' },
  LABOUR: { daily: 50, label: '₹50/day' },
  ENVIRONMENTAL: { daily: 10000, label: '₹10,000/day (NGT orders)' },
  OTHER: { daily: 100, label: '₹100/day (estimated)' },
}

function estimatePenalty(type: string, daysLate: number) {
  const rate = PENALTY_RATES[type] ?? PENALTY_RATES.OTHER
  return {
    type,
    daysLate,
    estimatedPenalty: rate.daily * daysLate,
    rateLabel: rate.label,
    disclaimer: 'Estimate only. Actual penalty depends on authority discretion and specific facts.',
  }
}

// ---------------------------------------------------------------------------
// Tool definitions (returned by tools/list)
// ---------------------------------------------------------------------------
const TOOL_DEFINITIONS = [
  {
    name: 'list_compliance_items',
    description: 'List compliance items for the organisation with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'overdue', 'not_applicable', 'draft'] },
        compliance_type: { type: 'string', enum: ['GST', 'TDS', 'MCA', 'PF', 'ESIC', 'INCOME_TAX', 'ROC', 'LABOUR', 'ENVIRONMENTAL', 'OTHER'] },
        department_id: { type: 'string' },
        search: { type: 'string' },
        page: { type: 'number', default: 1 },
        limit: { type: 'number', default: 20, maximum: 100 },
      },
    },
  },
  {
    name: 'get_compliance_stats',
    description: 'Dashboard statistics: total, overdue, completed counts, items due this week, and department breakdown.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_overdue_items',
    description: 'All overdue compliance items with days past due and penalty estimate.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_compliance_item',
    description: 'Create a new compliance item.',
    inputSchema: {
      type: 'object',
      required: ['title', 'compliance_type', 'department_id', 'due_date'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        compliance_type: { type: 'string', enum: ['GST', 'TDS', 'MCA', 'PF', 'ESIC', 'INCOME_TAX', 'ROC', 'LABOUR', 'ENVIRONMENTAL', 'OTHER'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
        department_id: { type: 'string' },
        due_date: { type: 'string', description: 'ISO 8601 date string' },
        assigned_to_id: { type: 'string' },
      },
    },
  },
  {
    name: 'update_compliance_status',
    description: 'Update the status of a compliance item.',
    inputSchema: {
      type: 'object',
      required: ['id', 'status'],
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'overdue', 'not_applicable', 'draft'] },
      },
    },
  },
  {
    name: 'list_departments',
    description: 'List all departments in the organisation.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_penalty_estimate',
    description: 'Estimate the penalty for a given compliance type and number of days late.',
    inputSchema: {
      type: 'object',
      required: ['compliance_type', 'days_late'],
      properties: {
        compliance_type: { type: 'string', enum: ['GST', 'TDS', 'MCA', 'PF', 'ESIC', 'INCOME_TAX', 'ROC', 'LABOUR', 'ENVIRONMENTAL', 'OTHER'] },
        days_late: { type: 'number' },
      },
    },
  },
]

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------
async function handleTool(
  name: string,
  args: Record<string, unknown>,
  orgId: string
): Promise<unknown> {
  const sb = getAdminClient()

  if (name === 'list_compliance_items') {
    let query = sb
      .from('compliance_items')
      .select(`id, title, description, compliance_type, status, priority, due_date, created_at, updated_at,
               departments(name), users!compliance_items_assigned_to_id_fkey(name, avatar_url)`)
      .eq('org_id', orgId)

    if (args.status) query = query.eq('status', args.status as string)
    if (args.compliance_type) query = query.eq('compliance_type', args.compliance_type as string)
    if (args.department_id) query = query.eq('department_id', args.department_id as string)
    if (args.search) query = query.ilike('title', `%${args.search}%`)

    const page = Number(args.page ?? 1)
    const limit = Math.min(100, Number(args.limit ?? 20))
    query = query.range((page - 1) * limit, page * limit - 1).order('due_date')

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return { items: data, page, limit }
  }

  if (name === 'get_compliance_stats') {
    const now = new Date().toISOString()
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString()

    const [total, overdue, completed, dueWeek, depts] = await Promise.all([
      sb.from('compliance_items').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
      sb.from('compliance_items').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'overdue'),
      sb.from('compliance_items').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'completed'),
      sb.from('compliance_items').select('id', { count: 'exact', head: true }).eq('org_id', orgId)
        .gte('due_date', now).lte('due_date', weekEnd).not('status', 'in', '("completed","not_applicable")'),
      sb.from('departments').select('id, name, compliance_items(status)').eq('org_id', orgId),
    ])

    return {
      total: total.count ?? 0,
      overdue: overdue.count ?? 0,
      completed: completed.count ?? 0,
      dueThisWeek: dueWeek.count ?? 0,
      byDepartment: (depts.data ?? []).map((d: Record<string, unknown>) => {
        const items = (d.compliance_items as Array<{ status: string }>) ?? []
        return {
          name: d.name,
          total: items.length,
          overdue: items.filter(i => i.status === 'overdue').length,
          completed: items.filter(i => i.status === 'completed').length,
        }
      }),
    }
  }

  if (name === 'get_overdue_items') {
    const { data, error } = await sb
      .from('compliance_items')
      .select('id, title, compliance_type, due_date, departments(name), users!compliance_items_assigned_to_id_fkey(name)')
      .eq('org_id', orgId)
      .eq('status', 'overdue')
      .order('due_date')

    if (error) throw new Error(error.message)

    const now = Date.now()
    return (data ?? []).map((item: Record<string, unknown>) => {
      const daysLate = Math.floor((now - new Date(item.due_date as string).getTime()) / 86400000)
      return {
        ...item,
        daysLate,
        penaltyEstimate: estimatePenalty(item.compliance_type as string, daysLate),
      }
    })
  }

  if (name === 'create_compliance_item') {
    const { data: org } = await sb.from('organisations').select('id').single()
    if (!org) throw new Error('Organisation not found')

    const { data, error } = await sb.from('compliance_items').insert({
      title: String(args.title),
      description: args.description ? String(args.description) : null,
      compliance_type: String(args.compliance_type),
      priority: String(args.priority ?? 'medium'),
      due_date: String(args.due_date),
      department_id: String(args.department_id),
      org_id: orgId,
      assigned_to_id: args.assigned_to_id ? String(args.assigned_to_id) : null,
    }).select('id, title, status').single()

    if (error) throw new Error(error.message)
    return data
  }

  if (name === 'update_compliance_status') {
    const { data, error } = await sb
      .from('compliance_items')
      .update({ status: String(args.status), updated_at: new Date().toISOString() })
      .eq('id', String(args.id))
      .eq('org_id', orgId)
      .select('id, title, status')
      .single()

    if (error) throw new Error(error.message)
    return data
  }

  if (name === 'list_departments') {
    const { data, error } = await sb
      .from('departments')
      .select('id, name, description')
      .eq('org_id', orgId)
      .order('name')

    if (error) throw new Error(error.message)
    return data
  }

  if (name === 'get_penalty_estimate') {
    return estimatePenalty(String(args.compliance_type), Number(args.days_late))
  }

  throw new Error(`Unknown tool: ${name}`)
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatcher
// ---------------------------------------------------------------------------
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

async function dispatch(body: Record<string, unknown>, orgId: string) {
  const { id, method, params } = body as {
    id: unknown
    method: string
    params: Record<string, unknown>
  }

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'Veridian AI MCP', version: '1.0.0' },
    })
  }

  if (method === 'notifications/initialized') {
    return null // notification — no response
  }

  if (method === 'ping') {
    return rpcResult(id, {})
  }

  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOL_DEFINITIONS })
  }

  if (method === 'tools/call') {
    const toolName = params?.name as string
    const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>
    try {
      const result = await handleTool(toolName, toolArgs, orgId)
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      })
    } catch (err) {
      return rpcError(id, -32000, (err as Error).message)
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`)
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const orgId = await resolveToken(req.headers.get('authorization'))
  if (!orgId) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Unauthorized — provide a valid Bearer token' } },
      { status: 401 }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 })
  }

  const response = await dispatch(body, orgId)
  if (response === null) return new NextResponse(null, { status: 204 })

  return NextResponse.json(response, {
    headers: { 'Content-Type': 'application/json' },
  })
}

// MCP clients probe with GET to discover the endpoint
export async function GET() {
  return NextResponse.json({
    name: 'Veridian AI MCP Server',
    version: '1.0.0',
    protocol: 'MCP 2024-11-05',
    transport: 'HTTP JSON-RPC 2.0',
    endpoint: '/api/mcp',
    auth: 'Bearer <access_token>',
    tools: TOOL_DEFINITIONS.map(t => t.name),
  })
}
