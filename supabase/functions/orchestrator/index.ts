/**
 * Groq Orchestrator — AI-OS Super Boss
 *
 * Supabase Edge Function (Deno). This is the always-on AI brain of Veridian AI.
 * It receives requests, selects the best Groq model for the task type, calls
 * MCP Server 1 (compliance data) and MCP Server 2 (dev dispatch) via tool use,
 * and returns a structured final response.
 *
 * Model routing strategy:
 *   orchestrate / chat / compliance_query → llama-3.3-70b-versatile (128k, best reasoning)
 *   quick_answer / summary / lookup      → llama-3.1-8b-instant      (fast, low cost)
 *   document_analysis / ocr / vision     → llama-3.2-90b-vision-preview (vision)
 *   deep_reasoning / legal / audit       → deepseek-r1-distill-llama-70b (CoT reasoning)
 *   code_review / dev_dispatch           → llama-3.3-70b-versatile   (code + planning)
 *   safety_check                         → llama-guard-3-8b          (moderation)
 *   bulk_analysis / long_doc             → llama-3.3-70b-versatile   (128k context)
 *
 * Auth: X-Internal-Secret (Groq orchestrator is internal) OR MCP Bearer token (customer chat)
 *
 * Coordination:
 *   This is the ONLY component that calls both MCP servers.
 *   Customers call MCP Server 1 directly via their AI clients.
 *   Dev agents (Claude Code, Z.ai) receive tasks via MCP Server 2 → GitHub dispatch.
 *   See MCP_PROTOCOL.md for full flow.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')!
const MCP_DEV_SECRET = Deno.env.get('MCP_DEV_SECRET')!
const ORCHESTRATOR_SECRET = Deno.env.get('MCP_DEV_SECRET')! // reuse same secret for simplicity
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MCP_DATA_URL = 'https://compliance-tracker-ai.vercel.app/api/mcp'
const MCP_DEV_URL = `${SUPABASE_URL.replace('https://', 'https://')}/functions/v1/mcp-dev`

// ---------------------------------------------------------------------------
// Model Registry — task type → Groq model
// ---------------------------------------------------------------------------
const GROQ_BASE = 'https://api.groq.com/openai/v1'

type TaskType =
  | 'orchestrate'
  | 'compliance_query'
  | 'quick_answer'
  | 'summary'
  | 'document_analysis'
  | 'deep_reasoning'
  | 'legal_analysis'
  | 'audit'
  | 'code_review'
  | 'dev_dispatch'
  | 'bulk_analysis'
  | 'safety_check'
  | 'chat'

interface ModelConfig {
  model: string
  maxTokens: number
  temperature: number
  description: string
}

const MODEL_REGISTRY: Record<TaskType, ModelConfig> = {
  // Primary orchestrator — best reasoning, 128k context
  orchestrate: { model: 'llama-3.3-70b-versatile', maxTokens: 4096, temperature: 0.3, description: 'Main orchestration and routing decisions' },
  compliance_query: { model: 'llama-3.3-70b-versatile', maxTokens: 4096, temperature: 0.2, description: 'Compliance questions requiring context' },
  chat: { model: 'llama-3.3-70b-versatile', maxTokens: 2048, temperature: 0.5, description: 'General conversational queries' },
  bulk_analysis: { model: 'llama-3.3-70b-versatile', maxTokens: 8192, temperature: 0.2, description: 'Large dataset analysis using 128k window' },

  // Fast tier — simple lookups and summaries
  quick_answer: { model: 'llama-3.1-8b-instant', maxTokens: 1024, temperature: 0.1, description: 'Fast factual answers and lookups' },
  summary: { model: 'llama-3.1-8b-instant', maxTokens: 1024, temperature: 0.2, description: 'Quick document or item summaries' },

  // Vision — document OCR and image analysis
  document_analysis: { model: 'llama-3.2-90b-vision-preview', maxTokens: 4096, temperature: 0.1, description: 'Document OCR, invoice analysis, govt notices' },

  // Deep reasoning — penalty calculations, legal interpretation
  deep_reasoning: { model: 'deepseek-r1-distill-llama-70b', maxTokens: 8192, temperature: 0.1, description: 'Complex multi-step reasoning with chain of thought' },
  legal_analysis: { model: 'deepseek-r1-distill-llama-70b', maxTokens: 8192, temperature: 0.1, description: 'Legal and regulatory interpretation' },
  audit: { model: 'deepseek-r1-distill-llama-70b', maxTokens: 8192, temperature: 0.0, description: 'Systematic compliance audit with CoT' },

  // Dev tier — code and task planning
  code_review: { model: 'llama-3.3-70b-versatile', maxTokens: 4096, temperature: 0.1, description: 'PR review and architecture decisions' },
  dev_dispatch: { model: 'llama-3.3-70b-versatile', maxTokens: 2048, temperature: 0.2, description: 'Translating intent to dev task specifications' },

  // Safety
  safety_check: { model: 'llama-guard-3-8b', maxTokens: 512, temperature: 0.0, description: 'Content safety and moderation' },
}

// ---------------------------------------------------------------------------
// MCP tool definitions (passed to Groq as function_tools for tool calling)
// ---------------------------------------------------------------------------
const DATA_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_compliance_stats',
      description: 'Get dashboard statistics: total, overdue, completed counts and department breakdown.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_overdue_items',
      description: 'List all overdue compliance items with days past due and penalty estimates.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_compliance_items',
      description: 'List compliance items with optional filters.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'overdue', 'not_applicable', 'draft'] },
          compliance_type: { type: 'string', enum: ['GST', 'TDS', 'MCA', 'PF', 'ESIC', 'INCOME_TAX', 'ROC', 'LABOUR', 'ENVIRONMENTAL', 'OTHER'] },
          search: { type: 'string' },
          limit: { type: 'number' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_compliance_item',
      description: 'Create a new compliance item in the system.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          compliance_type: { type: 'string' },
          department_id: { type: 'string' },
          due_date: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          description: { type: 'string' },
        },
        required: ['title', 'compliance_type', 'department_id', 'due_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_compliance_status',
      description: 'Update the status of a compliance item.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'overdue', 'not_applicable', 'draft'] },
        },
        required: ['id', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_penalty_estimate',
      description: 'Calculate estimated penalty for a compliance type given days late.',
      parameters: {
        type: 'object',
        properties: {
          compliance_type: { type: 'string' },
          days_late: { type: 'number' },
        },
        required: ['compliance_type', 'days_late'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_departments',
      description: 'List all departments in the organisation.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

const DEV_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_claude_task',
      description: 'Dispatch an architecture/backend/security task to Claude Code agent via GitHub.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          files_hint: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_zai_task',
      description: 'Dispatch a frontend/UI/full-stack task to Z.ai agent via GitHub.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          files_hint: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_board_status',
      description: 'Check the AI agent task board (BOARD.yaml) for open tasks before dispatching new ones.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'health_check',
      description: 'Verify the platform (Vercel app + Supabase DB) is healthy.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

// ---------------------------------------------------------------------------
// MCP caller helpers
// ---------------------------------------------------------------------------
async function callMcpData(toolName: string, args: Record<string, unknown>, mcpToken: string): Promise<unknown> {
  const res = await fetch(MCP_DATA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mcpToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  })
  const json = await res.json() as { result?: { content?: Array<{ text: string }> }; error?: { message: string } }
  if (json.error) throw new Error(json.error.message)
  const text = json.result?.content?.[0]?.text ?? '{}'
  return JSON.parse(text)
}

async function callMcpDev(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(MCP_DEV_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': MCP_DEV_SECRET,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  })
  const json = await res.json() as { result?: { content?: Array<{ text: string }> }; error?: { message: string } }
  if (json.error) throw new Error(json.error.message)
  const text = json.result?.content?.[0]?.text ?? '{}'
  return JSON.parse(text)
}

// Execute a tool call from Groq — route to correct MCP server
async function executeTool(name: string, args: Record<string, unknown>, mcpToken: string): Promise<string> {
  const DEV_TOOL_NAMES = new Set(['create_claude_task', 'create_zai_task', 'get_board_status', 'health_check', 'get_deployment_status'])
  try {
    const result = DEV_TOOL_NAMES.has(name)
      ? await callMcpDev(name, args)
      : await callMcpData(name, args, mcpToken)
    return JSON.stringify(result)
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message })
  }
}

// ---------------------------------------------------------------------------
// Groq Chat Completions with agentic tool-call loop
// ---------------------------------------------------------------------------
interface GroqMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

async function runGroqAgent(
  config: ModelConfig,
  systemPrompt: string,
  userMessage: string,
  tools: typeof DATA_TOOLS,
  mcpToken: string,
  maxRounds = 5
): Promise<{ response: string; toolCalls: number; model: string }> {
  const messages: GroqMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  let totalToolCalls = 0

  for (let round = 0; round < maxRounds; round++) {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
    }

    // llama-guard doesn't support tools
    if (config.model !== 'llama-guard-3-8b' && tools.length > 0) {
      body.tools = tools
      body.tool_choice = 'auto'
    }

    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Groq API error (${res.status}): ${err}`)
    }

    const completion = await res.json() as {
      choices: Array<{
        message: {
          role: string
          content: string | null
          tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
        }
        finish_reason: string
      }>
    }

    const choice = completion.choices[0]
    const msg = choice.message

    messages.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls })

    // No tool calls — final answer
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { response: msg.content ?? '', toolCalls: totalToolCalls, model: config.model }
    }

    // Execute each tool call and append results
    for (const tc of msg.tool_calls) {
      totalToolCalls++
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.function.arguments) } catch { /* ignore */ }

      const result = await executeTool(tc.function.name, args, mcpToken)
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.function.name,
        content: result,
      })
    }
  }

  // Hit max rounds — return last assistant message
  const last = messages.filter(m => m.role === 'assistant').pop()
  return { response: last?.content ?? 'Max reasoning rounds reached.', toolCalls: totalToolCalls, model: config.model }
}

