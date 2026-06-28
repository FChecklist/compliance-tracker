import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import type { ComplianceStatus, Priority, AuditAction } from "@prisma/client";

const VALID_STATUSES: ComplianceStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "overdue",
  "not_applicable",
  "draft",
];

const VALID_PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

const VALID_ACTIONS: AuditAction[] = [
  "create",
  "update",
  "delete",
  "status_change",
  "assign",
  "reassign",
  "login",
  "logout",
  "export",
  "invite",
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
        assignedTo: {
          select: { name: true, avatarUrl: true },
        },
        auditPoints: {
          include: {
            assignedTo: { select: { name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        documents: {
          include: {
            uploadedBy: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        comments: {
          include: {
            author: { select: { name: true, avatarUrl: true } },
          },
          orderBy: { createdAt: "desc" },
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
        completedAt: item.completedAt?.toISOString(),
        departmentId: item.departmentId,
        department: { name: item.department.name },
        assignedTo: item.assignedTo
          ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl }
          : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
      auditPoints: item.auditPoints.map((ap) => ({
        id: ap.id,
        title: ap.title,
        description: ap.description,
        status: ap.status,
        dueDate: ap.dueDate?.toISOString(),
        completedAt: ap.completedAt?.toISOString(),
        assignedTo: ap.assignedTo ? { name: ap.assignedTo.name } : null,
        createdAt: ap.createdAt.toISOString(),
      })),
      documents: item.documents.map((doc) => ({
        id: doc.id,
        name: doc.name,
        fileUrl: doc.fileUrl,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        uploadedBy: { name: doc.uploadedBy.name },
        createdAt: doc.createdAt.toISOString(),
      })),
      comments: item.comments.map((c) => ({
        id: c.id,
        content: c.content,
        author: { name: c.author.name, avatarUrl: c.author.avatarUrl },
        createdAt: c.createdAt.toISOString(),
      })),
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
    const { title, description, status, priority, dueDate, assignedToId } = body;

    // Check item exists
    const existingItem = await db.complianceItem.findUnique({
      where: { id },
    });

    if (!existingItem) {
      return NextResponse.json(
        { error: "Compliance item not found" },
        { status: 404 }
      );
    }

    // Validate status if provided
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate priority if provided
    if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json(
        { error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}` },
        { status: 400 }
      );
    }

    // Get admin user for audit log
    const adminUser = await db.user.findFirst({ where: { role: "admin" } });
    if (!adminUser) {
      return NextResponse.json(
        { error: "No admin user found for audit logging" },
        { status: 500 }
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (title !== undefined && typeof title === "string") updateData.title = title.trim();
    if (description !== undefined) updateData.description = description;
    if (priority !== undefined) updateData.priority = priority;
    if (dueDate !== undefined) {
      if (dueDate === null) {
        updateData.dueDate = null;
      } else {
        const parsed = new Date(dueDate);
        if (!isNaN(parsed.getTime())) updateData.dueDate = parsed;
      }
    }
    if (assignedToId !== undefined) {
      if (assignedToId === null) {
        updateData.assignedTo = { disconnect: true };
      } else {
        updateData.assignedTo = { connect: { id: assignedToId } };
      }
    }
    if (status !== undefined) {
      updateData.status = status;
      if (status === "completed") updateData.completedAt = new Date();
    }

    const updatedItem = await db.$transaction(async (tx) => {
      const updated = await tx.complianceItem.update({
        where: { id },
        data: updateData,
        include: {
          department: { select: { name: true } },
          assignedTo: { select: { name: true, avatarUrl: true } },
        },
      });

      // Create audit log entries
      if (status !== undefined && status !== existingItem.status) {
        await tx.auditLog.create({
          data: {
            action: "status_change",
            entityType: "ComplianceItem",
            entityId: id,
            userId: adminUser.id,
            details: `Status changed from ${existingItem.status} to ${status}`,
          },
        });
      }

      if (assignedToId !== undefined && assignedToId !== existingItem.assignedToId) {
        await tx.auditLog.create({
          data: {
            action: existingItem.assignedToId ? "reassign" : "assign",
            entityType: "ComplianceItem",
            entityId: id,
            userId: adminUser.id,
            details: existingItem.assignedToId
              ? `Reassigned from previous user`
              : `Assigned to user ${assignedToId}`,
          },
        });
      }

      if (title !== undefined && title !== existingItem.title) {
        await tx.auditLog.create({
          data: {
            action: "update",
            entityType: "ComplianceItem",
            entityId: id,
            userId: adminUser.id,
            details: `Title updated`,
          },
        });
      }

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
      department: { name: updatedItem.department.name },
      assignedTo: updatedItem.assignedTo
        ? { name: updatedItem.assignedTo.name, avatarUrl: updatedItem.assignedTo.avatarUrl }
        : null,
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