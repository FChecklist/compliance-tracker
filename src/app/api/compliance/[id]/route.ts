import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import type { ComplianceStatus } from "@prisma/client";

const VALID_STATUSES: ComplianceStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "overdue",
  "not_applicable",
];

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    const item = await db.complianceItem.findUnique({
      where: { id },
      include: {
        department: {
          select: { name: true },
        },
      },
    });

    if (!item) {
      return NextResponse.json(
        { error: "Compliance item not found" },
        { status: 404 }
      );
    }

    // Fetch audit logs for this item
    const auditLogs = await db.auditLog.findMany({
      where: {
        entityId: id,
        entityType: "ComplianceItem",
      },
      include: {
        user: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      item: {
        id: item.id,
        title: item.title,
        description: item.description,
        complianceType: item.complianceType,
        status: item.status,
        priority: item.priority,
        dueDate: item.dueDate?.toISOString(),
        departmentId: item.departmentId,
        department: { name: item.department.name },
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
      auditLogs: auditLogs.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        details: log.details,
        userName: log.user.name,
        createdAt: log.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Compliance detail API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch compliance item" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const { status } = body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    // Check item exists and get current status
    const existingItem = await db.complianceItem.findUnique({
      where: { id },
    });

    if (!existingItem) {
      return NextResponse.json(
        { error: "Compliance item not found" },
        { status: 404 }
      );
    }

    if (existingItem.status === status) {
      return NextResponse.json(
        { error: "Status is already set to the requested value" },
        { status: 400 }
      );
    }

    const oldStatus = existingItem.status;
    const newStatus = status;

    // Get a default user for audit log (first admin user)
    const adminUser = await db.user.findFirst({ where: { role: "admin" } });
    if (!adminUser) {
      return NextResponse.json(
        { error: "No admin user found for audit logging" },
        { status: 500 }
      );
    }

    // Update status and create audit log in a transaction
    const updatedItem = await db.$transaction(async (tx) => {
      const updated = await tx.complianceItem.update({
        where: { id },
        data: { status: newStatus },
        include: {
          department: { select: { name: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          action: "status_changed",
          entityType: "ComplianceItem",
          entityId: id,
          userId: adminUser.id,
          details: `Status changed from ${oldStatus} to ${newStatus}`,
        },
      });

      return updated;
    });

    return NextResponse.json({
      id: updatedItem.id,
      title: updatedItem.title,
      description: updatedItem.description,
      complianceType: updatedItem.complianceType,
      status: updatedItem.status,
      priority: updatedItem.priority,
      dueDate: updatedItem.dueDate?.toISOString(),
      departmentId: updatedItem.departmentId,
      department: { name: updatedItem.department.name },
      createdAt: updatedItem.createdAt.toISOString(),
      updatedAt: updatedItem.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Compliance update API error:", error);
    return NextResponse.json(
      { error: "Failed to update compliance item" },
      { status: 500 }
    );
  }
}