// ---------------------------------------------------------------------------
// Task type → model + tools + system prompt
// ---------------------------------------------------------------------------
function buildRequest(taskType: TaskType, message: string, context?: Record<string, unknown>) {
  const config = MODEL_REGISTRY[taskType] ?? MODEL_REGISTRY.chat

  const baseSystem = `You are the Groq Orchestrator for Veridian AI — an AI-Native compliance management platform for Indian businesses.
You have access to tools that read and write compliance data, and tools that dispatch development tasks to AI agents.
Always cite the specific compliance items, types, and due dates when answering. Be precise about deadlines and penalties.
Current date: ${new Date().toISOString().slice(0, 10)}.
${context ? `Context: ${JSON.stringify(context)}` : ''}`

  const systemPrompts: Partial<Record<TaskType, string>> = {
    audit: `${baseSystem}
You are performing a systematic compliance audit. Use chain-of-thought reasoning.
Check every compliance type, identify gaps, calculate total penalty exposure, and prioritise by risk.`,

    legal_analysis: `${baseSystem}
You are analysing Indian tax and compliance law. Cite specific sections and circulars where relevant.
Use step-by-step reasoning. Do not guess — flag uncertainty explicitly.`,

    deep_reasoning: `${baseSystem}
Think step by step. Show your working. Break complex problems into sub-problems before synthesising.`,

    dev_dispatch: `${baseSystem}
You are translating a feature request or bug report into a precise development task.
Check the board status first. Route backend/architecture to Claude Code; frontend/UI to Z.ai.
Write acceptance criteria that an AI agent can verify programmatically.`,

    safety_check: 'Classify the following content as safe or unsafe for a compliance management platform.',

    document_analysis: `${baseSystem}
Analyse the document. Extract: document type, relevant dates, amounts, compliance type, required action, deadline.
Return structured JSON.`,
  }

  const toolSets: Partial<Record<TaskType, typeof DATA_TOOLS>> = {
    dev_dispatch: [...DATA_TOOLS, ...DEV_TOOLS],
    code_review: [...DATA_TOOLS, ...DEV_TOOLS],
    orchestrate: [...DATA_TOOLS, ...DEV_TOOLS],
    safety_check: [],
    quick_answer: [],
    summary: DATA_TOOLS,
  }

  return {
    config,
    systemPrompt: systemPrompts[taskType] ?? baseSystem,
    tools: toolSets[taskType] ?? DATA_TOOLS,
  }
}

