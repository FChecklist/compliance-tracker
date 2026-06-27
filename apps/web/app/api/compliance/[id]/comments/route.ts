import { NextRequest, NextResponse } from "next/server";
import { db } from "@compliance/db";
import { comments, users } from "@compliance/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({ body: z.string().min(1).max(5000), parent_comment_id: z.string().uuid().optional() });

// GET /api/compliance/[id]/comments
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let userId = "";
  try {
    const { verifySessionToken } = await import("@/lib/auth/jwt");
    const payload = await verifySessionToken(token);
    userId = payload?.sub ?? "";
  } catch { return NextResponse.json({ error: "Invalid token" }, { status: 401 }); }
  const rows = await db.select({
    id: comments.id, body: comments.body, author_id: comments.author_id,
    parent_comment_id: comments.parent_comment_id, created_at: comments.created_at, author_name: users.full_name,
  }).from(comments).leftJoin(users, eq(comments.author_id, users.id))
    .where(eq(comments.compliance_id, id)).orderBy(desc(comments.created_at));
  return NextResponse.json({ comments: rows });
}

// POST /api/compliance/[id]/comments
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let userId = "";
  try {
    const { verifySessionToken } = await import("@/lib/auth/jwt");
    const payload = await verifySessionToken(token);
    userId = payload?.sub ?? "";
  } catch { return NextResponse.json({ error: "Invalid token" }, { status: 401 }); }
  const body = createSchema.parse(await req.json());
  const [created] = await db.insert(comments).values({
    compliance_id: id, author_id: userId, body: body.body, parent_comment_id: body.parent_comment_id ?? null,
  }).returning();
  return NextResponse.json({ comment: created }, { status: 201 });
}