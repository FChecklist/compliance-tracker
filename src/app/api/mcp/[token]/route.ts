// R63 (owner directive, 2026-08-29): the server half of the per-user AI
// link. An external AI client (Claude.ai Connectors today; any
// MCP-compatible client as adoption spreads) adds this URL and gains two
// tools, scoped to exactly the one user this token resolves to -- reuses
// the REAL, already-live pipeline (src/lib/pipeline/run-submission.ts),
// not a parallel system.
//
// Stateless mode deliberately (sessionIdGenerator: undefined) -- this is a
// Vercel serverless function, nothing survives between invocations to hang
// a stateful session off of; the SDK's own docs name this the correct mode
// for exactly this deployment shape.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { resolveAiLinkToken } from '@/lib/ai-links/user-links'
import { runSubmission } from '@/lib/pipeline/run-submission'

async function buildServerFor(orgId: string, userId: string): Promise<McpServer> {
  const server = new McpServer({ name: 'veridian-ai-link', version: '1.0.0' })

  server.registerTool(
    'submit_task',
    {
      description:
        'Submit a task or question on behalf of this VERIDIAN/PROJEXA user. Handles both plain chat questions and real actions (e.g. "record 40% progress on PP1", "make a GST filing for ABC"). If required information is missing, the response will ask for it -- resubmit with the missing detail included.',
      inputSchema: {
        rawInput: z.string().describe('The task or question, in the user’s own words.'),
        mode: z.string().optional().describe('Which module this belongs to, e.g. "Projects". Defaults to "Projects" if omitted.'),
        projectId: z.string().optional().describe('A specific project id, if the task is scoped to one.'),
      },
    },
    async ({ rawInput, mode, projectId }) => {
      const result = await runSubmission({
        orgId,
        userId,
        mode: mode ?? 'Projects',
        projectId: projectId ?? null,
        rawInput,
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    },
  )

  server.registerTool(
    'ask',
    {
      description: 'Ask a plain question (no action taken) -- an alias for submit_task for a pure-chat query.',
      inputSchema: { question: z.string() },
    },
    async ({ question }) => {
      const result = await runSubmission({ orgId, userId, mode: 'Projects', projectId: null, rawInput: question })
      return { content: [{ type: 'text', text: result.chatMessages.join('\n') || JSON.stringify(result) }] }
    },
  )

  return server
}

async function handle(request: Request, token: string): Promise<Response> {
  const identity = await resolveAiLinkToken(token)
  if (!identity) {
    return new Response(JSON.stringify({ error: 'This AI link is invalid or has been revoked.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const server = await buildServerFor(identity.orgId, identity.userId)
  // Fresh transport per request, stateless mode -- matches the SDK's own
  // documented pattern for serverless/stateless deployments.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  return transport.handleRequest(request)
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return handle(request, token)
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return handle(request, token)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return handle(request, token)
}
