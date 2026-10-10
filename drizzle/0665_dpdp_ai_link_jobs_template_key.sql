-- DPDP: the AI work link's job list carries each job's library key (`templateKey`, for example `firm-07`).
--
-- WHY: the page an AI work link opens now carries a playbook for every job -- why it matters, who does it, the steps, the questions to ask
-- the person, what done looks like, the note to record, and an email where an outside firm has to act (owner, 2026-09-30: "THE EXTERNAL AI
-- SHOULD BE ABLE TO UNDERSTAND THE WHOLE THING ... WHY TO DO, HOW TO DO, WHERE TO DO, FOR WHOM TO DO, HOW TO UPDATE, WHAT QUESTIONS THE
-- EXTERNAL AI TO ASK THE USER ..."). The playbooks are keyed by the library's own key. GET /jobs/{id} already returned `templateKey`; the LIST
-- (GET /jobs) did not, so the "Start here" page could not pick the playbook for the five most urgent jobs without one more call per job.
--
-- WHAT: dpdp__ai_job_json (the shape GET /jobs returns per job) gains one field, `templateKey`. Nothing else in it changes, its signature and
-- its privileges are unchanged (CREATE OR REPLACE keeps them: service_role only, see 0610), and dpdp_ai_link_job, which merges this object
-- with its own, already set the same key to the same value.

CREATE OR REPLACE FUNCTION public.dpdp__ai_job_json(r dpdp.ai_job_row)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', r.id, 'part', r.part, 'what', r.what, 'dataSet', r."dataSet",
    'dataTypes', to_jsonb(r."dataTypes"), 'lawCodes', to_jsonb(r."lawCodes"),
    'by', r.by, 'byIsYou', r."byIsYou", 'isGroup', r."isGroup", 'groupDone', r."groupDone", 'groupTotal', r."groupTotal",
    'due', to_char(r.due, 'YYYY-MM-DD'), 'yes', r.yes, 'na', r.na, 'dependsOnObligationId', r."dependsOnObligationId",
    'status', r.status, 'daysLate', r."daysLate", 'late', r.late, 'requiredToday', r."requiredToday",
    'templateKey', r.template_key
  )
$function$;
