#!/usr/bin/env node
// Applies supabase/auth-templates/magic-link.{html,subject.txt} to the live Supabase Auth config of project pcrjmlpuqsbocqfwoxod (SHARED with other apps; the
// template only changes for a DPDP redirect, see the test src/lib/services/dpdp-auth-template.test.ts). Reads the repo file, prints the old template first so
// a revert is one command (--revert-from <file>), then PATCHes the Management API. The token comes from SUPABASE_ACCESS_TOKEN (or --env-file) and is never printed.
//
//   node scripts/apply-auth-template.mjs --env-file C:/ct/ct/.env.local [--dry-run] [--backup C:/ct/auth-template-backup.json]
//   node scripts/apply-auth-template.mjs --env-file ... --revert-from C:/ct/auth-template-backup.json
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const PROJECT = 'pcrjmlpuqsbocqfwoxod'
let token = process.env.SUPABASE_ACCESS_TOKEN || ''
const envFile = opt('--env-file')
if (!token && envFile) {
  const m = /^(?:SUPABASE_ACCESS_TOKEN|SUPABASE_PAT)=(.*)$/m.exec(readFileSync(envFile, 'utf8'))
  token = (m?.[1] ?? '').trim().replace(/^"|"$/g, '')
}
if (!token) { console.error('No Supabase access token (SUPABASE_ACCESS_TOKEN or --env-file).'); process.exit(2) }
const api = `https://api.supabase.com/v1/projects/${PROJECT}/config/auth`
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

const current = await (await fetch(api, { headers })).json()
const backup = opt('--backup') || 'C:/ct/auth-template-backup.json'
const revert = opt('--revert-from')
let body
if (revert) {
  body = JSON.parse(readFileSync(revert, 'utf8'))
} else {
  writeFileSync(backup, JSON.stringify({ mailer_templates_magic_link_content: current.mailer_templates_magic_link_content, mailer_subjects_magic_link: current.mailer_subjects_magic_link }, null, 2))
  const dir = new URL('../supabase/auth-templates/', import.meta.url)
  body = {
    mailer_templates_magic_link_content: readFileSync(new URL('magic-link.html', dir), 'utf8').replace(/\r\n/g, '\n'),
    mailer_subjects_magic_link: readFileSync(new URL('magic-link.subject.txt', dir), 'utf8').replace(/\r\n/g, '\n').trim(),
  }
  console.log(`old template saved to ${backup}`)
}
if (args.includes('--dry-run')) { console.log('dry run: would set', Object.keys(body).join(', ')); process.exit(0) }
const res = await fetch(api, { method: 'PATCH', headers, body: JSON.stringify(body) })
console.log('PATCH', res.status)
const after = await (await fetch(api, { headers })).json()
console.log('template matches:', after.mailer_templates_magic_link_content === body.mailer_templates_magic_link_content, '| subject matches:', after.mailer_subjects_magic_link === body.mailer_subjects_magic_link)
console.log('unchanged settings (reported, not modified): otp_length', after.mailer_otp_length, 'otp_exp_seconds', after.mailer_otp_exp)
