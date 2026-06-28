/**
 * Seed script for ComplianceTrack on Supabase (compliance schema)
 * Run: DATABASE_URL=... bun run src/db/seed.ts
 */
import { db } from '../lib/db/index'
import {
  organisations, departments, users, complianceItems,
  auditPoints, documents, comments, notifications, auditLogs,
} from '../lib/db/schema'
import bcrypt from 'bcryptjs'
import { createId } from '@paralleldrive/cuid2'

async function seed() {
  console.log('Seeding database...')
  const pwd = await bcrypt.hash('Test@1234', 10)

  // Organisation
  const [org] = await db.insert(organisations).values({
    name: 'Acme Corp',
    slug: 'acme-corp',
    plan: 'pro',
    isActive: true,
  }).returning()
  console.log('  Org:', org.id)

  // Departments
  const [finance, legal, ops, hr] = await db.insert(departments).values([
    { name: 'Finance', description: 'Financial compliance and reporting', orgId: org.id },
    { name: 'Legal', description: 'Legal and regulatory compliance', orgId: org.id },
    { name: 'Operations', description: 'Operational compliance and standards', orgId: org.id },
    { name: 'HR', description: 'Human resources compliance', orgId: org.id },
  ]).returning()
  console.log('  Depts: Finance, Legal, Operations, HR')

  // Users
  const [admin, mgr1, mgr2, mem1, mem2, mem3, viewer] = await db.insert(users).values([
    { name: 'Admin User', email: 'admin@acme.com', passwordHash: pwd, role: 'admin', orgId: org.id, departmentId: finance.id },
    { name: 'Finance Manager', email: 'manager.finance@acme.com', passwordHash: pwd, role: 'manager', orgId: org.id, departmentId: finance.id },
    { name: 'Legal Manager', email: 'manager.legal@acme.com', passwordHash: pwd, role: 'manager', orgId: org.id, departmentId: legal.id },
    { name: 'Ops Member', email: 'member.ops@acme.com', passwordHash: pwd, role: 'member', orgId: org.id, departmentId: ops.id },
    { name: 'HR Member', email: 'member.hr@acme.com', passwordHash: pwd, role: 'member', orgId: org.id, departmentId: hr.id },
    { name: 'Finance Member', email: 'member.finance@acme.com', passwordHash: pwd, role: 'member', orgId: org.id, departmentId: finance.id },
    { name: 'Viewer User', email: 'viewer@acme.com', passwordHash: pwd, role: 'viewer', orgId: org.id, departmentId: ops.id },
  ]).returning()
  console.log('  Users: 7')

  // Set dept heads
  await db.update(departments).set({ headId: mgr1.id }).where(eq(departments.id, finance.id))
  await db.update(departments).set({ headId: mgr2.id }).where(eq(departments.id, legal.id))

  const now = new Date()
  const past30 = new Date(now.getTime() - 30 * 86400000)
  const past7 = new Date(now.getTime() - 7 * 86400000)
  const future30 = new Date(now.getTime() + 30 * 86400000)
  const future60 = new Date(now.getTime() + 60 * 86400000)
  const future90 = new Date(now.getTime() + 90 * 86400000)

  // ComplianceItems (18)
  const ciData = [
    // Finance (4)
    { title: 'GST Filing Q1', description: 'Quarterly GST return filing for Q1', complianceType: 'GST' as const, status: 'overdue' as const, priority: 'critical' as const, dueDate: past30, departmentId: finance.id, assignedToId: mgr1.id, orgId: org.id },
    { title: 'TDS Quarterly Return', description: 'TDS deduction and return filing', complianceType: 'TDS' as const, status: 'in_progress' as const, priority: 'high' as const, dueDate: future30, departmentId: finance.id, assignedToId: mem3.id, orgId: org.id },
    { title: 'GST Filing Q2', description: 'Quarterly GST return filing for Q2', complianceType: 'GST' as const, status: 'pending' as const, priority: 'high' as const, dueDate: future60, departmentId: finance.id, assignedToId: mgr1.id, orgId: org.id },
    { title: 'Income Tax Advance', description: 'Advance tax payment compliance', complianceType: 'INCOME_TAX' as const, status: 'pending' as const, priority: 'medium' as const, dueDate: future90, departmentId: finance.id, assignedToId: mem3.id, orgId: org.id },
    // Legal (4)
    { title: 'ROC Annual Return', description: 'Annual return filing with ROC', complianceType: 'ROC' as const, status: 'completed' as const, priority: 'critical' as const, dueDate: past7, completedAt: past7, departmentId: legal.id, assignedToId: mgr2.id, orgId: org.id },
    { title: 'MCA Form Filing', description: 'MCA compliance form submission', complianceType: 'MCA' as const, status: 'in_progress' as const, priority: 'high' as const, dueDate: future30, departmentId: legal.id, assignedToId: mgr2.id, orgId: org.id },
    { title: 'Legal Compliance Audit', description: 'Annual legal compliance audit', complianceType: 'OTHER' as const, status: 'pending' as const, priority: 'medium' as const, dueDate: future60, departmentId: legal.id, assignedToId: mgr2.id, orgId: org.id },
    { title: 'Contract Review Cycle', description: 'Quarterly contract review', complianceType: 'OTHER' as const, status: 'draft' as const, priority: 'low' as const, dueDate: future90, departmentId: legal.id, assignedToId: null, orgId: org.id },
    // Operations (5)
    { title: 'ISO 9001 Audit', description: 'ISO quality management audit', complianceType: 'OTHER' as const, status: 'in_progress' as const, priority: 'critical' as const, dueDate: future30, departmentId: ops.id, assignedToId: mem1.id, orgId: org.id },
    { title: 'Fire Safety Certificate', description: 'Annual fire safety compliance', complianceType: 'ENVIRONMENTAL' as const, status: 'overdue' as const, priority: 'critical' as const, dueDate: past30, departmentId: ops.id, assignedToId: mem1.id, orgId: org.id },
    { title: 'Equipment Calibration', description: 'Quarterly equipment calibration', complianceType: 'OTHER' as const, status: 'pending' as const, priority: 'medium' as const, dueDate: future60, departmentId: ops.id, assignedToId: viewer.id, orgId: org.id },
    { title: 'SOP Documentation', description: 'Standard operating procedures update', complianceType: 'OTHER' as const, status: 'pending' as const, priority: 'low' as const, dueDate: future90, departmentId: ops.id, assignedToId: null, orgId: org.id },
    { title: 'Waste Disposal Certification', description: 'Environmental waste disposal cert', complianceType: 'ENVIRONMENTAL' as const, status: 'in_progress' as const, priority: 'medium' as const, dueDate: future30, departmentId: ops.id, assignedToId: mem1.id, orgId: org.id },
    // HR (5)
    { title: 'ESI Monthly Filing', description: 'Employee State Insurance filing', complianceType: 'ESIC' as const, status: 'in_progress' as const, priority: 'high' as const, dueDate: future30, departmentId: hr.id, assignedToId: mem2.id, orgId: org.id },
    { title: 'PF Monthly Filing', description: 'Provident Fund monthly return', complianceType: 'PF' as const, status: 'completed' as const, priority: 'high' as const, dueDate: past7, completedAt: past7, departmentId: hr.id, assignedToId: mem2.id, orgId: org.id },
    { title: 'Labour Law Compliance', description: 'Labour law compliance review', complianceType: 'LABOUR' as const, status: 'pending' as const, priority: 'medium' as const, dueDate: future60, departmentId: hr.id, assignedToId: mem2.id, orgId: org.id },
    { title: 'POSH Policy Review', description: 'Prevention of sexual harassment policy', complianceType: 'OTHER' as const, status: 'pending' as const, priority: 'medium' as const, dueDate: future60, departmentId: hr.id, assignedToId: null, orgId: org.id },
    { title: 'Payroll Compliance Q1', description: 'Q1 payroll compliance audit', complianceType: 'OTHER' as const, status: 'completed' as const, priority: 'medium' as const, dueDate: past30, completedAt: past30, departmentId: hr.id, assignedToId: mem2.id, orgId: org.id },
  ]
  const ciRows = await db.insert(complianceItems).values(ciData).returning()
  console.log('  ComplianceItems: 18')

  // AuditPoints (2 per item)
  const apData = ciRows.flatMap(ci => [
    { title: `Initial review for ${ci.title}`, status: 'completed' as const, complianceItemId: ci.id, dueDate: ci.dueDate },
    { title: `Final verification for ${ci.title}`, status: 'pending' as const, complianceItemId: ci.id, dueDate: ci.dueDate },
  ])
  await db.insert(auditPoints).values(apData)
  console.log('  AuditPoints: 36')

  // Documents (1 per item)
  const docData = ciRows.map(ci => ({
    name: `${ci.title} - Document.pdf`,
    fileUrl: `https://storage.acme.com/compliance/${ci.id}/document.pdf`,
    fileType: 'application/pdf',
    fileSize: Math.floor(Math.random() * 500000) + 50000,
    complianceItemId: ci.id,
    uploadedById: admin.id,
  }))
  await db.insert(documents).values(docData)
  console.log('  Documents: 18')

  // Comments (2 per item)
  const commentData = ciRows.flatMap(ci => [
    { content: `Initiated compliance check for ${ci.title}`, entityId: ci.id, authorId: admin.id, complianceItemId: ci.id },
    { content: `Documents are being gathered. Will update soon.`, entityId: ci.id, authorId: mgr1.id, complianceItemId: ci.id },
  ])
  await db.insert(comments).values(commentData)
  console.log('  Comments: 36')

  // Notifications (10 for admin)
  const notifData = [
    { userId: admin.id, title: 'GST Filing Q1 Overdue', message: 'GST Filing Q1 is past its due date', type: 'deadline_reminder' as const },
    { userId: admin.id, title: 'Fire Safety Certificate Overdue', message: 'Fire Safety Certificate is past its due date', type: 'deadline_reminder' as const },
    { userId: admin.id, title: 'New Assignment', message: 'TDS Quarterly Return has been assigned to Finance Member', type: 'assignment' as const },
    { userId: admin.id, title: 'Status Update', message: 'ROC Annual Return has been marked as completed', type: 'status_change' as const },
    { userId: admin.id, title: 'PF Monthly Filing Complete', message: 'PF Monthly Filing marked as completed', type: 'status_change' as const },
    { userId: admin.id, title: 'ISO Audit in Progress', message: 'ISO 9001 Audit is now in progress', type: 'status_change' as const },
    { userId: admin.id, title: 'Comment on GST Filing', message: 'Finance Manager commented on GST Filing Q1', type: 'comment' as const },
    { userId: admin.id, title: 'System: Seed Complete', message: 'Demo data has been loaded successfully', type: 'system' as const },
    { userId: admin.id, title: 'Upcoming: TDS Return', message: 'TDS Quarterly Return is due in 30 days', type: 'deadline_reminder' as const },
    { userId: mgr1.id, title: 'Your Assignment', message: 'GST Filing Q2 has been assigned to you', type: 'assignment' as const },
  ]
  await db.insert(notifications).values(notifData)
  console.log('  Notifications: 10')

  // AuditLogs (20)
  const alData = [
    { action: 'login' as const, entityType: 'User', entityId: admin.id, userId: admin.id, details: 'Admin logged in' },
    { action: 'create' as const, entityType: 'Organisation', entityId: org.id, userId: admin.id, details: 'Created organisation: Acme Corp' },
    { action: 'create' as const, entityType: 'Department', entityId: finance.id, userId: admin.id, details: 'Created Finance department' },
    { action: 'create' as const, entityType: 'Department', entityId: legal.id, userId: admin.id, details: 'Created Legal department' },
    { action: 'create' as const, entityType: 'Department', entityId: ops.id, userId: admin.id, details: 'Created Operations department' },
    { action: 'create' as const, entityType: 'Department', entityId: hr.id, userId: admin.id, details: 'Created HR department' },
    ...ciRows.slice(0, 7).map(ci => ({ action: 'create' as const, entityType: 'ComplianceItem', entityId: ci.id, userId: admin.id, details: `Created: ${ci.title}` })),
    { action: 'status_change' as const, entityType: 'ComplianceItem', entityId: ciRows[4].id, userId: mgr2.id, details: 'Status changed to completed' },
    { action: 'status_change' as const, entityType: 'ComplianceItem', entityId: ciRows[14].id, userId: mem2.id, details: 'PF Filing marked completed' },
    { action: 'assign' as const, entityType: 'ComplianceItem', entityId: ciRows[0].id, userId: admin.id, details: 'Assigned to Finance Manager' },
    { action: 'update' as const, entityType: 'ComplianceItem', entityId: ciRows[1].id, userId: admin.id, details: 'Priority updated to high' },
    { action: 'export' as const, entityType: 'ComplianceItem', entityId: 'all', userId: admin.id, details: 'Exported compliance report' },
    { action: 'login' as const, entityType: 'User', entityId: mgr1.id, userId: mgr1.id, details: 'Finance Manager logged in' },
  ]
  await db.insert(auditLogs).values(alData)
  console.log('  AuditLogs: 20')

  console.log('Seed complete!')
  process.exit(0)
}

import { eq } from 'drizzle-orm'
import { departments as deptsTable } from '../lib/db/schema'
seed().catch(e => { console.error(e); process.exit(1) })