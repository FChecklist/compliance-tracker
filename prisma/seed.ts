import { PrismaClient, ComplianceStatus, Priority, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);
const daysFromNow = (d: number) => new Date(now.getTime() + d * 86400000);

async function main() {
  console.log("🌱 Seeding ComplianceTrack database...");

  // --- Departments ---
  const departments = await Promise.all([
    prisma.department.upsert({ where: { id: "dept-fin" }, update: {}, create: { id: "dept-fin", name: "Finance", description: "GST, TDS, advance tax, and financial compliance" } }),
    prisma.department.upsert({ where: { id: "dept-legal" }, update: {}, create: { id: "dept-legal", name: "Legal", description: "MCA filings, contracts, and regulatory compliance" } }),
    prisma.department.upsert({ where: { id: "dept-hr" }, update: {}, create: { id: "dept-hr", name: "Human Resources", description: "PF, ESIC, POSH, and labour law compliance" } }),
    prisma.department.upsert({ where: { id: "dept-it" }, update: {}, create: { id: "dept-it", name: "IT & Security", description: "Software licences, cybersecurity, and data protection" } }),
    prisma.department.upsert({ where: { id: "dept-ops" }, update: {}, create: { id: "dept-ops", name: "Operations", description: "Factory licences, pollution control, FSSAI, and safety" } }),
  ]);
  console.log(`✅ Created ${departments.length} departments`);

  // --- Users ---
  const users = await Promise.all([
    prisma.user.upsert({ where: { email: "admin@compliancetrack.com" }, update: {}, create: { id: "user-admin", name: "Rajesh Sharma", email: "admin@compliancetrack.com", role: UserRole.admin, departmentId: "dept-fin" } }),
    prisma.user.upsert({ where: { email: "priya@compliancetrack.com" }, update: {}, create: { id: "user-mgr1", name: "Priya Patel", email: "priya@compliancetrack.com", role: UserRole.manager, departmentId: "dept-legal" } }),
    prisma.user.upsert({ where: { email: "amit@compliancetrack.com" }, update: {}, create: { id: "user-mem1", name: "Amit Kumar", email: "amit@compliancetrack.com", role: UserRole.member, departmentId: "dept-hr" } }),
    prisma.user.upsert({ where: { email: "sneha@compliancetrack.com" }, update: {}, create: { id: "user-mem2", name: "Sneha Reddy", email: "sneha@compliancetrack.com", role: UserRole.member, departmentId: "dept-it" } }),
  ]);
  console.log(`✅ Created ${users.length} users`);

  // --- Compliance Items ---
  const complianceItems = [
    // Finance
    { id: "comp-1", title: "GST Return Filing - July 2025", description: "File GSTR-3B for the month of July 2025 before the 20th August deadline.", complianceType: "GST", status: ComplianceStatus.completed, priority: Priority.high, dueDate: daysAgo(10), departmentId: "dept-fin" },
    { id: "comp-2", title: "TDS Return Q1 FY25-26", description: "Quarterly TDS return filing for April-June 2025 quarter.", complianceType: "TDS", status: ComplianceStatus.completed, priority: Priority.high, dueDate: daysAgo(25), departmentId: "dept-fin" },
    { id: "comp-3", title: "Advance Tax - 2nd Installment", description: "Pay 2nd installment of advance tax for FY 2025-26 (45% of total).", complianceType: "Income Tax", status: ComplianceStatus.in_progress, priority: Priority.critical, dueDate: daysFromNow(12), departmentId: "dept-fin" },
    { id: "comp-4", title: "GST Annual Return - FY24-25", description: "File GSTR-9 annual return for financial year 2024-25.", complianceType: "GST", status: ComplianceStatus.pending, priority: Priority.high, dueDate: daysFromNow(45), departmentId: "dept-fin" },
    { id: "comp-5", title: "Provident Fund Monthly Return", description: "Submit PF monthly return for employee contributions.", complianceType: "PF", status: ComplianceStatus.overdue, priority: Priority.critical, dueDate: daysAgo(3), departmentId: "dept-fin" },

    // Legal
    { id: "comp-6", title: "MCA Annual Return Filing", description: "File AOC-4 and MGT-7 with the Ministry of Corporate Affairs.", complianceType: "MCA Filing", status: ComplianceStatus.pending, priority: Priority.high, dueDate: daysFromNow(30), departmentId: "dept-legal" },
    { id: "comp-7", title: "DIR-3 KYC Due", description: "Complete annual KYC for all directors before the due date.", complianceType: "MCA Filing", status: ComplianceStatus.in_progress, priority: Priority.medium, dueDate: daysFromNow(20), departmentId: "dept-legal" },
    { id: "comp-8", title: "Board Meeting Minutes - Q2", description: "Prepare and file board meeting minutes for Q2 2025.", complianceType: "Corporate Governance", status: ComplianceStatus.pending, priority: Priority.medium, dueDate: daysFromNow(60), departmentId: "dept-legal" },
    { id: "comp-9", title: "Trademark Renewal - Brand Logo", description: "Renew trademark registration for the company brand logo.", complianceType: "IP Compliance", status: ComplianceStatus.overdue, priority: Priority.high, dueDate: daysAgo(7), departmentId: "dept-legal" },

    // HR
    { id: "comp-10", title: "ESIC Half-Yearly Return", description: "Submit ESIC half-yearly return for Jan-Jun 2025.", complianceType: "ESIC", status: ComplianceStatus.completed, priority: Priority.medium, dueDate: daysAgo(15), departmentId: "dept-hr" },
    { id: "comp-11", title: "POSH Annual Compliance Report", description: "Submit annual report for Prevention of Sexual Harassment committee.", complianceType: "Labour Law", status: ComplianceStatus.pending, priority: Priority.high, dueDate: daysFromNow(25), departmentId: "dept-hr" },
    { id: "comp-12", title: "Professional Tax Registration Renewal", description: "Renew professional tax registration certificate.", complianceType: "Labour Law", status: ComplianceStatus.in_progress, priority: Priority.low, dueDate: daysFromNow(90), departmentId: "dept-hr" },

    // IT & Security
    { id: "comp-13", title: "Cybersecurity Audit - Annual", description: "Complete annual cybersecurity audit and submit report to management.", complianceType: "Cybersecurity", status: ComplianceStatus.in_progress, priority: Priority.critical, dueDate: daysFromNow(5), departmentId: "dept-it" },
    { id: "comp-14", title: "Software Licence Renewal - Adobe CC", description: "Renew Adobe Creative Cloud enterprise licenses for the design team.", complianceType: "Software Licence", status: ComplianceStatus.pending, priority: Priority.medium, dueDate: daysFromNow(18), departmentId: "dept-it" },
    { id: "comp-15", title: "Data Protection Impact Assessment", description: "Complete DPIA for new customer data processing workflow.", complianceType: "Data Protection", status: ComplianceStatus.overdue, priority: Priority.high, dueDate: daysAgo(2), departmentId: "dept-it" },
    { id: "comp-16", title: "Server SSL Certificate Renewal", description: "Renew SSL certificates for production web servers.", complianceType: "IT Infrastructure", status: ComplianceStatus.completed, priority: Priority.high, dueDate: daysAgo(5), departmentId: "dept-it" },

    // Operations
    { id: "comp-17", title: "Factory Licence Renewal", description: "Renew factory operating licence with the local factory inspector.", complianceType: "Factory Licence", status: ComplianceStatus.pending, priority: Priority.critical, dueDate: daysFromNow(15), departmentId: "dept-ops" },
    { id: "comp-18", title: "Pollution Control Board Consent", description: "Obtain renewed consent to operate from State Pollution Control Board.", complianceType: "Environmental", status: ComplianceStatus.in_progress, priority: Priority.high, dueDate: daysFromNow(22), departmentId: "dept-ops" },
    { id: "comp-19", title: "FSSAI Licence Renewal", description: "Renew Food Safety and Standards Authority licence for the cafeteria.", complianceType: "FSSAI", status: ComplianceStatus.not_applicable, priority: Priority.low, dueDate: null, departmentId: "dept-ops" },
    { id: "comp-20", title: "Fire Safety Certificate", description: "Obtain annual fire safety NOC from the local fire department.", complianceType: "Safety", status: ComplianceStatus.pending, priority: Priority.high, dueDate: daysFromNow(35), departmentId: "dept-ops" },
  ];

  for (const item of complianceItems) {
    await prisma.complianceItem.upsert({
      where: { id: item.id },
      update: {},
      create: item,
    });
  }
  console.log(`✅ Created ${complianceItems.length} compliance items`);

  // --- Audit Logs ---
  const auditLogs = [
    { action: "created", entityType: "ComplianceItem", entityId: "comp-1", userId: "user-admin", details: "Created GST Return Filing - July 2025" },
    { action: "status_changed", entityType: "ComplianceItem", entityId: "comp-1", userId: "user-admin", details: "Status changed from pending to completed" },
    { action: "created", entityType: "ComplianceItem", entityId: "comp-5", userId: "user-admin", details: "Created PF Monthly Return filing task" },
    { action: "status_changed", entityType: "ComplianceItem", entityId: "comp-5", userId: "user-mgr1", details: "Status changed to overdue - deadline missed" },
    { action: "created", entityType: "ComplianceItem", entityId: "comp-13", userId: "user-mem2", details: "Created Cybersecurity Audit task" },
    { action: "assigned", entityType: "ComplianceItem", entityId: "comp-17", userId: "user-admin", details: "Assigned Factory Licence Renewal to Operations team" },
    { action: "comment_added", entityType: "ComplianceItem", entityId: "comp-3", userId: "user-admin", details: "Reminder: 2nd advance tax installment due soon" },
    { action: "created", entityType: "ComplianceItem", entityId: "comp-9", userId: "user-mgr1", details: "Trademark renewal flagged as overdue" },
    { action: "status_changed", entityType: "ComplianceItem", entityId: "comp-16", userId: "user-mem2", details: "SSL certificates renewed successfully" },
    { action: "created", entityType: "Department", entityId: "dept-ops", userId: "user-admin", details: "Operations department created" },
  ];

  for (const log of auditLogs) {
    await prisma.auditLog.upsert({
      where: { id: `log-${log.entityId}-${log.action}` },
      update: {},
      create: { id: `log-${log.entityId}-${log.action}`, ...log },
    });
  }
  console.log(`✅ Created ${auditLogs.length} audit log entries`);
  console.log("\n🎉 Seeding complete! ComplianceTrack is ready.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
