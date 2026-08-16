// Wave 111: creates real Supabase Auth logins for the 20 hero personas
// (director + first HOD per company, 10 companies) and prints the SQL to
// link auth_user_id + seed ai_assistants -- run that SQL separately via the
// Supabase MCP execute_sql tool. Uses supabase-js admin client only
// (SUPABASE_URL + SERVICE_ROLE_KEY from .env.local), no DATABASE_URL needed.
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const heroes: { userId: string; email: string }[] = [
  { userId: "demo_co_1_sharma_u0", email: "rohit.sharma.0@sharma-associates.veridiandemo.internal" },
  { userId: "demo_co_1_sharma_u2", email: "amit.sharma.2@sharma-associates.veridiandemo.internal" },
  { userId: "demo_co_2_meridian_u0", email: "rohit.sharma.0@meridian-auto.veridiandemo.internal" },
  { userId: "demo_co_2_meridian_u2", email: "amit.sharma.2@meridian-auto.veridiandemo.internal" },
  { userId: "demo_co_3_campus_u0", email: "rohit.sharma.0@campus-facilities.veridiandemo.internal" },
  { userId: "demo_co_3_campus_u2", email: "amit.sharma.2@campus-facilities.veridiandemo.internal" },
  { userId: "demo_co_4_velocity_u0", email: "rohit.sharma.0@velocity-softworks.veridiandemo.internal" },
  { userId: "demo_co_4_velocity_u2", email: "amit.sharma.2@velocity-softworks.veridiandemo.internal" },
  { userId: "demo_co_5_apex_u0", email: "rohit.sharma.0@apex-consulting.veridiandemo.internal" },
  { userId: "demo_co_5_apex_u2", email: "amit.sharma.2@apex-consulting.veridiandemo.internal" },
  { userId: "demo_co_6_horizon_u0", email: "rohit.sharma.0@horizon-logistics.veridiandemo.internal" },
  { userId: "demo_co_6_horizon_u2", email: "amit.sharma.2@horizon-logistics.veridiandemo.internal" },
  { userId: "demo_co_7_grandvista_u0", email: "rohit.sharma.0@grandvista-hotels.veridiandemo.internal" },
  { userId: "demo_co_7_grandvista_u2", email: "amit.sharma.2@grandvista-hotels.veridiandemo.internal" },
  { userId: "demo_co_8_skyline_u0", email: "rohit.sharma.0@skyline-construction.veridiandemo.internal" },
  { userId: "demo_co_8_skyline_u2", email: "amit.sharma.2@skyline-construction.veridiandemo.internal" },
  { userId: "demo_co_9_rise_u0", email: "rohit.sharma.0@rise-academy.veridiandemo.internal" },
  { userId: "demo_co_9_rise_u2", email: "amit.sharma.2@rise-academy.veridiandemo.internal" },
  { userId: "demo_co_10_wellness_u0", email: "rohit.sharma.0@wellness-care.veridiandemo.internal" },
  { userId: "demo_co_10_wellness_u2", email: "amit.sharma.2@wellness-care.veridiandemo.internal" },
]

async function main() {
  const sql: string[] = []
  const created: { userId: string; email: string; authId: string }[] = []
  for (const h of heroes) {
    const { data, error } = await admin.auth.admin.createUser({
      email: h.email, password: "DemoVeridian2026!", email_confirm: true,
    })
    if (error) {
      console.error(`FAILED ${h.email}: ${error.message}`)
      continue
    }
    created.push({ ...h, authId: data.user!.id })
  }

  for (const c of created) {
    sql.push(`update compliance.users set auth_user_id = '${c.authId}' where id = '${c.userId}';`)
    for (let n = 1; n <= 5; n++) {
      sql.push(`insert into compliance.ai_assistants (id, user_id, assistant_number, label, status) values (gen_random_uuid()::text, '${c.userId}', ${n}, 'Assistant ${n}', 'idle') on conflict do nothing;`)
    }
  }

  console.log(sql.join("\n"))
  console.error(`\nCreated ${created.length}/${heroes.length} auth users.`)
}
main()
