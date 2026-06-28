CLAUDE-HANDOFF.md for ComplianceTrack Prisma-to-Drizzle Migration

CRITICAL RULES (DO NOT VIOLATE):
1. Do NOT touch ai-os/ directory
2. Do NOT touch SENTINEL.md, CLAUDE.md, AGENTS.md
3. Do NOT touch .github/workflows/
4. Do NOT modify src/app/globals.css (brand tokens must be preserved)
5. Do NOT modify src/components/ui/ (shadcn components)
6. Do NOT commit .env files
7. Do NOT use Prisma anywhere after migration
8. Do NOT create new Supabase project - use jusqumifsmtcaujqyjuy with compliance schema
9. Do NOT use TypeScript any without explaining why
10. Do NOT modify tailwind.config.ts

MISSION: Convert Prisma+SQLite to Drizzle ORM + Supabase PostgreSQL, seed data, deploy to Vercel.

FILE MANIFEST:

NEW FILES:
- src/lib/db/schema.ts  (Drizzle schema, pgSchema compliance, 9 models, 6 enums)
- src/lib/db/index.ts   (Drizzle client, postgres.js driver)
- drizzle.config.ts     (Drizzle Kit config pointing to compliance schema)
- src/db/seed.ts        (Full seed: 1 org, 4 depts, 7 users, 18 items, audit, docs, comments, notifications)

MODIFIED FILES:
- package.json          (remove prisma/@prisma/client, add drizzle-orm/postgres/@paralleldrive/cuid2/drizzle-kit)
- src/lib/db.ts         (re-export from src/lib/db/index.ts)
- All 9 API routes      (replace Prisma queries with Drizzle relational query API)

DATABASE SCHEMA (9 Models):
Organisation { id, name, slug(unique), logo, plan(default:free), isActive, createdAt, updatedAt }
Department { id, name, description, orgId->Organisation, headId->User(unique), createdAt, updatedAt }
User { id, name, email(unique), passwordHash, role(UserRole), avatarUrl, isActive, lastLoginAt, orgId, departmentId, createdAt, updatedAt }
ComplianceItem { id, title, description, complianceType, status, priority, dueDate, completedAt, departmentId, assignedToId, orgId, createdAt, updatedAt }
AuditPoint { id, title, description, status, dueDate, completedAt, complianceItemId(cascade), assignedToId, createdAt, updatedAt }
Document { id, name, fileUrl, fileType, fileSize, complianceItemId(cascade), uploadedById, createdAt }
Comment { id, content, entityId, entityType(default:compliance), authorId, complianceItemId, createdAt }
Notification { id, userId, title, message, type(NotificationType), isRead(false), createdAt }
AuditLog { id, action(AuditAction), entityType, entityId, userId, details, ipAddress, createdAt }

ENUMS:
UserRole: admin manager member viewer
ComplianceStatus: pending in_progress completed overdue not_applicable draft
Priority: low medium high critical
ComplianceType: GST TDS MCA PF ESIC INCOME_TAX ROC LABOUR ENVIRONMENTAL OTHER
NotificationType: deadline_reminder assignment status_change comment system mention
AuditAction: create update delete status_change assign reassign login logout export invite

DRIZZLE SCHEMA TEMPLATE:
import { pgSchema, pgEnum, text, boolean, integer, timestamp } from drizzle-orm/pg-core
import { createId } from @paralleldrive/cuid2
import { relations, sql } from drizzle-orm

export const complianceSchemaDB = pgSchema(compliance)

export const userRoleEnum = complianceSchemaDB.enum(user_role, [admin, manager, member, viewer])
// ... all 6 enums

export const organisations = complianceSchemaDB.table(organisations, {
  id: text(id).primaryKey().$defaultFn(() => createId()),
  name: text(name).notNull(),
  slug: text(slug).notNull().unique(),
  logo: text(logo),
  plan: text(plan).notNull().default(free),
  isActive: boolean(is_active).notNull().default(true),
  createdAt: timestamp(created_at).notNull().defaultNow(),
  updatedAt: timestamp(updated_at).notNull().defaultNow().$onUpdate(() => new Date()),
})

PRISMA-TO-DRIZZLE CONVERSION:

findMany: db.query.complianceItems.findMany({ where: (f, { eq, and }) => and(...), with: { department: { columns: { name: true } } }, orderBy: (f, { asc }) => asc(f.dueDate), limit, offset })
findUnique: db.query.complianceItems.findFirst({ where: (f, { eq }) => eq(f.id, id) })
findFirst: db.query.users.findFirst({ where: (f, { eq }) => eq(f.role, admin) })
create: const [row] = await db.insert(complianceItems).values({...}).returning()
update: const [row] = await db.update(complianceItems).set({...}).where(eq(complianceItems.id, id)).returning()
delete: await db.delete(complianceItems).where(eq(complianceItems.id, id))
count: const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(...)
transaction: db.transaction(async tx => { ... })

DESIGN SYSTEM (NEVER MODIFY globals.css):
--color-ct-cream: #FFFDF9
--color-ct-navy: #1C2B3A
--color-ct-saffron: #F5820A
--color-ct-teal: #0E7C6E

DEPENDENCIES TO ADD:
drizzle-orm: ^0.43.0
postgres: ^3.4.7
@paralleldrive/cuid2: ^2.2.2
drizzle-kit: ^0.31.0 (devDep)

SEED DATA:
Org: Acme Corp (slug: acme-corp, plan: pro)
Depts: Finance, Legal, Operations, HR
Users: admin@acme.com(admin,Finance), manager.finance@acme.com(manager,Finance), manager.legal@acme.com(manager,Legal), member.ops@acme.com(member,Operations), member.hr@acme.com(member,HR), member.finance@acme.com(member,Finance), viewer@acme.com(viewer,Operations). All pwd: Test@1234 (bcrypt)
18 ComplianceItems spread across 4 depts, various statuses/priorities/types
Add 2 AuditPoints per item, 2 Comments per item, 1 Document per item, 10 Notifications for admin, 20 AuditLogs

VERCEL ENV VARS:
DATABASE_URL=postgresql://postgres.jusqumifsmtcaujqyjuy:[DB_PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require
NEXT_PUBLIC_SUPABASE_URL=https://jusqumifsmtcaujqyjuy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1c3F1bWlmc210Y2F1anF5anV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNDExMjgsImV4cCI6MjA5NjkxNzEyOH0.Dkmvb70qW4V1xtG5UW3-M8LrkeksISeJj60mOcDHsj8
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1c3F1bWlmc210Y2F1anF5anV5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTM0MTEyOCwiZXhwIjoyMDk2OTE3MTI4fQ.OA2DvsvlEhhO18OBJQz_amyuuj8dUnmK6iNkT1rHLlE

CI CHECKS:
bun run lint
bunx tsc --noEmit
bun run build (after db:generate)
