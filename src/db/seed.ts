import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import bcrypt from 'bcryptjs'
import * as schema from '../lib/db/schema'

const client = postgres(process.env.DATABASE_URL!, { prepare: false })
const db = drizzle(client, { schema })

const PASSWORD_HASH = await bcrypt.hash('Test@1234', 10)

async function seed() {
  console.log('Seeding compliance schema...')

  // Org
  const [org] = await db.insert(schema.organisations).values({
    name: 'Acme Corp',
    slug: 'acme-corp',
    plan: 'pro',
  }).returning()

  // Departments
  const [finance, legal, operations, hr] = await db.insert(schema.departments).values([
    { name: 'Finance', description: 'Financial compliance and reporting', orgId: org.id },
    { name: 'Legal', description: 'Legal and regulatory compliance', orgId: org.id },
    { name: 'Operations', description: 'Operational compliance', orgId: org.id },
    { name: 'HR', description: 'Human resources compliance', orgId: org.id },
  ]).returning()

  // Users
  const [admin, managerFinance, managerLegal, memberOps, memberHr, memberFinance, viewer] =
    await db.insert(schema.users).values([
      { name: 'Admin User', email: 'admin@acme.com', passwordHash: PASSWORD_HASH, role: 'admin', orgId: org.id, departmentId: finance.id },
      { name: 'Finance Manager', email: 'manager.finance@acme.com', passwordHash: PASSWORD_HASH, role: 'manager', orgId: org.id, departmentId: finance.id },
      { name: 'Legal Manager', email: 'manager.legal@acme.com', passwordHash: PASSWORD_HASH, role: 'manager', orgId: org.id, departmentId: legal.id },
      { name: 'Ops Member', email: 'member.ops@acme.com', passwordHash: PASSWORD_HASH, role: 'member', orgId: org.id, departmentId: operations.id },
      { name: 'HR Member', email: 'member.hr@acme.com', passwordHash: PASSWORD_HASH, role: 'member', orgId: org.id, departmentId: hr.id },
      { name: 'Finance Member', email: 'member.finance@acme.com', passwordHash: PASSWORD_HASH, role: 'member', orgId: org.id, departmentId: finance.id },
      { name: 'Viewer User', email: 'viewer@acme.com', passwordHash: PASSWORD_HASH, role: 'viewer', orgId: org.id, departmentId: operations.id },
    ]).returning()

  // Set department heads
  const { eq } = await import('drizzle-orm')
  await db.update(schema.departments).set({ headId: managerFinance.id }).where(eq(schema.departments.id, finance.id))
  await db.update(schema.departments).set({ headId: managerLegal.id }).where(eq(schema.departments.id, legal.id))

  const now = new Date()
  const future = (days: number) => new Date(now.getTime() + days * 86400000)
  const past = (days: number) => new Date(now.getTime() - days * 86400000)

  // 18 compliance items
  const items = await db.insert(schema.complianceItems).values([
    // Finance (6)
    { title: 'GST Monthly Return (GSTR-3B)', complianceType: 'GST', status: 'pending', priority: 'high', dueDate: future(5), departmentId: finance.id, assignedToId: managerFinance.id, orgId: org.id },
    { title: 'TDS Quarterly Filing', complianceType: 'TDS', status: 'in_progress', priority: 'high', dueDate: future(12), departmentId: finance.id, assignedToId: memberFinance.id, orgId: org.id },
    { title: 'Income Tax Advance Payment', complianceType: 'INCOME_TAX', status: 'completed', priority: 'critical', dueDate: past(10), completedAt: past(12), departmentId: finance.id, assignedToId: managerFinance.id, orgId: org.id },
    { title: 'Annual GST Reconciliation', complianceType: 'GST', status: 'draft', priority: 'medium', dueDate: future(45), departmentId: finance.id, orgId: org.id },
    { title: 'TDS Certificate Issuance (Form 16)', complianceType: 'TDS', status: 'overdue', priority: 'critical', dueDate: past(5), departmentId: finance.id, assignedToId: memberFinance.id, orgId: org.id },
    { title: 'PF Monthly Challan', complianceType: 'PF', status: 'pending', priority: 'high', dueDate: future(3), departmentId: finance.id, assignedToId: managerFinance.id, orgId: org.id },
    // Legal (4)
    { title: 'ROC Annual Return Filing', complianceType: 'ROC', status: 'pending', priority: 'high', dueDate: future(20), departmentId: legal.id, assignedToId: managerLegal.id, orgId: org.id },
    { title: 'MCA Board Resolution', complianceType: 'MCA', status: 'in_progress', priority: 'medium', dueDate: future(30), departmentId: legal.id, assignedToId: managerLegal.id, orgId: org.id },
    { title: 'Labour Law Compliance Audit', complianceType: 'LABOUR', status: 'completed', priority: 'high', dueDate: past(20), completedAt: past(22), departmentId: legal.id, orgId: org.id },
    { title: 'Environmental Clearance Renewal', complianceType: 'ENVIRONMENTAL', status: 'overdue', priority: 'critical', dueDate: past(3), departmentId: legal.id, assignedToId: managerLegal.id, orgId: org.id },
    // Operations (4)
    { title: 'ESIC Monthly Contribution', complianceType: 'ESIC', status: 'pending', priority: 'high', dueDate: future(7), departmentId: operations.id, assignedToId: memberOps.id, orgId: org.id },
    { title: 'PF Annual Return (Form 3A/6A)', complianceType: 'PF', status: 'in_progress', priority: 'medium', dueDate: future(25), departmentId: operations.id, assignedToId: memberOps.id, orgId: org.id },
    { title: 'Factory License Renewal', complianceType: 'OTHER', status: 'completed', priority: 'critical', dueDate: past(15), completedAt: past(18), departmentId: operations.id, orgId: org.id },
    { title: 'Fire Safety Compliance', complianceType: 'OTHER', status: 'not_applicable', priority: 'low', dueDate: future(60), departmentId: operations.id, orgId: org.id },
    // HR (4)
    { title: 'ESIC New Employee Registration', complianceType: 'ESIC', status: 'pending', priority: 'medium', dueDate: future(10), departmentId: hr.id, assignedToId: memberHr.id, orgId: org.id },
    { title: 'PF New Joinee KYC', complianceType: 'PF', status: 'in_progress', priority: 'medium', dueDate: future(15), departmentId: hr.id, assignedToId: memberHr.id, orgId: org.id },
    { title: 'Shops & Establishment Act Renewal', complianceType: 'LABOUR', status: 'completed', priority: 'high', dueDate: past(30), completedAt: past(32), departmentId: hr.id, orgId: org.id },
    { title: 'Sexual Harassment Policy Review', complianceType: 'LABOUR', status: 'pending', priority: 'high', dueDate: future(18), departmentId: hr.id, assignedToId: memberHr.id, orgId: org.id },
  ]).returning()

  // Audit points (2 per item)
  const auditPointValues = items.flatMap(item => [
    { title: `Initial review of ${item.title}`, status: 'completed' as const, complianceItemId: item.id, assignedToId: admin.id, dueDate: new Date(item.dueDate.getTime() - 7 * 86400000) },
    { title: `Final submission for ${item.title}`, status: item.status === 'completed' ? 'completed' as const : 'pending' as const, complianceItemId: item.id, dueDate: item.dueDate },
  ])
  await db.insert(schema.auditPoints).values(auditPointValues)

  // Comments (2 per item)
  const commentValues = items.flatMap(item => [
    { content: `Started working on ${item.title}. All documents collected.`, entityId: item.id, authorId: admin.id, complianceItemId: item.id },
    { content: `Please review the checklist for ${item.title} before due date.`, entityId: item.id, authorId: managerFinance.id, complianceItemId: item.id },
  ])
  await db.insert(schema.comments).values(commentValues)

  // Documents (1 per item)
  const docValues = items.map(item => ({
    name: `${item.title.replace(/\s+/g, '_')}_document.pdf`,
    fileUrl: `https://storage.acme.com/compliance/${item.id}/document.pdf`,
    fileType: 'application/pdf',
    fileSize: Math.floor(Math.random() * 500000) + 50000,
    complianceItemId: item.id,
    uploadedById: admin.id,
  }))
  await db.insert(schema.documents).values(docValues)

  // 10 notifications for admin
  await db.insert(schema.notifications).values([
    { userId: admin.id, title: 'GST Return Due Soon', message: 'GSTR-3B is due in 5 days. Please ensure all data is ready.', type: 'deadline_reminder' },
    { userId: admin.id, title: 'Overdue: TDS Certificate', message: 'TDS Certificate Issuance is overdue by 5 days.', type: 'deadline_reminder' },
    { userId: admin.id, title: 'New Assignment', message: 'You have been assigned PF Monthly Challan.', type: 'assignment' },
    { userId: admin.id, title: 'Status Changed', message: 'Income Tax Advance Payment has been marked as completed.', type: 'status_change' },
    { userId: admin.id, title: 'Comment Added', message: 'Finance Manager commented on GST Monthly Return.', type: 'comment' },
    { userId: admin.id, title: 'Environmental Clearance Overdue', message: 'Environmental Clearance Renewal is overdue by 3 days.', type: 'deadline_reminder' },
    { userId: admin.id, title: 'ROC Filing Due', message: 'ROC Annual Return Filing is due in 20 days.', type: 'deadline_reminder' },
    { userId: admin.id, title: 'Team Update', message: 'New member added to Finance department.', type: 'system' },
    { userId: admin.id, title: 'ESIC Contribution Reminder', message: 'ESIC Monthly Contribution is due in 7 days.', type: 'deadline_reminder' },
    { userId: admin.id, title: 'System Maintenance', message: 'Scheduled maintenance on Sunday 2AM–4AM IST.', type: 'system', isRead: true },
  ])

  // 20 audit logs
  const auditActions = ['create', 'update', 'status_change', 'assign'] as const
  const auditLogValues = Array.from({ length: 20 }, (_, i) => ({
    action: auditActions[i % auditActions.length],
    entityType: 'ComplianceItem',
    entityId: items[i % items.length].id,
    userId: [admin.id, managerFinance.id, managerLegal.id][i % 3],
    details: `Action ${auditActions[i % auditActions.length]} performed on ${items[i % items.length].title}`,
    createdAt: new Date(now.getTime() - i * 3600000),
  }))
  await db.insert(schema.auditLogs).values(auditLogValues)

  console.log('Seed complete!')
  console.log(`  1 org, 4 depts, 7 users, ${items.length} compliance items seeded`)
  await client.end()
}

seed().catch(err => {
  console.error(err)
  process.exit(1)
})
