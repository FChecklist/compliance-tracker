import { complianceItems, departments, auditLogs } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, like } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

const VALID_TYPES = ['GST', 'TDS', 'MCA', 'PF', 'ESIC', 'INCOME_TAX', 'ROC', 'LABOUR', 'ENVIRONMENTAL', 'OTHER'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

export async function POST(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      return NextResponse.json({ error: "CSV must have a header row and at least one data row" }, { status: 400 });
    }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));

    // Auto-map columns
    const COLUMN_MAP: Record<string, string> = {
      title: "title", "name": "title", "compliance title": "title", "item": "title", "item name": "title",
      description: "description", "desc": "description", "details": "description",
      type: "complianceType", "compliance type": "complianceType", "compliance_type": "complianceType", "category": "complianceType",
      priority: "priority",
      "due date": "dueDate", "due_date": "dueDate", "due": "dueDate", "deadline": "dueDate",
      department: "departmentName", "dept": "departmentName", "department name": "departmentName",
      assignee: "assignedToEmail", "assigned to": "assignedToEmail", "assigned_to": "assignedToEmail", "assignee email": "assignedToEmail",
      period: "period",
      "financial year": "financialYear", "financial_year": "financialYear", "fy": "financialYear",
      arn: "acknowledgementNumber", "acknowledgement": "acknowledgementNumber", "ack no": "acknowledgementNumber",
      "registration number": "registrationNumber", "registration": "registrationNumber", "gstin": "registrationNumber", "tan": "registrationNumber",
      amount: "amount", "value": "amount",
      recurrence: "recurrenceType", "recurrence type": "recurrenceType",
    };

    const mappedHeaders: Record<string, string> = {};
    for (const header of headers) {
      const mapped = COLUMN_MAP[header];
      if (mapped) mappedHeaders[header] = mapped;
    }

    // Parse rows
    const results: { success: number; errors: { row: number; message: string }[]; items: { id: string; title: string }[] } = {
      success: 0,
      errors: [],
      items: [],
    };

    await withTenantContext({ orgId }, async (db) => {
      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === 0) continue;

        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx]?.trim().replace(/^"|"$/g, "") || "";
        });

        // Extract mapped values
        const getData = (field: string): string => {
          for (const [csvCol, mappedField] of Object.entries(mappedHeaders)) {
            if (mappedField === field) return row[csvCol] || "";
          }
          // Direct header match
          for (const h of headers) {
            const mapped = COLUMN_MAP[h];
            if (mapped === field) return row[h] || "";
          }
          return "";
        };

        const title = getData("title");
        const complianceType = getData("complianceType").toUpperCase().replace(/ /g, "_");
        const departmentName = getData("departmentName");

        if (!title) {
          results.errors.push({ row: i + 1, message: "Title is required" });
          continue;
        }

        // Find department -- RLS-scoped, so "first department" fallback can
        // only ever land on this org's own departments, not any org's.
        let departmentId: string | null = null;
        if (departmentName) {
          const dept = await db.query.departments.findFirst({
            where: and(eq(departments.orgId, orgId), like(departments.name, `%${departmentName}%`)),
          });
          departmentId = dept?.id || null;
        }
        if (!departmentId) {
          const firstDept = await db.query.departments.findFirst({ where: eq(departments.orgId, orgId) });
          departmentId = firstDept?.id || null;
        }
        if (!departmentId) {
          results.errors.push({ row: i + 1, message: "No department found" });
          continue;
        }

        const dueDateStr = getData("dueDate");
        let dueDate: Date | null = null;
        if (dueDateStr) {
          dueDate = new Date(dueDateStr);
          if (isNaN(dueDate.getTime())) {
            results.errors.push({ row: i + 1, message: `Invalid date: ${dueDateStr}` });
            continue;
          }
        }

        const type = (VALID_TYPES as string[]).includes(complianceType) ? complianceType : "OTHER";
        const priority = (VALID_PRIORITIES as string[]).includes(getData("priority").toLowerCase()) ? getData("priority").toLowerCase() : "medium";
        const recurrenceType = ["none", "monthly", "quarterly", "half_yearly", "annually"].includes(getData("recurrenceType").toLowerCase()) ? getData("recurrenceType").toLowerCase() : "none";

        try {
          const [item] = await db.insert(complianceItems).values({
            title: title.trim(),
            description: getData("description") || null,
            complianceType: type as typeof VALID_TYPES[number],
            priority: priority as typeof VALID_PRIORITIES[number],
            dueDate: dueDate || new Date(),
            departmentId,
            orgId,
            period: getData("period") || null,
            financialYear: getData("financialYear") || null,
            acknowledgementNumber: getData("acknowledgementNumber") || null,
            registrationNumber: getData("registrationNumber") || null,
            amount: getData("amount") || null,
            recurrenceType: recurrenceType as "none" | "monthly" | "quarterly" | "half_yearly" | "annually",
            isTemplateSuggested: false,
          }).returning();

          await db.insert(auditLogs).values({
            action: "create",
            entityType: "ComplianceItem",
            entityId: item.id,
            userId: dbUser.id,
            details: `Bulk imported: ${item.title}`,
          });

          results.success++;
          results.items.push({ id: item.id, title: item.title });
        } catch (err) {
          results.errors.push({ row: i + 1, message: err instanceof Error ? err.message : "Failed to create" });
        }
      }
    })

    return NextResponse.json(results);
  } catch (error) {
    console.error("CSV import error:", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}