// ---------------------------------------------------------------------------
// Auth — Bearer token → org_id (for customer-facing calls)
// ---------------------------------------------------------------------------
async function resolveCustomerToken(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'compliance' } })
  const { data } = await sb.from('mcp_access_codes').select('org_id, is_active').eq('token', token).single()
  return data?.is_active ? data.org_id : null
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Internal-Secret',
      },
    })
  }

  if (req.method === 'GET') {
    return new Response(JSON.stringify({
      name: 'Veridian AI Groq Orchestrator',
      version: '1.0.0',
      models: Object.fromEntries(
        Object.entries(MODEL_REGISTRY).map(([k, v]) => [k, { model: v.model, description: v.description }])
      ),
      auth: 'X-Internal-Secret (internal) OR Authorization: Bearer <token> (customer)',
    }), { headers: { 'Content-Type': 'application/json' } })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Auth — accept internal secret OR customer Bearer token
  const internalSecret = req.headers.get('x-internal-secret')
  const authHeader = req.headers.get('authorization')
  let mcpToken = ''
  let isInternal = false

  if (internalSecret && internalSecret === ORCHESTRATOR_SECRET) {
    isInternal = true
    mcpToken = Deno.env.get('MCP_DATA_TOKEN') ?? ''
  } else {
    const orgId = await resolveCustomerToken(authHeader)
    if (!orgId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    mcpToken = authHeader!.slice(7).trim() // customer uses their own token
  }

  let body: { type?: string; message: string; context?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  const taskType = (body.type ?? 'chat') as TaskType
  const message = body.message
  if (!message) {
    return new Response(JSON.stringify({ error: 'message is required' }), { status: 400 })
  }

  try {
    const { config, systemPrompt, tools } = buildRequest(taskType, message, body.context)

    // Safety check runs first for external (customer) requests
    if (!isInternal) {
      const safetyResult = await runGroqAgent(
        MODEL_REGISTRY.safety_check,
        'Classify the following as safe or unsafe for a business compliance platform.',
        message,
        [],
        mcpToken,
        1
      )
      if (safetyResult.response.toLowerCase().includes('unsafe')) {
        return new Response(JSON.stringify({
          error: 'Content flagged as unsafe',
          safetyModel: safetyResult.model,
        }), { status: 400 })
      }
    }

    const startMs = Date.now()
    const result = await runGroqAgent(config, systemPrompt, message, tools, mcpToken)
    const durationMs = Date.now() - startMs

    return new Response(JSON.stringify({
      response: result.response,
      meta: {
        taskType,
        model: result.model,
        toolCalls: result.toolCalls,
        durationMs,
        isInternal,
      },
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('Orchestrator error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
