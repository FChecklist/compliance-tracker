# FChecklist GitHub Secrets Reference
# Updated: 2026-06-28
# ALL sensitive credentials stored as GitHub Secrets. Never hardcode.

## Common secrets on all 3 repos
PAT_FCHECKLIST, ZAI_API_KEY, ZAI_BASE_URL, VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID,
SUPABASE_PAT, COMPOSIO_API_KEY, COMPOSIO_ORG_ID, COMPOSIO_PROJECT_ID, COMPOSIO_USER_ID,
COMPOSIO_ENTITY_ID, COMPOSIO_YOUTUBE_CONN, COMPOSIO_GDRIVE_CONN, ORSHOT_API_KEY, ORSHOT_MCP_URL,
ACTIVEPIECES_MCP_URL, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_FOLDER_ID,
GRAPHY_MID, GRAPHY_API_KEY, GRAPHY_API_BASE_URL

## Repo-specific — see full reference in meettrack-v2/ai-os/secrets/SECRETS_REFERENCE.md

## Pending (need from user): ANTHROPIC_API_KEY, OPENAI_API_KEY

## MCP URLs
- Orshot MCP: https://mcp.orshot.com/mcp (auth: Bearer ORSHOT_API_KEY)
- Activepieces MCP: https://cloud.activepieces.com/mcp
- Z.ai: https://api.z.ai/api/openai/v1 (auth: Bearer ZAI_API_KEY)
