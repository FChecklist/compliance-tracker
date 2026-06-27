import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { compliance } from "@compliancetrack/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  // Export is auth-gated below, but we need to check format param
  const { searchParams } = req.nextUrl;
  const format = searchParams.get("format") || "csv";

  if (format === "csv") return handleCSV(req);
  if (format === "json") return handleJSON(req);
  return NextResponse.json({ error: "Unsupported format. Use csv or json." }, { status: 400 });
}

async function handleCSV(req: NextRequest) {
  // Import auth inline to avoid circular deps
  const { verifySessionToken } = await import("@/lib/auth/jwt");
  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = await verifySessionToken(token);
  if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const rows = await db.select().from(compliance).where(eq(compliance.org_id, payload.org_id as string));

  const header = "Title,Type,Status,Priority,Assignee,Due Date,Created At";
  const csvRows = rows.map((r) =>
    [
      `"${(r.title || "").replace(/"/g, '""')}"`,
      r.compliance_type,
      r.status,
      r.priority,
      r.assignee_id || "",
      r.due_date ? new Date(r.due_date).toISOString().split("T")[0] : "",
      r.created_at ? new Date(r.created_at).toISOString().split("T")[0] : "",
    ].join(",")
  );

  const csv = [header, ...csvRows].join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="compliance-export-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}

async function handleJSON(req: NextRequest) {
  const { verifySessionToken } = await import("@/lib/auth/jwt");
  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = await verifySessionToken(token);
  if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const rows = await db.select().from(compliance).where(eq(compliance.org_id, payload.org_id as string));
  return new NextResponse(JSON.stringify(rows, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="compliance-export-${new Date().toISOString().split("T")[0]}.json"`,
    },
  });
}