// Wave 111 (v2): 10 demo companies, 50 staff + 50 customers each, via
// SET-BASED SQL (generate_series) instead of one INSERT per row -- keeps
// the generated SQL small enough to actually execute given 10x the company
// count. No OpenRouter/customer_model_config here -- per user's pivot,
// Claude Code Desktop itself reasons through L1-L4 for this test, not a
// routed API model.
const THE_FIRM_ID = "07d93fe6-fe3f-4546-bc1f-00b8ff51efd2"
const FM_ID = "23728f64-58ab-4d9c-ab1f-6891f92d2ab7"
const PMS_ID = "a4e6147d-8e4b-434a-954b-821d3686c1c5"

type Company = {
  id: string; slug: string; name: string; entityType: string
  depts: string[]; branchId: string | null
  extra: "firm" | "erp" | null
}

const companies: Company[] = [
  { id: "demo_co_1_sharma", slug: "sharma-associates", name: "Sharma & Associates LLP", entityType: "professional_firm",
    depts: ["Tax Practice", "Audit & Assurance", "Company Secretarial", "Legal Advisory", "Admin & Ops"], branchId: THE_FIRM_ID, extra: "firm" },
  { id: "demo_co_2_meridian", slug: "meridian-auto", name: "Meridian Auto Components Pvt Ltd", entityType: "company",
    depts: ["Finance & Accounts", "Plant Operations", "Procurement", "HR & Admin", "Quality"], branchId: null, extra: "erp" },
  { id: "demo_co_3_campus", slug: "campus-facilities", name: "Campus Facilities Services Pvt Ltd", entityType: "company",
    depts: ["Facilities Ops", "Security & Housekeeping", "Maintenance", "HR & Admin", "Vendor Management"], branchId: FM_ID, extra: null },
  { id: "demo_co_4_velocity", slug: "velocity-softworks", name: "Velocity Softworks Pvt Ltd", entityType: "company",
    depts: ["Engineering", "Product", "Customer Success", "Sales & Marketing", "Ops"], branchId: PMS_ID, extra: null },
  { id: "demo_co_5_apex", slug: "apex-consulting", name: "Apex Consulting Group", entityType: "professional_firm",
    depts: ["Strategy Practice", "Legal & Compliance", "HR Advisory", "Business Development", "Admin"], branchId: null, extra: null },
  { id: "demo_co_6_horizon", slug: "horizon-logistics", name: "Horizon Freight & Logistics Pvt Ltd", entityType: "company",
    depts: ["Fleet Operations", "Warehousing", "Finance & Accounts", "HR & Admin", "Customer Service"], branchId: null, extra: "erp" },
  { id: "demo_co_7_grandvista", slug: "grandvista-hotels", name: "Grand Vista Hotels Pvt Ltd", entityType: "company",
    depts: ["Front Office", "Housekeeping", "Food & Beverage", "HR & Admin", "Engineering"], branchId: FM_ID, extra: null },
  { id: "demo_co_8_skyline", slug: "skyline-construction", name: "Skyline Construction Co", entityType: "company",
    depts: ["Site Operations", "Safety & Compliance", "Procurement", "Finance & Accounts", "HR & Admin"], branchId: PMS_ID, extra: null },
  { id: "demo_co_9_rise", slug: "rise-academy", name: "Rise Academy Trust", entityType: "professional_firm",
    depts: ["Academics", "Admissions", "Compliance & Governance", "HR & Admin", "Campus Facilities"], branchId: null, extra: null },
  { id: "demo_co_10_wellness", slug: "wellness-care", name: "Wellness Care Hospitals Pvt Ltd", entityType: "company",
    depts: ["Clinical Operations", "Patient Services", "Compliance & Governance", "HR & Admin", "Legal"], branchId: null, extra: null },
]

const FIRST_NAMES = ["Rohit","Priya","Amit","Sunita","Vikram","Anjali","Rahul","Neha","Sanjay","Pooja","Arjun","Kavita","Deepak","Meera","Rajesh","Swati","Vivek","Anita","Manoj","Ritu","Ashok","Divya","Suresh","Nisha","Karan","Shreya","Ajay","Preeti","Ramesh","Sonia","Naveen","Geeta","Vinod","Kiran","Sandeep","Rekha","Alok","Sarita","Gopal","Aarti","Harish","Bhavna","Dinesh","Lata","Mahesh","Usha","Prakash","Vandana","Yogesh","Seema"]
const LAST_NAMES = ["Sharma","Verma","Gupta","Iyer","Reddy","Nair","Patel","Singh","Rao","Mehta","Joshi","Kulkarni","Agarwal","Chatterjee","Bose","Menon","Pillai","Desai","Kapoor","Malhotra","Chauhan","Bhatt","Trivedi","Saxena","Bansal","Chopra","Dutta","Ghosh","Pandey","Mishra"]
const CUST_LAST_NAMES = ["Iyer","Nair","Rao","Reddy","Menon","Pillai","Kulkarni","Joshi","Trivedi","Saxena"]

function pgArr(arr: string[]) { return "(ARRAY[" + arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(",") + "])" }

