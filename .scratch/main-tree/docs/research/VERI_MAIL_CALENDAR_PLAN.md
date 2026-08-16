# VERI Mail & Calendar Implementation Plan

This document outlines a plan to implement 'VERI Mail' and 'VERI Calendar' features within VERIDIAN, leveraging the existing Composio OAuth connector infrastructure.

## 1. Composio Tool Actions

Integration will be built on top of the existing `gmail` and `googlecalendar` connectors. Actions will be executed via Composio's `execute` API endpoint, using the `connectedAccountId` stored in the `connector_accounts` table.

**Update (2026-07-07):** the AI Workforce agent's CI runner had no live network access to Composio, so it correctly flagged the slugs below as unverified. Verified live afterward against `https://backend.composio.dev/api/v3/tools?toolkit_slug=gmail` and `toolkit_slug=googlecalendar` -- real slugs, not inferred:

### Gmail (`gmail` toolkit) -- verified slugs

*   **List/search emails:** `GMAIL_FETCH_EMAILS`
*   **Read one email:** `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID` (also `GMAIL_FETCH_MESSAGE_BY_THREAD_ID` for a whole thread)
*   **Send email:** `GMAIL_SEND_EMAIL` (drafts: `GMAIL_LIST_DRAFTS` / `GMAIL_SEND_DRAFT`)
*   **Labels:** `GMAIL_LIST_LABELS`

### Google Calendar (`googlecalendar` toolkit) -- verified slugs

*   **List calendars:** `GOOGLECALENDAR_LIST_CALENDARS`
*   **List events:** `GOOGLECALENDAR_EVENTS_LIST`
*   **Find a specific event:** `GOOGLECALENDAR_FIND_EVENT`
*   **Create event / meeting invite:** `GOOGLECALENDAR_CREATE_EVENT` (attendees on this call trigger real Google Calendar invite emails)
*   **Update / move / delete:** `GOOGLECALENDAR_UPDATE_EVENT`, `GOOGLECALENDAR_PATCH_EVENT`, `GOOGLECALENDAR_EVENTS_MOVE`, `GOOGLECALENDAR_DELETE_EVENT`

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
