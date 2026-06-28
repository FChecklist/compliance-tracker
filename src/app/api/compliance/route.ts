import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import type { ComplianceStatus, Priority } from "@prisma/client";

const VALID_STATUSES: ComplianceStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "overdue",
  "not_applicable",
];

const VALID_PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

const SORTABLE_FIELDS = ["dueDate", "priority", "title", "status", "createdAt"] as const;
type SortField = (typeof SORTABLE_FIELDS)[number];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "";
    const department = searchParams.get("department") || "";
    const priority = searchParams.get("priority") || "";
    const sortBy = (searchParams.get("sortBy") || "dueDate") as SortField;
    const sortDir = (searchParams.get("sortDir") || "asc") as "asc" | "desc";
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));
    const skip = (page - 1) * limit;

    // Build where clause dynamically
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

    if (department) {
      where.departmentId = department;
    }

    if (priority && VALID_PRIORITIES.includes(priority as Priority)) {
      where.priority = priority as Priority;
    }

    // Validate sort field
    const safeSortBy = SORTABLE_FIELDS.includes(sortBy) ? sortBy : "dueDate";
    const safeSortDir = sortDir === "desc" ? "desc" : "asc";

    const [items, total] = await Promise.all([
      db.complianceItem.findMany({
        where,
        include: {
          department: {
            select: { name: true },
          },
        },
        orderBy: { [safeSortBy]: safeSortDir },
        skip,
        take: limit,
      }),
      db.complianceItem.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      items: items.map((item) => ({
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
      })),
      total,
      page,
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
    const { title, description, complianceType, priority, dueDate, departmentId } = body;

    // Validation
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    if (!complianceType || typeof complianceType !== "string" || complianceType.trim().length === 0) {
      return NextResponse.json(
        { error: "complianceType is required" },
        { status: 400 }
      );
    }

    if (!departmentId || typeof departmentId !== "string" || departmentId.trim().length === 0) {
      return NextResponse.json(
        { error: "departmentId is required" },
        { status: 400 }
      );
    }

    // Verify department exists
    const departmentExists = await db.department.findUnique({
      where: { id: departmentId },
    });

    if (!departmentExists) {
      return NextResponse.json(
        { error: "Department not found" },
        { status: 404 }
      );
    }

    // Build create data
    const createData: Prisma.ComplianceItemCreateInput = {
      title: title.trim(),
      complianceType: complianceType.trim(),
      department: { connect: { id: departmentId } },
    };

    if (description && typeof description === "string") {
      createData.description = description.trim();
    }

    if (priority && VALID_PRIORITIES.includes(priority)) {
      createData.priority = priority;
    }

    if (dueDate) {
      const parsedDate = new Date(dueDate);
      if (!isNaN(parsedDate.getTime())) {
        createData.dueDate = parsedDate;
      }
    }

    // Get a default user for audit log (first admin user)
    const adminUser = await db.user.findFirst({ where: { role: "admin" } });
    if (!adminUser) {
      return NextResponse.json(
        { error: "No admin user found for audit logging" },
        { status: 500 }
      );
    }

    // Create compliance item and audit log in a transaction
    const item = await db.$transaction(async (tx) => {
      const created = await tx.complianceItem.create({
        data: createData,
        include: {
          department: { select: { name: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          action: "created",
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