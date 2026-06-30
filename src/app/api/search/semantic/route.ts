import { NextRequest, NextResponse } from "next/server";
import { findSimilar } from "@/lib/embeddings";
import { db, complianceItems, notices, documents } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, limit = 10 } = body;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json(
        { error: "query is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    // Find similar embeddings
    const similarItems = await findSimilar(query.trim(), undefined, limit);

    // Fetch full entity data for each result
    const enrichedResults = await Promise.all(
      similarItems.map(async (item) => {
        try {
          if (item.entityType === "compliance_item") {
            const ci = await db.query.complianceItems.findFirst({
              where: eq(complianceItems.id, item.entityId),
              with: {
                department: { columns: { name: true } },
                assignedTo: { columns: { name: true } },
              },
            });
            if (!ci) return null;
            return {
              type: "compliance_item" as const,
              label: "Compliance Item",
              id: ci.id,
              title: ci.title,
              description: ci.description,
              complianceType: ci.complianceType,
              status: ci.status,
              priority: ci.priority,
              dueDate: ci.dueDate?.toISOString(),
              department: ci.department?.name,
              assignedTo: ci.assignedTo?.name,
              score: item.score,
              snippet: item.content.slice(0, 200),
            };
          }

          if (item.entityType === "notice") {
            const notice = await db.query.notices.findFirst({
              where: eq(notices.id, item.entityId),
              with: {
                department: { columns: { name: true } },
                assignedTo: { columns: { name: true } },
              },
            });
            if (!notice) return null;
            return {
              type: "notice" as const,
              label: "Notice",
              id: notice.id,
              title: notice.noticeNumber
                ? `Notice ${notice.noticeNumber}`
                : "Government Notice",
              description: notice.description,
              authority: notice.authority,
              status: notice.status,
              demandAmount: notice.demandAmount,
              replyDeadline: notice.replyDeadline?.toISOString(),
              department: notice.department?.name,
              assignedTo: notice.assignedTo?.name,
              score: item.score,
              snippet: item.content.slice(0, 200),
            };
          }

          if (item.entityType === "document") {
            const doc = await db.query.documents.findFirst({
              where: eq(documents.id, item.entityId),
              with: {
                uploadedBy: { columns: { name: true } },
              },
            });
            if (!doc) return null;
            return {
              type: "document" as const,
              label: "Document",
              id: doc.id,
              title: doc.name,
              fileType: doc.fileType,
              uploadedBy: doc.uploadedBy?.name,
              extractedData: doc.extractedData,
              score: item.score,
              snippet: item.content.slice(0, 200),
            };
          }

          // Unknown entity type — return basic info
          return {
            type: item.entityType,
            label: item.entityType.replace(/_/g, " "),
            id: item.entityId,
            title: item.content.slice(0, 80),
            score: item.score,
            snippet: item.content.slice(0, 200),
          };
        } catch {
          return null;
        }
      })
    );

    // Filter out nulls and group by type
    const results = enrichedResults.filter(Boolean) as NonNullable<
      (typeof enrichedResults)[number]
    >[];

    const grouped = {
      compliance_items: results.filter((r) => r.type === "compliance_item"),
      notices: results.filter((r) => r.type === "notice"),
      documents: results.filter((r) => r.type === "document"),
      other: results.filter(
        (r) =>
          r.type !== "compliance_item" &&
          r.type !== "notice" &&
          r.type !== "document"
      ),
    };

    return NextResponse.json({
      query: query.trim(),
      total: results.length,
      grouped,
      results,
    });
  } catch (error) {
    console.error("Semantic search error:", error);
    return NextResponse.json(
      { error: "Semantic search failed. pgvector extension may not be enabled." },
      { status: 500 }
    );
  }
}