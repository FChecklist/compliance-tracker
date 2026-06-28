import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import type { ComplianceStatus, Priority, ComplianceType } from "@prisma/client";

const VALID_STATUSES: ComplianceStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "overdue",
  "not_applicable",
  "draft",
];

const VALID_PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

const VALID_TYPES: ComplianceType[] = [
  "GST",
  "TDS",
  "MCA",
  "PF",
  "ESIC",
  "INCOME_TAX",
  "ROC",
  "LABOUR",
  "ENVIRONMENTAL",
  "OTHER",
];

const SORTABLE_FIELDS = ["dueDate", "createdAt", "title"] as const;
type SortField = (typeof SORTABLE_FIELDS)[number];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "";
    const departmentId = searchParams.get("departmentId") || "";
    const complianceType = searchParams.get("complianceType") || "";
    const sortBy = (searchParams.get("sort") || "dueDate") as SortField;
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.ComplianceItemWhereInput = {};

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
        { complianceType: { contains: search } },
      ];
    }

    if (status && VALID_STATUSES.includes(status as ComplianceStatus)) {
      where.status = status as ComplianceStatus;
    }

    if (departmentId) {
      where.departmentId = departmentId;
    }

    if (complianceType && VALID_TYPES.includes(complianceType as ComplianceType)) {
      where.complianceType = complianceType as ComplianceType;
    }

    const safeSortBy = SORTABLE_FIELDS.includes(sortBy) ? sortBy : "dueDate";

    const [items, total] = await Promise.all([
      db.complianceItem.findMany({
        where,
        include: {
          department: { select: { name: true } },
          assignedTo: { select: { name: true, avatarUrl: true } },
        },
        orderBy: { [safeSortBy]: "asc" },
        skip,
        take: limit,
      }),
      db.complianceItem.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      compliance: items.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        complianceType: item.complianceType,
        status: item.status,
        priority: item.priority,
        dueDate: item.dueDate?.toISOString(),
        department: { name: item.department.name },
        assignedTo: item.assignedTo
          ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl }
          : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages,
    });
  } catch (error) {
    console.error("Compliance list API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch compliance items" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, complianceType, priority, dueDate, departmentId, assignedToId } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!complianceType || typeof complianceType !== "string") {
      return NextResponse.json({ error: "complianceType is required" }, { status: 400 });
    }

    if (!departmentId || typeof departmentId !== "string") {
      return NextResponse.json({ error: "departmentId is required" }, { status: 400 });
    }

    const departmentExists = await db.department.findUnique({
      where: { id: departmentId },
    });
    if (!departmentExists) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    // Get first org
    const org = await db.organisation.findFirst();
    if (!org) {
      return NextResponse.json({ error: "No organisation found" }, { status: 500 });
    }

    const adminUser = await db.user.findFirst({ where: { role: "admin" } });
    if (!adminUser) {
      return NextResponse.json({ error: "No admin user found" }, { status: 500 });
    }

    const item = await db.$transaction(async (tx) => {
      const created = await tx.complianceItem.create({
        data: {
          title: title.trim(),
          description: description?.trim() || null,
          complianceType: complianceType.trim() as ComplianceType,
          priority: VALID_PRIORITIES.includes(priority) ? priority : "medium",
          dueDate: dueDate ? new Date(dueDate) : new Date(),
          department: { connect: { id: departmentId } },
          org: { connect: { id: org.id } },
          assignedTo: assignedToId ? { connect: { id: assignedToId } } : undefined,
        },
        include: {
          department: { select: { name: true } },
          assignedTo: { select: { name: true, avatarUrl: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          action: "create",
          entityType: "ComplianceItem",
          entityId: created.id,
          userId: adminUser.id,
          details: `Created compliance item: ${created.title}`,
        },
      });

      return created;
    });

    return NextResponse.json(
      {
        id: item.id,
        title: item.title,
        status: item.status,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Compliance create API error:", error);
    return NextResponse.json(
      { error: "Failed to create compliance item" },
      { status: 500 }
    );
  }
}