import { db } from "@compliancetrack/db";
import { auditLog } from "@compliancetrack/db/schema";

interface LogEntry {
  org_id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  ip_address?: string | null;
  machine_id?: string | null;
  metadata?: Record<string, unknown>;
}

export async function createAuditLog(entry: LogEntry): Promise<void> {
  await db.insert(auditLog).values({
    org_id: entry.org_id,
    user_id: entry.user_id,
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    ip_address: entry.ip_address ?? null,
    machine_id: entry.machine_id ?? null,
    metadata: entry.metadata ?? {},
  });
}

export function extractRequestInfo(request: Request): { ip: string; machineId: string } {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") || "unknown";
  const machineId = request.headers.get("x-machine-id") || "unknown";
  return { ip, machineId: machineId };
}
