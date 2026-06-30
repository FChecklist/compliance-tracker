/**
 * MCP Server 2 — Internal Dev Dispatch
 *
 * Supabase Edge Function (Deno). Speaks JSON-RPC 2.0 (MCP protocol).
 * Auth: X-Internal-Secret header → must match MCP_DEV_SECRET env var.
 * This server is INTERNAL ONLY — not exposed to customers.
 *
 * Caller: Groq orchestrator (Llama 3.3 70B) when it needs to:
 *   - Dispatch a development task to Claude Code or Z.ai
 *   - Check the current state of the BOARD
 *   - Run a health check on the live platform
 *
 * Tools exposed:
 *   create_claude_task, create_zai_task,
 *   get_board_status, health_check, get_deployment_status
 *
 * Coordination with MCP Server 1:
 *   - This server handles DEVELOPMENT actions (GitHub dispatch, board ops).
 *   - MCP Server 1 handles COMPLIANCE DATA actions (read/write Supabase).
 *   - Neither server calls the other. Groq orchestrator calls both.
 * See MCP_PROTOCOL.md for full coordination specification.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GITHUB_PAT = Deno.env.get('PAT_FCHECKLIST')!
const MCP_DEV_SECRET = Deno.env.get('MCP_DEV_SECRET')!
const GITHUB_REPO = 'FChecklist/compliance-tracker'
const APP_URL = 'https://compliance-tracker-ai.vercel.app'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function isAuthorized(req: Request): boolean {
  const secret = req.headers.get('x-internal-secret')
  return !!MCP_DEV_SECRET && secret === MCP_DEV_SECRET
}

// ---------------------------------------------------------------------------
// GitHub repository_dispatch
// ---------------------------------------------------------------------------
async function fireDispatch(eventType: 'claude-task' | 'zai-task', payload: unknown): Promise<{ dispatched: boolean; eventType: string }> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Veridian AI-Orchestrator/1.0',
    },
    body: JSON.stringify({ event_type: eventType, client_payload: payload }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub dispatch failed (${res.status}): ${text}`)
  }

  return { dispatched: true, eventType }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const TOOL_DEFINITIONS = [
  {
    name: 'create_claude_task',
    description: 'Dispatch a development task to Claude Code via GitHub repository_dispatch. Use for architecture decisions, backend work, security fixes, DB migrations, and code reviews.',
    inputSchema: {
      type: 'object',
      required: ['title', 'description'],
      properties: {
        title: { type: 'string', description: 'Short task title (will become BOARD entry)' },
        description: { type: 'string', description: 'Full task description with acceptance criteria' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
        files_hint: { type: 'array', items: { type: 'string' }, description: 'File paths the agent should focus on' },
      },
    },
  },
  {
    name: 'create_zai_task',
    description: 'Dispatch a development task to Z.ai (GLM) via GitHub repository_dispatch. Use for frontend features, UI components, API route additions, and full-stack features.',
    inputSchema: {
      type: 'object',
      required: ['title', 'description'],
      properties: {
        title: { type: 'string', description: 'Short task title' },
        description: { type: 'string', description: 'Full task description with acceptance criteria' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
        files_hint: { type: 'array', items: { type: 'string' }, description: 'File paths the agent should focus on' },
      },
    },
  },
  {
    name: 'health_check',
    description: 'Ping the live platform and Supabase to verify everything is up.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_board_status',
    description: 'Fetch the current BOARD.yaml task list from GitHub to see open, in-progress, and completed AI tasks.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_deployment_status',
    description: 'Get the latest deployment status from the GitHub Actions CI workflow.',
    inputSchema: { type: 'object', properties: {} },
  },
]

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------
async function handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'create_claude_task') {
    return fireDispatch('claude-task', {
      title: args.title,
      description: args.description,
      priority: args.priority ?? 'medium',
      files_hint: args.files_hint ?? [],
      source: 'groq-orchestrator',
      timestamp: new Date().toISOString(),
    })
  }

  if (name === 'create_zai_task') {
    return fireDispatch('zai-task', {
      title: args.title,
      description: args.description,
      priority: args.priority ?? 'medium',
      files_hint: args.files_hint ?? [],
      source: 'groq-orchestrator',
      timestamp: new Date().toISOString(),
    })
  }

  if (name === 'health_check') {
    const [appPing, dbPing] = await Promise.allSettled([
      fetch(`${APP_URL}/api/health`, { signal: AbortSignal.timeout(5000) }),
      createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'compliance' } })
        .from('organisations')
        .select('id', { count: 'exact', head: true }),
    ])

    return {
      app: appPing.status === 'fulfilled' ? { ok: appPing.value.ok, status: appPing.value.status } : { ok: false, error: String((appPing as PromiseRejectedResult).reason) },
      database: dbPing.status === 'fulfilled' ? { ok: !dbPing.value.error } : { ok: false, error: String((dbPing as PromiseRejectedResult).reason) },
      checkedAt: new Date().toISOString(),
    }
  }

  if (name === 'get_board_status') {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/ai-os/boss/BOARD.yaml`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_PAT}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Veridian AI-Orchestrator/1.0',
        },
      }
    )
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
    const json = await res.json() as { content: string }
    const content = atob(json.content.replace(/\n/g, ''))
    return { board: content, fetchedAt: new Date().toISOString() }
  }

  if (name === 'get_deployment_status') {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/runs?per_page=5&status=completed`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_PAT}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Veridian AI-Orchestrator/1.0',
        },
      }
    )
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
    const json = await res.json() as { workflow_runs: Array<{ id: number; name: string; status: string; conclusion: string; created_at: string; html_url: string }> }
    return {
      runs: json.workflow_runs.map(r => ({
        id: r.id,
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        createdAt: r.created_at,
        url: r.html_url,
      })),
    }
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

async function dispatch(body: Record<string, unknown>) {
  const { id, method, params } = body as {
    id: unknown
    method: string
    params: Record<string, unknown>
  }

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'Veridian AI Dev-MCP', version: '1.0.0' },
    })
  }

  if (method === 'notifications/initialized' || method === 'ping') {
    return method === 'ping' ? rpcResult(id, {}) : null
  }

  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOL_DEFINITIONS })
  }

  if (method === 'tools/call') {
    const toolName = (params?.name as string)
    const toolArgs = ((params?.arguments ?? {}) as Record<string, unknown>)
    try {
      const result = await handleTool(toolName, toolArgs)
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
// Entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Internal-Secret',
      },
    })
  }

  if (req.method === 'GET') {
    return new Response(JSON.stringify({
      name: 'Veridian AI Dev-MCP',
      version: '1.0.0',
      protocol: 'MCP 2024-11-05',
      transport: 'HTTP JSON-RPC 2.0',
      auth: 'X-Internal-Secret header',
      access: 'INTERNAL ONLY — Groq orchestrator use',
      tools: TOOL_DEFINITIONS.map(t => t.name),
    }), { headers: { 'Content-Type': 'application/json' } })
  }

  if (!isAuthorized(req)) {
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Unauthorized' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(
      JSON.stringify(rpcError(null, -32700, 'Parse error')),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const responseBody = await dispatch(body)
  if (responseBody === null) return new Response(null, { status: 204 })

  return new Response(JSON.stringify(responseBody), {
    headers: { 'Content-Type': 'application/json' },
  })
})
