import { db, complianceItems, departments, users } from '@/lib/db'
import { eq, and, like, gte, lte } from 'drizzle-orm'
import type { ExtractedItem, ValidatedItem } from './types'
import { VALID_COMPLIANCE_TYPES, VALID_STATUSES, VALID_PRIORITIES } from './types'

export interface ValidationSummary {
  total: number
  readyToImport: number    // confidence >= 0.7, no missing required fields, no errors
  needsReview: number      // confidence 0.5-0.7 or warnings present
  hasErrors: number        // missing required fields or invalid values
  duplicates: number
}

interface DeptCache { [name: string]: string | null } // name → id or null
interface UserCache { [name: string]: string | null }

async function buildDeptCache(orgId: string): Promise<DeptCache> {
  const depts = await db.query.departments.findMany({
    columns: { id: true, name: true },
  })
  const cache: DeptCache = {}
  for (const d of depts) {
    cache[d.name.toLowerCase().trim()] = d.id
  }
  return cache
}

async function buildUserCache(): Promise<UserCache> {
  const allUsers = await db.query.users.findMany({
    columns: { id: true, name: true, email: true },
  })
  const cache: UserCache = {}
  for (const u of allUsers) {
    cache[u.name.toLowerCase().trim()] = u.id
    cache[u.email.toLowerCase().trim()] = u.id
  }
  return cache
}

// Fuzzy department match — handles "Finance Dept" matching "Finance"
function matchDept(name: string, cache: DeptCache): string | null {
  const n = name.toLowerCase().trim()
  if (cache[n]) return cache[n]
  // Partial match
  for (const [key, id] of Object.entries(cache)) {
    if (key.includes(n) || n.includes(key)) return id
  }
  return null
}

function matchUser(name: string, cache: UserCache): string | null {
  const n = name.toLowerCase().trim()
  if (cache[n]) return cache[n]
  // First-name match as fallback
  const firstName = n.split(' ')[0]
  for (const [key, id] of Object.entries(cache)) {
    if (key.startsWith(firstName)) return id
  }
  return null
}

// Check for near-duplicate against existing compliance_items
async function checkDuplicate(
  title: string,
  dueDate: string | null,
  orgId: string
): Promise<string | null> {
  // Exact title match
  const existing = await db.query.complianceItems.findFirst({
    where: and(
      eq(complianceItems.orgId, orgId),
      like(complianceItems.title, title.trim()),
    ),
    columns: { id: true },
  })
  if (existing) return existing.id

  // Same title + same due date month (avoids flagging same compliance type in different months)
  if (dueDate) {
    const d = new Date(dueDate)
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1)
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const dupeByDate = await db.query.complianceItems.findFirst({
      where: and(
        eq(complianceItems.orgId, orgId),
        like(complianceItems.title, `%${title.slice(0, 20).trim()}%`),
        gte(complianceItems.dueDate, monthStart),
        lte(complianceItems.dueDate, monthEnd),
      ),
      columns: { id: true },
    })
    if (dupeByDate) return dupeByDate.id
  }
  return null
}

export async function validateItems(
  items: ExtractedItem[],
  orgId: string
): Promise<ValidatedItem[]> {
  const [deptCache, userCache] = await Promise.all([
    buildDeptCache(orgId),
    buildUserCache(),
  ])

  const validated: ValidatedItem[] = []

  for (const item of items) {
    const errors: string[] = []
    const warnings = [...item.warnings]

    // Required field validation
    if (!item.title || item.title.trim().length === 0) {
      errors.push('Title is required and could not be determined')
    }
    if (!item.complianceType || !(VALID_COMPLIANCE_TYPES as readonly string[]).includes(item.complianceType)) {
      errors.push(`Compliance type "${item.complianceType}" is not valid — will use OTHER`)
    }
    if (!item.dueDate) {
      warnings.push('Due date is missing — you must set it before confirming')
    } else {
      const d = new Date(item.dueDate)
      if (isNaN(d.getTime())) {
        errors.push(`Due date "${item.dueDate}" is not a valid date`)
      }
    }

    // Resolve department
    let departmentId: string | null = null
    if (item.departmentName) {
      departmentId = matchDept(item.departmentName, deptCache)
      if (!departmentId) {
        warnings.push(`Department "${item.departmentName}" not found — first department will be used on import`)
      }
    } else {
      warnings.push('No department specified — first department will be used on import')
    }

    // Resolve assigned user
    let assignedToId: string | null = null
    if (item.assignedToName) {
      assignedToId = matchUser(item.assignedToName, userCache)
      if (!assignedToId) {
        warnings.push(`User "${item.assignedToName}" not found in system — will be left unassigned`)
      }
    }

    // Duplicate check (only for items with title)
    let isDuplicate = false
    let duplicateOfId: string | null = null
    if (item.title && errors.length === 0) {
      duplicateOfId = await checkDuplicate(item.title, item.dueDate, orgId)
      if (duplicateOfId) {
        isDuplicate = true
        warnings.push(`Possible duplicate of existing item (ID: ${duplicateOfId})`)
      }
    }

    validated.push({
      ...item,
      departmentId,
      assignedToId,
      isDuplicate,
      duplicateOfId,
      errors,
      warnings,
    })
  }

  return validated
}

export function summariseValidation(items: ValidatedItem[]): ValidationSummary {
  let readyToImport = 0
  let needsReview = 0
  let hasErrors = 0
  let duplicates = 0

  for (const item of items) {
    if (item.isDuplicate) duplicates++
    if (item.errors.length > 0) {
      hasErrors++
    } else if (item.confidence >= 0.7 && item.warnings.length === 0 && !item.isDuplicate) {
      readyToImport++
    } else {
      needsReview++
    }
  }

  return { total: items.length, readyToImport, needsReview, hasErrors, duplicates }
}
