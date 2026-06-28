import { PrismaClient, ComplianceStatus, Priority, ComplianceType, UserRole } from '@prisma/client';
import { hash } from 'bcryptjs';

const db = new PrismaClient();

const NOW = new Date();
const DAYS = (n: number) => new Date(NOW.getTime() + n * 86400000);

async function seed() {
  console.log('🌱 Seeding ComplianceTrack database...');

  // ─── Organisation ───
  const org = await db.organisation.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: {
      name: 'Acme Financial Services Pvt. Ltd.',
      slug: 'acme-corp',
      plan: 'professional',
    },
  });

  // ─── Departments ───
  const departments = await Promise.all([
    db.department.upsert({ where: { id: 'dept-finance' }, update: {}, create: { id: 'dept-finance', name: 'Finance & Taxation', description: 'Handles GST, TDS, Income Tax filings', orgId: org.id } }),
    db.department.upsert({ where: { id: 'dept-legal' }, update: {}, create: { id: 'dept-legal', name: 'Legal & Compliance', description: 'MCA, ROC, legal filings', orgId: org.id } }),
    db.department.upsert({ where: { id: 'dept-hr' }, update: {}, create: { id: 'dept-hr', name: 'Human Resources', description: 'PF, ESIC, labour law compliance', orgId: org.id } }),
    db.department.upsert({ where: { id: 'dept-ops' }, update: {}, create: { id: 'dept-ops', name: 'Operations', description: 'Operational and environmental compliance', orgId: org.id } }),
  ]);

  // ─── Users ───
  const passwordHash = await hash('password123', 12);
  const users = await Promise.all([
    db.user.upsert({ where: { email: 'admin@acme.com' }, update: {}, create: { id: 'user-admin', name: 'Rajesh Sharma', email: 'admin@acme.com', passwordHash, role: UserRole.admin, orgId: org.id, isActive: true, lastLoginAt: DAYS(-1) } }),
    db.user.upsert({ where: { email: 'priya@acme.com' }, update: {}, create: { id: 'user-priya', name: 'Priya Patel', email: 'priya@acme.com', passwordHash, role: UserRole.manager, departmentId: 'dept-finance', orgId: org.id, isActive: true, lastLoginAt: DAYS(-2) } }),
    db.user.upsert({ where: { email: 'amit@acme.com' }, update: {}, create: { id: 'user-amit', name: 'Amit Kumar', email: 'amit@acme.com', passwordHash, role: UserRole.manager, departmentId: 'dept-legal', orgId: org.id, isActive: true, lastLoginAt: DAYS(-1) } }),
    db.user.upsert({ where: { email: 'sneha@acme.com' }, update: {}, create: { id: 'user-sneha', name: 'Sneha Reddy', email: 'sneha@acme.com', passwordHash, role: UserRole.member, departmentId: 'dept-hr', orgId: org.id, isActive: true, lastLoginAt: DAYS(-3) } }),
    db.user.upsert({ where: { email: 'vikram@acme.com' }, update: {}, create: { id: 'user-vikram', name: 'Vikram Singh', email: 'vikram@acme.com', passwordHash, role: UserRole.member, departmentId: 'dept-finance', orgId: org.id, isActive: true, lastLoginAt: DAYS(-5) } }),
    db.user.upsert({ where: { email: 'neha@acme.com' }, update: {}, create: { id: 'user-neha', name: 'Neha Gupta', email: 'neha@acme.com', passwordHash, role: UserRole.member, departmentId: 'dept-ops', orgId: org.id, isActive: true } }),
    db.user.upsert({ where: { email: 'arjun@acme.com' }, update: {}, create: { id: 'user-arjun', name: 'Arjun Mehta', email: 'arjun@acme.com', passwordHash, role: UserRole.viewer, departmentId: 'dept-finance', orgId: org.id, isActive: true } }),
  ]);

  // Set department heads
  await db.department.update({ where: { id: 'dept-finance' }, data: { headId: 'user-priya' } });
  await db.department.update({ where: { id: 'dept-legal' }, data: { headId: 'user-amit' } });
  await db.department.update({ where: { id: 'dept-hr' }, data: { headId: 'user-sneha' } });

  // ─── Compliance Items ───
  const complianceData = [
    { id: 'comp-1', title: 'GSTR-3B Monthly Return - June 2025', description: 'Monthly GST return for outward and inward supplies, input tax credit, and tax liability.', complianceType: ComplianceType.GST, status: ComplianceStatus.pending, priority: Priority.high, dueDate: DAYS(-3), departmentId: 'dept-finance', assignedToId: 'user-priya', orgId: org.id },
    { id: 'comp-2', title: 'TDS Return Q1 FY 2025-26 (Form 24Q)', description: 'Quarterly TDS return for salary deductions. Due within 31 days of quarter end.', complianceType: ComplianceType.TDS, status: ComplianceStatus.overdue, priority: Priority.critical, dueDate: DAYS(-15), departmentId: 'dept-finance', assignedToId: 'user-vikram', orgId: org.id },
    { id: 'comp-3', title: 'MCA Annual Return - Form MGT-7', description: 'Annual return filed with ROC containing details of shareholders, directors, and financials.', complianceType: ComplianceType.MCA, status: ComplianceStatus.in_progress, priority: Priority.high, dueDate: DAYS(25), departmentId: 'dept-legal', assignedToId: 'user-amit', orgId: org.id },
    { id: 'comp-4', title: 'PF Monthly Return - June 2025', description: 'Provident Fund monthly return with employee and employer contribution details.', complianceType: ComplianceType.PF, status: ComplianceStatus.completed, priority: Priority.high, dueDate: DAYS(-10), completedAt: DAYS(-12), departmentId: 'dept-hr', assignedToId: 'user-sneha', orgId: org.id },
    { id: 'comp-5', title: 'ESIC Half-Yearly Return', description: 'Employee State Insurance half-yearly return filing.', complianceType: ComplianceType.ESIC, status: ComplianceStatus.pending, priority: Priority.medium, dueDate: DAYS(12), departmentId: 'dept-hr', assignedToId: 'user-sneha', orgId: org.id },
    { id: 'comp-6', title: 'Advance Tax - Q1 Installment', description: 'First quarter advance tax payment as per Section 208 of Income Tax Act.', complianceType: ComplianceType.INCOME_TAX, status: ComplianceStatus.overdue, priority: Priority.critical, dueDate: DAYS(-20), departmentId: 'dept-finance', assignedToId: 'user-priya', orgId: org.id },
    { id: 'comp-7', title: 'GST Annual Return - Form GSTR-9', description: 'Annual consolidated return under GST for FY 2024-25.', complianceType: ComplianceType.GST, status: ComplianceStatus.pending, priority: Priority.high, dueDate: DAYS(45), departmentId: 'dept-finance', assignedToId: 'user-vikram', orgId: org.id },
    { id: 'comp-8', title: 'ROC Board Resolution Filing', description: 'File board resolutions passed in the last quarter with Registrar of Companies.', complianceType: ComplianceType.ROC, status: ComplianceStatus.draft, priority: Priority.medium, dueDate: DAYS(60), departmentId: 'dept-legal', assignedToId: 'user-amit', orgId: org.id },
    { id: 'comp-9', title: 'Professional Tax Registration Renewal', description: 'Annual renewal of professional tax registration for the organisation.', complianceType: ComplianceType.OTHER, status: ComplianceStatus.completed, priority: Priority.low, dueDate: DAYS(-30), completedAt: DAYS(-35), departmentId: 'dept-hr', assignedToId: 'user-sneha', orgId: org.id },
    { id: 'comp-10', title: 'Environmental Clearance Compliance', description: 'Submit annual environmental compliance report to the pollution control board.', complianceType: ComplianceType.ENVIRONMENTAL, status: ComplianceStatus.in_progress, priority: Priority.high, dueDate: DAYS(8), departmentId: 'dept-ops', assignedToId: 'user-neha', orgId: org.id },
    { id: 'comp-11', title: 'GSTR-1 Monthly Return - July 2025', description: 'Monthly outward supply return for July 2025.', complianceType: ComplianceType.GST, status: ComplianceStatus.pending, priority: Priority.high, dueDate: DAYS(18), departmentId: 'dept-finance', assignedToId: 'user-priya', orgId: org.id },
    { id: 'comp-12', title: 'Labour Welfare Fund Annual Return', description: 'Annual filing for Labour Welfare Fund contributions.', complianceType: ComplianceType.LABOUR, status: ComplianceStatus.pending, priority: Priority.medium, dueDate: DAYS(30), departmentId: 'dept-hr', assignedToId: 'user-sneha', orgId: org.id },
    { id: 'comp-13', title: 'TDS on Property - Form 26QB', description: 'TDS deduction at source on immovable property purchase.', complianceType: ComplianceType.TDS, status: ComplianceStatus.not_applicable, priority: Priority.low, dueDate: DAYS(20), departmentId: 'dept-finance', assignedToId: 'user-arjun', orgId: org.id },
    { id: 'comp-14', title: 'MCA Director KYC - Form DIR-3 KYC', description: 'Annual KYC filing for all directors of the company.', complianceType: ComplianceType.MCA, status: ComplianceStatus.pending, priority: Priority.high, dueDate: DAYS(5), departmentId: 'dept-legal', assignedToId: 'user-amit', orgId: org.id },
    { id: 'comp-15', title: 'Shop & Establishment License Renewal', description: 'Renewal of shop and establishment license under state labour law.', complianceType: ComplianceType.LABOUR, status: ComplianceStatus.completed, priority: Priority.medium, dueDate: DAYS(-45), completedAt: DAYS(-50), departmentId: 'dept-hr', assignedToId: 'user-sneha', orgId: org.id },
    { id: 'comp-16', title: 'GST Audit - FY 2024-25', description: 'GST audit for turnover exceeding prescribed limit. Requires reconciliation of GSTR-1, GSTR-3B, and books.', complianceType: ComplianceType.GST, status: ComplianceStatus.draft, priority: Priority.high, dueDate: DAYS(90), departmentId: 'dept-finance', assignedToId: 'user-priya', orgId: org.id },
    { id: 'comp-17', title: 'Fire Safety Compliance Certificate', description: 'Annual fire safety inspection and certificate renewal for office premises.', complianceType: ComplianceType.ENVIRONMENTAL, status: ComplianceStatus.in_progress, priority: Priority.medium, dueDate: DAYS(15), departmentId: 'dept-ops', assignedToId: 'user-neha', orgId: org.id },
    { id: 'comp-18', title: 'Income Tax Return Filing - AY 2025-26', description: 'Corporate income tax return filing for assessment year 2025-26.', complianceType: ComplianceType.INCOME_TAX, status: ComplianceStatus.pending, priority: Priority.critical, dueDate: DAYS(35), departmentId: 'dept-finance', assignedToId: 'user-vikram', orgId: org.id },
  ];

  for (const c of complianceData) {
    await db.complianceItem.upsert({ where: { id: c.id }, update: {}, create: c });
  }

  // ─── Audit Points ───
  const auditPoints = [
    { title: 'Verify GSTR-3B input tax credit reconciliation', complianceItemId: 'comp-1', assignedToId: 'user-vikram', status: ComplianceStatus.pending, dueDate: DAYS(-1) },
    { title: 'Check TDS deduction certificates issued', complianceItemId: 'comp-2', assignedToId: 'user-arjun', status: ComplianceStatus.completed, dueDate: DAYS(-10), completedAt: DAYS(-12) },
    { title: 'Confirm all director DINs are active', complianceItemId: 'comp-3', assignedToId: 'user-amit', status: ComplianceStatus.in_progress, dueDate: DAYS(10) },
    { title: 'Upload balance sheet and P&L', complianceItemId: 'comp-3', assignedToId: 'user-amit', status: ComplianceStatus.pending, dueDate: DAYS(15) },
    { title: 'Verify PF contribution for all employees', complianceItemId: 'comp-4', assignedToId: 'user-sneha', status: ComplianceStatus.completed, dueDate: DAYS(-12), completedAt: DAYS(-14) },
    { title: 'Check ESIC wage ceiling compliance', complianceItemId: 'comp-5', assignedToId: 'user-sneha', status: ComplianceStatus.pending, dueDate: DAYS(8) },
    { title: 'Obtain Form 16A from all deductees', complianceItemId: 'comp-2', assignedToId: 'user-vikram', status: ComplianceStatus.overdue, dueDate: DAYS(-18) },
    { title: 'Prepare environmental impact summary', complianceItemId: 'comp-10', assignedToId: 'user-neha', status: ComplianceStatus.in_progress, dueDate: DAYS(5) },
    { title: 'Fire drill documentation and sign-off', complianceItemId: 'comp-17', assignedToId: 'user-neha', status: ComplianceStatus.pending, dueDate: DAYS(10) },
  ];

  for (const ap of auditPoints) {
    await db.auditPoint.create({ data: ap });
  }

  // ─── Documents ───
  const docs = [
    { name: 'GSTR-3B_June2025_draft.pdf', fileUrl: '/documents/gstr3b-june2025.pdf', fileType: 'application/pdf', complianceItemId: 'comp-1', uploadedById: 'user-priya' },
    { name: 'TDS_Q1_challan.pdf', fileUrl: '/documents/tds-q1-challan.pdf', fileType: 'application/pdf', complianceItemId: 'comp-2', uploadedById: 'user-vikram' },
    { name: 'Balance_Sheet_FY2024-25.xlsx', fileUrl: '/documents/bs-fy25.xlsx', fileType: 'application/vnd.ms-excel', complianceItemId: 'comp-3', uploadedById: 'user-amit' },
    { name: 'PF_Contribution_June.csv', fileUrl: '/documents/pf-june.csv', fileType: 'text/csv', complianceItemId: 'comp-4', uploadedById: 'user-sneha' },
    { name: 'Environmental_Report_Draft.docx', fileUrl: '/documents/env-report.docx', fileType: 'application/vnd.openxmlformats', complianceItemId: 'comp-10', uploadedById: 'user-neha' },
    { name: 'Fire_Safety_Inspection.pdf', fileUrl: '/documents/fire-safety.pdf', fileType: 'application/pdf', complianceItemId: 'comp-17', uploadedById: 'user-neha' },
  ];

  for (const d of docs) {
    await db.document.create({ data: d });
  }

  // ─── Comments ───
  const comments = [
    { content: 'GSTR-3B draft is ready for review. Please check the input tax credit figures before filing.', entityId: 'comp-1', entityType: 'compliance', complianceItemId: 'comp-1', authorId: 'user-priya' },
    { content: 'TDS return has been filed. Challan payment confirmed. CN no: 42891234.', entityId: 'comp-2', entityType: 'compliance', complianceItemId: 'comp-2', authorId: 'user-vikram' },
    { content: 'Pending Form 16A from two vendors. Following up.', entityId: 'comp-2', entityType: 'compliance', complianceItemId: 'comp-2', authorId: 'user-vikram' },
    { content: 'Board resolution for MGT-7 signed by all directors on 15th July.', entityId: 'comp-3', entityType: 'compliance', complianceItemId: 'comp-3', authorId: 'user-amit' },
    { content: 'PF return filed successfully. Acknowledgment no: PF/2025/06/12345.', entityId: 'comp-4', entityType: 'compliance', complianceItemId: 'comp-4', authorId: 'user-sneha' },
    { content: 'Environmental report is 80% complete. Need emission monitoring data from ops team.', entityId: 'comp-10', entityType: 'compliance', complianceItemId: 'comp-10', authorId: 'user-neha' },
  ];

  for (const c of comments) {
    await db.comment.create({ data: { ...c, createdAt: DAYS(-Math.floor(Math.random() * 10) - 1) } });
  }

  // ─── Notifications ───
  const notifications = [
    { userId: 'user-priya', title: 'Overdue: GSTR-3B June 2025', message: 'GSTR-3B for June 2025 was due 3 days ago. Please file immediately to avoid penalty.', type: 'deadline_reminder' as const, isRead: false },
    { userId: 'user-vikram', title: 'Overdue: TDS Return Q1', message: 'TDS Return Q1 FY 2025-26 (Form 24Q) is overdue by 15 days. Immediate action required.', type: 'deadline_reminder' as const, isRead: false },
    { userId: 'user-amit', title: 'Assigned: MCA Annual Return', message: 'You have been assigned MCA Annual Return - Form MGT-7. Due date: 25 days from now.', type: 'assignment' as const, isRead: true },
    { userId: 'user-sneha', title: 'Completed: PF Monthly Return', message: 'PF Monthly Return - June 2025 has been marked as completed.', type: 'status_change' as const, isRead: true },
    { userId: 'user-neha', title: 'Upcoming: Environmental Clearance', message: 'Environmental Clearance Compliance is due in 8 days. Please ensure report is ready.', type: 'deadline_reminder' as const, isRead: false },
    { userId: 'user-amit', title: 'Upcoming: Director KYC', message: 'MCA Director KYC - Form DIR-3 KYC is due in 5 days.', type: 'deadline_reminder' as const, isRead: false },
    { userId: 'user-priya', title: 'Comment on GSTR-3B June 2025', message: 'Vikram commented on GSTR-3B June 2025: "Draft is ready for review."', type: 'comment' as const, isRead: true },
    { userId: 'user-admin', title: 'System: 2 items overdue', message: 'There are 2 compliance items currently overdue in your organisation.', type: 'system' as const, isRead: false },
  ];

  for (const n of notifications) {
    await db.notification.create({ data: { userId: n.userId, title: n.title, message: n.message, type: n.type as any, isRead: n.isRead, createdAt: DAYS(-Math.floor(Math.random() * 5) - 1) } });
  }

  // ─── Audit Logs ───
  const auditLogs = [
    { userId: 'user-priya', action: 'create', entityType: 'compliance', entityId: 'comp-1', details: 'Created GSTR-3B Monthly Return - June 2025' },
    { userId: 'user-priya', action: 'update', entityType: 'compliance', entityId: 'comp-1', details: 'Updated status to pending' },
    { userId: 'user-vikram', action: 'update', entityType: 'compliance', entityId: 'comp-2', details: 'Changed status from in_progress to overdue' },
    { userId: 'user-sneha', action: 'status_change', entityType: 'compliance', entityId: 'comp-4', details: 'Marked PF Monthly Return as completed' },
    { userId: 'user-admin', action: 'login', entityType: 'user', entityId: 'user-admin', details: 'User logged in' },
    { userId: 'user-amit', action: 'assign', entityType: 'compliance', entityId: 'comp-3', details: 'Assigned MCA Annual Return to Amit Kumar' },
    { userId: 'user-neha', action: 'create', entityType: 'document', entityId: 'comp-10', details: 'Uploaded Environmental_Report_Draft.docx' },
    { userId: 'user-priya', action: 'create', entityType: 'compliance', entityId: 'comp-1', details: 'Added comment on GSTR-3B June 2025' },
  ];

  for (const a of auditLogs) {
    await db.auditLog.create({ data: { userId: a.userId, action: a.action as any, entityType: a.entityType, entityId: a.entityId, details: a.details, createdAt: DAYS(-Math.floor(Math.random() * 15) - 1) } });
  }

  console.log('✅ Seed complete!');
  console.log(`   Organisation: ${org.name}`);
  console.log(`   Departments: ${departments.length}`);
  console.log(`   Users: ${users.length}`);
  console.log(`   Compliance Items: ${complianceData.length}`);
  console.log(`   Audit Points: ${auditPoints.length}`);
  console.log(`   Documents: ${docs.length}`);
  console.log(`   Comments: ${comments.length}`);
  console.log(`   Notifications: ${notifications.length}`);
  console.log(`   Audit Logs: ${auditLogs.length}`);
}

seed()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());