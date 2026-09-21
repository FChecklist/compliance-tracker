// Generates drizzle/0602_dpdp_wo010_library_seed.sql from LIB, verbatim-copied
// from veridian-dpdp.html (lines 296-367 of the spec file) -- do not hand-edit
// the LIB/GO block below; if the spec changes, re-paste it here and re-run.
// "Copy is verbatim... do not rewrite it" (WO-DPDP-010 §0).

var GO='Grievance Officer (responsible for DPDP policy)';
function J(p,t,w,d,ds,dt,law,o){o=o||{};o.ds=ds;o.dt=dt;o.law=law;return [p,t,w,d,o]}
var LIB={
 firm:[
  J(1,'Name the '+GO,GO,4,'Whole organisation',[],['d:§8(9)','d:§8(10)','s:R5(9)'],{fromArea:1}),
  J(1,'Name a DPDP coordinator','DPDP coordinator',4,'Whole organisation',[],['g:'],{fromArea:1}),
  J(1,'Publish the Grievance Officer’s name and contact — on your website or a free VERIDIAN page',GO,10,'Whole organisation',[],['d:§8(9)','d:R9','s:R5(9)']),
  J(2,'Write down where it is kept, why you need it, and who can open it','Customer data',10,'Customers',['Name','Phone','Email','Address','PAN','Bank details'],['d:§4','d:§8(4)']),
  J(2,'Write down where it is kept, why you need it, and who can open it','Staff records',10,'Employees',['Name','PAN','Aadhaar','Bank account','Salary','Photo','Medical'],['d:§7(i)','d:§8(4)']),
  J(2,'Write down where it is kept, why you need it, and who can open it','Staff records',12,'Job applicants',['Name','CV','Phone','Email'],['d:§4','d:§8(4)']),
  J(2,'Write down where it is kept, why you need it, and who can open it','Website firm',12,'Website visitors',['Name','Phone','Email','Cookies'],['d:§4','d:§8(4)']),
  J(2,'Write down where the recordings are kept and for how long','CCTV',12,'CCTV',['Video of staff and visitors'],['d:§4','d:§8(7)']),
  J(2,'Write down where fingerprints or face scans are stored and who can open them','Staff records',12,'Attendance machine',['Fingerprint','Face'],['d:§8(5)','s:R3']),
  J(2,'Write down how long each is kept — keep only what tax and labour law require, delete the rest','Accounts',14,'All data sets',['All'],['d:§8(7)','d:R8']),
  J(3,'Give a privacy notice when you collect their data — on the form, invoice or website','Customer data',14,'Customers',['All of the above'],['d:§5','d:R3','s:R5(3)']),
  J(3,'Take consent before sending marketing messages — and make stopping as easy as starting','Customer data',14,'Customers',['Phone','Email'],['d:§6(1)','d:§6(4)']),
  J(3,'Tell staff what you hold and why — no consent is needed for employment','Staff records',14,'Employees',['All of the above'],['d:§5','d:§7(i)']),
  J(3,'Take written consent for sensitive data','Staff records',10,'Employees',['Fingerprint','Medical','Bank account'],['s:R5(1)']),
  J(3,'Publish a privacy policy on the website','Website firm',10,'Website visitors',['Cookies','Form data'],['s:R4','d:§5','d:R3']),
  J(3,'Put up a notice wherever there is a camera','CCTV',10,'CCTV',['Video'],['d:§5']),
  J(4,'Mask Aadhaar copies — keep only the last 4 digits visible','Staff records',10,'Employees · Customers',['Aadhaar'],['a:§29','d:§8(5)','d:R6']),
  J(4,'Passwords on every computer, access only for those who need it, regular backups','IT & computers',14,'All data sets',['All'],['d:§8(5)','d:R6','s:R8']),
  J(4,'Keep a record of who opened personal data — for at least one year','IT & computers',21,'All data sets',['Access logs'],['d:R6(1)(c)','d:R8(3)']),
  J(4,'Write down what to do if data leaks — tell the Board and every person affected, full report within 72 hours',GO,21,'All data sets',['All'],['d:§8(6)','d:R7']),
  J(4,'Check your own laptop and phone for customer data — never forward it on personal WhatsApp','All staff',12,'Everyone',['Customer data on personal devices'],['d:§8(5)'],{grp:1}),
  J(5,'Website firm signs the data agreement','Website firm',12,'Website visitors',['Enquiries'],['d:§8(2)','d:R6(1)(f)','s:R7']),
  J(5,'Payroll firm signs the data agreement','Payroll firm',12,'Employees',['Bank account','PAN','Salary'],['d:§8(2)','d:R6(1)(f)','s:R7']),
  J(5,'Group company signs a data-sharing agreement','Group company',12,'Customers · Employees',['Shared records'],['d:§8(2)','s:R7']),
  J(5,'Check where your software keeps data — Tally, Zoho, Google — and whether it is outside India','IT & computers',21,'All data sets',['All'],['d:§8(2)','d:§16','d:R15']),
  J(6,'Publish how people can ask to see, correct or delete their data',GO,21,'All data sets',['All'],['d:§11','d:§12','d:R14(1)']),
  J(6,'Answer every complaint within 90 days — within one month under today’s law',GO,21,'All data sets',['All'],['d:§13','d:R14(3)','s:R5(9)']),
  J(6,'Delete a customer’s data when they ask or when it is no longer needed — and tell anyone you shared it with','Customer data',21,'Customers',['All'],['d:§8(7)','d:§12(3)']),
  J(7,'Owner confirms all the answers are true','OWNER',25,'Whole organisation',[],['d:§8(1)']),
  J(7,'CA manager checks the proof','CAMGR',27,'Whole organisation',[],['g:'],{dep:'Owner confirms all the answers are true'}),
  J(7,'CA partner signs the file','CAPARTNER',30,'Whole organisation',[],['g:'],{dep:'CA manager checks the proof'})],
 institution:[
  J(1,'Name the '+GO,GO,4,'Whole school',[],['d:§8(9)','d:§8(10)'],{fromArea:1}),
  J(1,'Name a DPDP coordinator','DPDP coordinator',4,'Whole school',[],['g:'],{fromArea:1}),
  J(1,'Publish the Grievance Officer’s name and contact — on the school website or a free VERIDIAN page',GO,10,'Whole school',[],['d:§8(9)','d:R9']),
  J(2,'Write down where it is kept — ERP, admission files, UDISE+ — and who can open it','Admission office',10,'Students',['Name','Date of birth','Photo','Address','Aadhaar','Marks','Attendance','Health','Category'],['d:§4','d:§8(4)','d:§9']),
  J(2,'Write down where it is kept and who can open it','Fees office',10,'Parents',['Name','Phone','Email','Occupation','Income'],['d:§4','d:§8(4)']),
  J(2,'Write down where it is kept and who can open it','Staff records',10,'Staff',['Name','PAN','Aadhaar','Bank account','Salary','Medical'],['d:§7(i)','d:§8(4)']),
  J(2,'Write down where they are — school phones, website, magazine, Instagram','DPDP coordinator',12,'Photos & videos',['Children’s photos','Videos'],['d:§8(4)','d:§9']),
  J(2,'Write down what the bus system records and who can see it','Transport in-charge',12,'School buses',['Live location','Pickup address','Parent phone'],['d:§8(4)','d:§9(3)','d:R12']),
  J(2,'Write down where recordings are kept and for how long','CCTV',12,'CCTV',['Video of children and staff'],['d:§4','d:§8(7)']),
  J(2,'Write down how long each is kept — admission and TC registers as your board requires; delete the rest','Admission office',14,'All data sets',['All'],['d:§8(7)','d:R8']),
  J(3,'Take verifiable consent from a parent at admission — the school exemption covers only tracking for learning and safety, not admission data','Admission office',14,'Students',['All of the above'],['d:§9(1)','d:R10','d:R12']),
  J(3,'Take a separate Yes or No from parents for photos on the website, magazine and social media','DPDP coordinator',14,'Photos & videos',['Children’s photos'],['d:§6','d:§9(1)']),
  J(3,'Give parents a notice — what you hold, why, and how to complain','DPDP coordinator',14,'Parents',['All'],['d:§5','d:R3']),
  J(3,'Tell staff what you hold and why — no consent is needed for employment','Staff records',14,'Staff',['All of the above'],['d:§5','d:§7(i)']),
  J(3,'Put up a notice wherever there is a camera','CCTV',10,'CCTV',['Video'],['d:§5']),
  J(4,'Mask Aadhaar copies — keep only the last 4 digits visible','Admission office',10,'Students · Staff',['Aadhaar'],['a:§29','d:§8(5)','d:R6']),
  J(4,'Passwords on the ERP and every office computer, access only for those who need it, backups','IT & computers',14,'All data sets',['All'],['d:§8(5)','d:R6']),
  J(4,'Keep a record of who opened student data — for at least one year','IT & computers',21,'All data sets',['Access logs'],['d:R6(1)(c)','d:R8(3)']),
  J(4,'Write down what to do if data leaks — tell the Board and every family affected, full report within 72 hours',GO,21,'All data sets',['All'],['d:§8(6)','d:R7']),
  J(4,'Check your own laptop and phone for student photos and marks — never share them on personal WhatsApp','Teachers',12,'Teachers',['Children’s photos','Marks'],['d:§8(5)','d:§9'],{grp:1}),
  J(4,'No ads, profiling or tracking of children beyond learning and safety','DPDP coordinator',21,'Students',['Behaviour','Online activity'],['d:§9(3)','d:R12']),
  J(5,'Bus firm signs the data agreement — location only during the journey, only for safety','Bus firm',12,'School buses',['Live location'],['d:§8(2)','d:R12']),
  J(5,'School software firm signs the data agreement','School software firm',12,'Students · Parents',['Marks','Attendance','Fees'],['d:§8(2)','d:R6(1)(f)']),
  J(5,'Check where your apps keep data — ERP, fee app, WhatsApp groups — and whether it is outside India','IT & computers',21,'All data sets',['All'],['d:§8(2)','d:§16','d:R15']),
  J(6,'Publish how parents can ask to see, correct or delete their child’s data',GO,21,'All data sets',['All'],['d:§11','d:§12','d:R14(1)']),
  J(6,'Answer every complaint within 90 days',GO,21,'All data sets',['All'],['d:§13','d:R14(3)']),
  J(6,'Delete a student’s data when it is no longer needed — keep the registers your board requires','Admission office',21,'Students',['All'],['d:§8(7)','d:§12(3)']),
  J(7,'Sign off all the answers','OWNER',25,'Whole school',[],['d:§8(1)'])]};

