import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import type { AuditAction } from "@prisma/client";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const userId = searchParams.get("userId") || "";
    const action = searchParams.get("action") || "";
    const entityType = searchParams.get("entityType") || "";
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};

    if (userId) {
      where.userId = userId;
    }

    if (action) {
      where.action = action as AuditAction;
    }

    if (entityType) {
      where.entityType = entityType;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        (where.createdAt as Prisma.DateTimeNullableFilter).gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setDate(end.getDate() + 1);
        (where.createdAt as Prisma.DateTimeNullableFilter).lt = end;
      }
    }

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        include: {
          user: {
            select: { name: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.auditLog.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      auditLogs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        details: log.details,
        userName: log.user.name,
        createdAt: log.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages,
    });
  } catch (error) {
    console.error("Audit API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch audit logs" },
      { status: 500 }
    );
  }
}