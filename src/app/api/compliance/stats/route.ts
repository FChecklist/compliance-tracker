import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

export async function GET() {
  try {
    const [total, completed, overdue, inProgress, pending] =
      await Promise.all([
        db.complianceItem.count(),
        db.complianceItem.count({ where: { status: "completed" } }),
        db.complianceItem.count({ where: { status: "overdue" } }),
        db.complianceItem.count({ where: { status: "in_progress" } }),
        db.complianceItem.count({ where: { status: "pending" } }),
      ]);

    // Due soon: items due within 7 days that are not completed
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const dueSoon = await db.complianceItem.count({
      where: {
        dueDate: { lte: sevenDaysFromNow },
        status: { notIn: ["completed", "not_applicable"] },
      },
    });

    return NextResponse.json({
      stats: {
        total,
        completed,
        overdue,
        inProgress,
        pending,
        dueSoon,
        notApplicable: total - completed - overdue - inProgress - pending,
      },
    });
  } catch (error) {
    console.error("Stats API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}