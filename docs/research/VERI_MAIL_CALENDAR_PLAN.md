# VERI Mail & Calendar Implementation Plan

This document outlines a plan to implement 'VERI Mail' and 'VERI Calendar' features within VERIDIAN, leveraging the existing Composio OAuth connector infrastructure.

## 1. Composio Tool Actions

Integration will be built on top of the existing `gmail` and `googlecalendar` connectors. Actions will be executed via Composio's `execute` API endpoint, using the `connectedAccountId` stored in the `connector_accounts` table.

**Note:** Outbound network access to the Composio API is restricted in the current environment. The following tool slugs are inferred based on common API design patterns and could not be live-verified. **They must be confirmed against the Composio API documentation or by making live API calls before implementation.**

### Gmail (`gmail` toolkit)

*   **List emails:** `list_emails` (or similar)
*   **Read email:** `get_email` (with an `id` parameter)
*   **Send email:** `send_email` (with `to`, `subject`, and `body` parameters)

### Google Calendar (`googlecalendar` toolkit)

*   **List calendar events:** `list_events` (with `calendarId`, `timeMin`, `timeMax`)
*   **Create calendar event:** `create_event` (with `calendarId`, `summary`, `start`, `end`, `attendees`)
*   **Create meeting invite:** This is typically part of `create_event` by including `attendees` with email addresses, which automatically sends invites.

## 2. API Route Shape

The following minimal API routes are proposed. They would reuse the existing `requireAuth` and `withTenantContext` middleware to get the user's `connectedAccountId` for the respective toolkit.

### VERI Mail API

*   `GET /api/mail`: List emails in the user's inbox.
*   `GET /api/mail/:id`: Get the content of a specific email.
*   `POST /api/mail`: Send an email.

*Example Implementation:*
```typescript
// /api/mail/route.ts
import { executeTool } from "@/lib/composio"; // Assumes a new helper function

export async function GET(req) {
  const { connectedAccountId } = await getConnectedAccount("gmail");
  const emails = await executeTool(connectedAccountId, "list_emails", { limit: 20 });
  return NextResponse.json(emails);
}
```

### VERI Calendar API

*   `GET /api/calendar/events`: List calendar events for a given period.
*   `POST /api/calendar/events`: Create a new calendar event/meeting invite.

## 3. Recommendation Against Native Implementation

This plan explicitly recommends **AGAINST** building a native email server or a custom calendar data store. The core value proposition is to securely connect to the user's existing Google account via OAuth and act as a client. This approach avoids data duplication, security burdens of storing sensitive user credentials, and the immense complexity of building a full-fledged mail/calendar server. The existing Composio integration is the correct foundation for this feature.
