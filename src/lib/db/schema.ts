import { pgSchema, pgEnum, text, boolean, integer, timestamp } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { relations } from 'drizzle-orm'

export const complianceSchemaDB = pgSchema('compliance')

export const userRoleEnum = complianceSchemaDB.enum('user_role', ['admin', 'manager', 'member', 'viewer'])
export const complianceStatusEnum = complianceSchemaDB.enum('compliance_status', ['pending', 'in_progress', 'completed', 'overdue', 'not_applicable', 'draft'])
export const priorityEnum = complianceSchemaDB.enum('priority', ['low', 'medium', 'high', 'critical'])
export const complianceTypeEnum = complianceSchemaDB.enum('compliance_type', ['GST', 'TDS', 'MCA', 'PF', 'ESIC', 'INCOME_TAX', 'ROC', 'LABOUR', 'ENVIRONMENTAL', 'OTHER'])
export const notificationTypeEnum = complianceSchemaDB.enum('notification_type', ['deadline_reminder', 'assignment', 'status_change', 'comment', 'system', 'mention'])
export const auditActionEnum = complianceSchemaDB.enum('audit_action', ['create', 'update', 'delete', 'status_change', 'assign', 'reassign', 'login', 'logout', 'export', 'invite'])

export const organisations = complianceSchemaDB.table('organisations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  plan: text('plan').notNull().default('free'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const departments = complianceSchemaDB.table('departments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  orgId: text('org_id').notNull(),
  headId: text('head_id').unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const users = complianceSchemaDB.table('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('member'),
  avatarUrl: text('avatar_url'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at'),
  orgId: text('org_id'),
  departmentId: text('department_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const complianceItems = complianceSchemaDB.table('compliance_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  description: text('description'),
  complianceType: complianceTypeEnum('compliance_type').notNull(),
  status: complianceStatusEnum('status').notNull().default('pending'),
  priority: priorityEnum('priority').notNull().default('medium'),
  dueDate: timestamp('due_date').notNull(),
  completedAt: timestamp('completed_at'),
  departmentId: text('department_id').notNull(),
  assignedToId: text('assigned_to_id'),
  orgId: text('org_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const auditPoints = complianceSchemaDB.table('audit_points', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  description: text('description'),
  status: complianceStatusEnum('status').notNull().default('pending'),
  dueDate: timestamp('due_date'),
  completedAt: timestamp('completed_at'),
  complianceItemId: text('compliance_item_id').notNull(),
  assignedToId: text('assigned_to_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const documents = complianceSchemaDB.table('documents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  fileUrl: text('file_url').notNull(),
  fileType: text('file_type'),
  fileSize: integer('file_size'),
  complianceItemId: text('compliance_item_id').notNull(),
  uploadedById: text('uploaded_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const comments = complianceSchemaDB.table('comments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  content: text('content').notNull(),
  entityId: text('entity_id').notNull(),
  entityType: text('entity_type').notNull().default('compliance'),
  authorId: text('author_id').notNull(),
  complianceItemId: text('compliance_item_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const notifications = complianceSchemaDB.table('notifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: notificationTypeEnum('type').notNull().default('system'),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const auditLogs = complianceSchemaDB.table('audit_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  action: auditActionEnum('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  userId: text('user_id').notNull(),
  details: text('details'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Relations
export const organisationsRelations = relations(organisations, ({ many }) => ({
  users: many(users),
  departments: many(departments),
  complianceItems: many(complianceItems),
}))

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  org: one(organisations, { fields: [departments.orgId], references: [organisations.id] }),
  head: one(users, { fields: [departments.headId], references: [users.id], relationName: 'deptHead' }),
  users: many(users),
  complianceItems: many(complianceItems),
}))

export const usersRelations = relations(users, ({ one, many }) => ({
  org: one(organisations, { fields: [users.orgId], references: [organisations.id] }),
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
  assignedCompliance: many(complianceItems, { relationName: 'assignedTo' }),
  auditPointAssignments: many(auditPoints, { relationName: 'auditAssignee' }),
  headOfDept: one(departments, { fields: [users.id], references: [departments.headId], relationName: 'deptHead' }),
  auditLogs: many(auditLogs),
  comments: many(comments),
  uploadedDocuments: many(documents),
}))

export const complianceItemsRelations = relations(complianceItems, ({ one, many }) => ({
  department: one(departments, { fields: [complianceItems.departmentId], references: [departments.id] }),
  assignedTo: one(users, { fields: [complianceItems.assignedToId], references: [users.id], relationName: 'assignedTo' }),
  org: one(organisations, { fields: [complianceItems.orgId], references: [organisations.id] }),
  auditPoints: many(auditPoints),
  documents: many(documents),
  comments: many(comments),
}))

export const auditPointsRelations = relations(auditPoints, ({ one }) => ({
  complianceItem: one(complianceItems, { fields: [auditPoints.complianceItemId], references: [complianceItems.id] }),
  assignedTo: one(users, { fields: [auditPoints.assignedToId], references: [users.id], relationName: 'auditAssignee' }),
}))

export const documentsRelations = relations(documents, ({ one }) => ({
  complianceItem: one(complianceItems, { fields: [documents.complianceItemId], references: [complianceItems.id] }),
  uploadedBy: one(users, { fields: [documents.uploadedById], references: [users.id] }),
}))

export const commentsRelations = relations(comments, ({ one }) => ({
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
  complianceItem: one(complianceItems, { fields: [comments.complianceItemId], references: [complianceItems.id] }),
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}))
