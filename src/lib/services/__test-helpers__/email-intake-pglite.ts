// PROJEXA-BUILD-002 WP-12: the database double of the way-4 (email) tests. It is the from-document PGlite harness (real Postgres compiled
// to WASM: products, source_object with the job columns, projects, BOQs, users) plus the one table the email path reads,
// compliance.inbound_email_attachments, with the columns and the size CHECK of drizzle/0620 and without its foreign key (the message
// table is not part of this harness; the webhook route's own test runs the real 0620 file against the real message table).
import { createExtractionPglite } from "./document-extraction-pglite"

const INBOUND_ATTACHMENTS_SQL = `
CREATE TABLE compliance.inbound_email_attachments (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  org_id text NOT NULL,
  inbound_message_id text NOT NULL,
  file_name text NOT NULL,
  content_type text,
  size_bytes integer NOT NULL,
  content bytea NOT NULL,
  resend_attachment_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT inbound_email_attachments_size_check CHECK (size_bytes = octet_length(content) AND size_bytes <= 10485760)
);
`

/** The from-document harness plus compliance.inbound_email_attachments. Same return shape as createExtractionPglite(). */
export async function createEmailIntakePglite() {
  const h = await createExtractionPglite()
  await h.pg.exec(INBOUND_ATTACHMENTS_SQL)
  return h
}

/** Stores one attachment for a message, as the webhook's attachment step would have. Returns its id. */
export async function insertAttachment(
  h: Awaited<ReturnType<typeof createEmailIntakePglite>>,
  row: { id: string; org_id: string; message_id: string; file_name: string; content: Uint8Array; content_type?: string | null },
): Promise<string> {
  await h.pg.query(
    "insert into compliance.inbound_email_attachments (id, org_id, inbound_message_id, file_name, content_type, size_bytes, content, resend_attachment_id) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [row.id, row.org_id, row.message_id, row.file_name, row.content_type ?? null, row.content.byteLength, row.content, `resend-${row.id}`],
  )
  return row.id
}