// ---- transform to SQL (this part is new code, not spec content) ----
const EXTERNAL_AREAS = new Set(['Website firm','Payroll firm','Group company','Bus firm','School software firm']);
const LIBRARY_VERSION_ID = 'dpdp_lib_0_2_wo010';

function esc(s) { return s == null ? 'NULL' : `'` + String(s).replace(/'/g, "''") + `'`; }
function arr(a) { return (!a || !a.length) ? 'NULL' : `ARRAY[${a.map(esc).join(',')}]::text[]`; }

let rows = [];
for (const product of ['firm', 'institution']) {
  const jobs = LIB[product];
  const keyed = jobs.map((x, i) => ({ x, key: `${product}-${String(i + 1).padStart(2, '0')}` }));
  for (const { x, key } of keyed) {
    const [part, what, who, days, extra] = x;
    let dependsOnKey = null;
    if (extra.dep) {
      const dep = keyed.find(k => k.x[1] === extra.dep);
      if (!dep) throw new Error(`dep not found: ${extra.dep} in ${product}`);
      dependsOnKey = dep.key;
    }
    const answerableBy = EXTERNAL_AREAS.has(who) ? 'processor' : 'internal';
    const proofKind = /publish a privacy policy/i.test(what) ? 'doc' : 'declaration';
    const appliesWhen = extra.fromArea ? { fromArea: true } : extra.grp ? { grp: true } : null;
    rows.push({
      id: `tmpl_${key.replace(/-/g, '_')}`,
      key,
      name: what,
      plainText: what,
      proofKind,
      defaultDays: days,
      answerableBy,
      roleTag: who,
      appliesWhen,
      product,
      part,
      dataSet: extra.ds,
      dataTypes: extra.dt,
      lawCodes: extra.law,
      dependsOnKey,
    });
  }
}

if (rows.length !== 59) throw new Error(`expected 59 rows, got ${rows.length}`);
const firmCount = rows.filter(r => r.product === 'firm').length;
const instCount = rows.filter(r => r.product === 'institution').length;
if (firmCount !== 31) throw new Error(`expected 31 firm rows, got ${firmCount}`);
if (instCount !== 28) throw new Error(`expected 28 institution rows, got ${instCount}`);

const header = `-- WO-DPDP-010: seed the 59-job library (31 firm + 28 institution) as DATA,
-- generated verbatim from veridian-dpdp.html's LIB object by
-- scripts/dpdp/gen-library-seed.mjs -- do not hand-edit this file; re-run the
-- generator if the spec's LIB changes. This is the "0.2-wo010" library
-- version; the WO's own §2 note applies: "the library will be replaced by a
-- lawyer-reviewed version, so make that a data change, not a code change" --
-- a future lawyer-reviewed revision is a NEW library_version row + NEW
-- obligation_template rows (is_current flipped), never an edit to these.
--
-- Judgment calls made here, none of which are in the spec itself (flagged
-- per WO-DPDP-010 §0's invitation to flag anything not directly specified):
--  * plain_text = name (the spec has no separate long-form legal text distinct
--    from the short "what has to be done" line -- the short line IS the
--    verbatim copy).
--  * proof_kind: 'doc' only for the "Publish a privacy policy" job (it
--    produces the policy-version artefact); 'declaration' for everything
--    else. The spec doesn't model photo evidence at all today.
--  * answerable_by: 'processor' for the 5 outside-firm role tags (Website
--    firm/Payroll firm/Group company/Bus firm/School software firm),
--    'internal' otherwise.
--  * recurrence stays the column default ('none') -- the spec's "your list
--    refreshes every quarter" is a whole-library-cycle behaviour, not a
--    per-job cadence, and is out of this migration's scope.
INSERT INTO dpdp.library_version (id, version, released_on, changelog, is_current)
VALUES ('${LIBRARY_VERSION_ID}', '0.2-wo010', CURRENT_DATE, 'WO-DPDP-010: 59-job library (31 firm + 28 institution) ported verbatim from veridian-dpdp.html LIB. Supersedes 0.1-draft (schema-only, zero templates).', true)
ON CONFLICT (version) DO NOTHING;

UPDATE dpdp.library_version SET is_current = false WHERE id <> '${LIBRARY_VERSION_ID}' AND is_current = true;

INSERT INTO dpdp.obligation_template
  (id, library_version_id, key, name, plain_text, proof_kind, default_days, answerable_by, role_tag, applies_when, product, part, data_set, data_types, law_codes, depends_on_key)
VALUES
`;

const values = rows.map(r => {
  const appliesWhen = r.appliesWhen ? esc(JSON.stringify(r.appliesWhen)) + '::jsonb' : 'NULL';
  return `  (${esc(r.id)}, '${LIBRARY_VERSION_ID}', ${esc(r.key)}, ${esc(r.name)}, ${esc(r.plainText)}, ${esc(r.proofKind)}, ${r.defaultDays}, ${esc(r.answerableBy)}, ${esc(r.roleTag)}, ${appliesWhen}, ${esc(r.product)}, ${r.part}, ${esc(r.dataSet)}, ${arr(r.dataTypes)}, ${arr(r.lawCodes)}, ${esc(r.dependsOnKey)})`;
}).join(',\n');

const footer = `\nON CONFLICT (library_version_id, key) DO NOTHING;

-- Resolve depends_on_key -> a real dependent obligation_template.id, kept as
-- a convenience view-free lookup: dpdp-obligation-library.ts resolves this
-- at instantiation time (per-org obligation rows), not here -- this table is
-- shared/global, so there is nothing org-specific to wire up yet.
`;

const fs = require('fs');
const out = header + values + footer;
fs.writeFileSync(process.argv[2] || 'out.sql', out);
console.log(`Generated ${rows.length} rows (${firmCount} firm + ${instCount} institution) -> ${process.argv[2]}`);