const COMPLIANCE_TITLES: [string, string][] = [
  ["GST", "GSTR-3B monthly return"], ["TDS", "TDS payment for salaries"], ["MCA", "Annual return (MGT-7) filing"],
  ["PF", "PF ECR upload"], ["ESIC", "ESIC monthly contribution"], ["INCOME_TAX", "Advance tax installment"],
  ["ROC", "ROC annual filing (AOC-4)"], ["LABOUR", "Labour welfare fund payment"], ["ENVIRONMENTAL", "Pollution control board renewal"],
  ["OTHER", "Board meeting minutes finalisation"],
]

const out: string[] = []

for (const co of companies) {
  out.push(`-- ==== ${co.name} (${co.id}) ====`)
  out.push(`insert into compliance.organisations (id, name, slug, plan, is_active, entity_type, account_type, regulatory_entity_type) values ('${co.id}', '${co.name.replace(/'/g, "''")}', '${co.slug}', 'pro', true, '${co.entityType}', 'company', 'general') on conflict (id) do nothing;`)

  const deptIds = co.depts.map((d) => `${co.id}_dept_${d.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`)
  for (let i = 0; i < co.depts.length; i++) {
    out.push(`insert into compliance.departments (id, name, org_id) values ('${deptIds[i]}', '${co.depts[i].replace(/'/g, "''")}', '${co.id}') on conflict (id) do nothing;`)
  }
  const deptArr = pgArr(deptIds)

  // 50 staff: 0-1 director/admin, 2-5 hod/branch_manager, 6-11 manager, 12-19 senior_professional,
  // 20-34 team_member, 35-44 member, 45-49 external_auditor
  out.push(`
insert into compliance.users (id, name, email, password_hash, role, org_id, department_id, onboarding_completed, is_active)
select
  '${co.id}_u' || s.i,
  ${pgArr(FIRST_NAMES)}[1 + s.i % ${FIRST_NAMES.length}] || ' ' || ${pgArr(LAST_NAMES)}[1 + (s.i / ${FIRST_NAMES.length}) % ${LAST_NAMES.length}] ||
    ' (' || (case when s.i < 2 then 'Managing Director' when s.i < 6 then 'Head of Department' when s.i < 12 then 'Manager'
      when s.i < 20 then 'Senior Consultant' when s.i < 35 then 'Executive' when s.i < 45 then 'Associate' else 'Third-Party Associate' end) || ')',
  lower(${pgArr(FIRST_NAMES)}[1 + s.i % ${FIRST_NAMES.length}] || '.' || ${pgArr(LAST_NAMES)}[1 + (s.i / ${FIRST_NAMES.length}) % ${LAST_NAMES.length}] || '.' || s.i || '@${co.slug}.veridiandemo.internal'),
  'DEMO_NO_LOGIN_PLACEHOLDER',
  (case when s.i < 2 then 'admin' when s.i < 6 then 'branch_manager' when s.i < 12 then 'manager'
    when s.i < 20 then 'senior_professional' when s.i < 35 then 'team_member' when s.i < 45 then 'member' else 'external_auditor' end)::compliance.user_role,
  '${co.id}',
  ${deptArr}[1 + s.i % ${co.depts.length}],
  true, true
from generate_series(0,49) as s(i)
on conflict (id) do nothing;`)

  out.push(`
insert into compliance.employee_profiles (id, user_id, org_id, employee_code, job_title, employment_type)
select gen_random_uuid()::text, u.id, '${co.id}', '${co.slug.toUpperCase()}-' || (1000 + s.i),
  (case when s.i < 2 then 'Managing Director' when s.i < 6 then 'Head of Department' when s.i < 12 then 'Manager'
    when s.i < 20 then 'Senior Consultant' when s.i < 35 then 'Executive' when s.i < 45 then 'Associate' else 'Third-Party Associate' end),
  (case when s.i >= 45 then 'contract' else 'full_time' end)
from generate_series(0,49) as s(i) join compliance.users u on u.id = '${co.id}_u' || s.i
on conflict do nothing;`)

  for (let i = 0; i < co.depts.length; i++) {
    out.push(`update compliance.departments set head_id = '${co.id}_u${2 + i}' where id = '${deptIds[i]}';`)
  }

  if (co.branchId) {
    out.push(`insert into compliance.org_product_branch_enablements (id, org_id, product_branch_id, is_enabled, enabled_at, enabled_by_id) values (gen_random_uuid()::text, '${co.id}', '${co.branchId}', true, now(), '${co.id}_u0') on conflict do nothing;`)
  }

  // 50 customers via crm_leads
  out.push(`
insert into compliance.crm_leads (id, org_id, name, contact_email, contact_phone, source, status, owner_id, created_by_id)
select
  '${co.id}_lead' || s.i,
  '${co.id}',
  ${pgArr(FIRST_NAMES)}[1 + s.i % ${FIRST_NAMES.length}] || ' ' || ${pgArr(CUST_LAST_NAMES)}[1 + s.i % ${CUST_LAST_NAMES.length}] || (case when s.i % 3 = 0 then ' Enterprises' else '' end),
  lower(${pgArr(FIRST_NAMES)}[1 + s.i % ${FIRST_NAMES.length}] || '.' || ${pgArr(CUST_LAST_NAMES)}[1 + s.i % ${CUST_LAST_NAMES.length}] || '.' || s.i || '@customer.veridiandemo.internal'),
  '+91-9' || (800000000 + s.i),
  (ARRAY['referral','website','cold_call','linkedin','walk_in','partner_channel','trade_show','existing_client_upsell'])[1 + s.i % 8],
  (ARRAY['new','contacted','qualified','converted','lost'])[1 + s.i % 5],
  '${co.id}_u' || (1 + (s.i * 7) % 49),
  '${co.id}_u' || (1 + (s.i * 7) % 49)
from generate_series(0,49) as s(i)
on conflict do nothing;`)

  // 15 compliance items
  out.push(`
insert into compliance.compliance_items (id, title, description, compliance_type, status, priority, due_date, department_id, assigned_to_id, org_id)
select
  gen_random_uuid()::text,
  ct.title || ' - ${co.name.replace(/'/g, "''")}',
  'Recurring statutory filing tracked for ${co.name.replace(/'/g, "''")}.',
  ct.ctype::compliance.compliance_type,
  (ARRAY['pending','in_progress','completed','overdue'])[1 + s.i % 4]::compliance.compliance_status,
  (ARRAY['low','medium','high','critical'])[1 + s.i % 4]::compliance.priority,
  now() + ((s.i - 5) || ' days')::interval,
  ${deptArr}[1 + s.i % ${co.depts.length}],
  '${co.id}_u' || (1 + (s.i * 3) % 49),
  '${co.id}'
from generate_series(0,14) as s(i)
join (values ${COMPLIANCE_TITLES.map(([t, title], idx) => `(${idx}, '${t}', '${title}')`).join(",")}) as ct(idx, ctype, title) on ct.idx = s.i % ${COMPLIANCE_TITLES.length};`)

  // 2 meetings
  out.push(`insert into compliance.veri_meetings (id, org_id, title, meeting_type, scheduled_at, attendees, agenda, created_by_id, status) values ('${co.id}_mtg_draft', '${co.id}', 'Weekly Ops Sync - ${co.name.replace(/'/g, "''")}', 'team', now(), '[]'::jsonb, '[]'::jsonb, '${co.id}_u0', 'draft') on conflict do nothing;`)
  out.push(`insert into compliance.veri_meetings (id, org_id, title, meeting_type, scheduled_at, attendees, agenda, minutes, created_by_id, status) values ('${co.id}_mtg_ready', '${co.id}', 'Monthly Review - ${co.name.replace(/'/g, "''")}', 'team', now() - interval '1 day', '["${co.id}_u0","${co.id}_u1","${co.id}_u2","${co.id}_u3"]'::jsonb, '["Review pending compliance items","Discuss client escalations","Headcount planning"]'::jsonb, 'Discussed the pending statutory filing which is due this week - assigned to the relevant team, needs to close by Friday. Customer escalation about delayed response, agreed to have the account manager call back within 24 hours. Also discussed hiring plan for next quarter, 3 new positions approved pending budget sign-off.', '${co.id}_u0', 'draft') on conflict do nothing;`)

  // 5 tickets
  out.push(`
insert into compliance.conversations (id, org_id, type)
select gen_random_uuid()::text, '${co.id}', 'support' from generate_series(0,4);`)
  out.push(`
with conv as (select id, row_number() over () - 1 as i from compliance.conversations where org_id = '${co.id}' and type = 'support' order by created_at desc limit 5)
insert into compliance.tickets (id, org_id, conversation_id, subject, category, priority, status, assignee_id, requester_user_id, created_by_id)
select gen_random_uuid()::text, '${co.id}', conv.id,
  'Customer escalation #' || conv.i || ' - ${co.name.replace(/'/g, "''")}', 'support',
  (ARRAY['low','medium','high'])[1 + conv.i % 3], (ARRAY['open','in_progress','resolved'])[1 + conv.i % 3],
  '${co.id}_u' || conv.i, '${co.id}_u0', '${co.id}_u0'
from conv;`)

  if (co.extra === "firm") {
    out.push(`
insert into compliance.clients (id, org_id, name, is_self, is_active)
select gen_random_uuid()::text, '${co.id}', 'Client ' || s.i, false, true from generate_series(0,14) as s(i);`)
    out.push(`
with cl as (select id, row_number() over (order by created_at) - 1 as i from compliance.clients where org_id = '${co.id}' order by created_at desc limit 15)
insert into compliance.client_entities (id, client_id, legal_name, entity_type)
select gen_random_uuid()::text, cl.id, 'Legal Entity ' || cl.i || ' Pvt Ltd', 'private_limited' from cl;`)
  }
  if (co.extra === "erp") {
    out.push(`
insert into compliance.erp_customers (id, org_id, customer_name, is_active, credit_limit)
select gen_random_uuid()::text, '${co.id}', 'OEM Buyer ' || s.i || ' Ltd', true, 100000 + s.i * 5000 from generate_series(0,14) as s(i);`)
  }

  out.push("")
}

console.log(out.join("\n"))
