# Persona run (zoomies), dry mode, 2026-09-27

Run by the Claude Code session acting as the EXTERNAL AI, over plain HTTP against the local execution host in dry mode.
The AI uses only the link address; the person's steps use a local session; the assertions re-read persisted rows. Tokens and confirm codes are cut to six characters.


## Monday. Sumeet makes a link for his AI, and the AI reads before it touches anything

**1. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"Monday, Sumeet's chat AI"}`
- answer: **201** `{"link_id":"39c2926816ae493dab096bb649c76a37","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2782 chars)`

- PASS: Monday, Sumeet's chat AI: the mint route answers 201 for a project the person can read
**2. AI: `GET /context?format=json`**
- answer: **200** `{"rate":{"limit_per_minute":120,"calls_last_minute":1},"level":1,"product":"projexa","project":{"id":"projects_1","name":"12039 ZOOMIES, DIP, DUBAI, UAE."},"counters":{"intents":0,"submissions":0},"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines …(33978 chars)`

- PASS: context: level 1, effective level 1, writes on
- PASS: context names the ZOOMIES project (the link is for that one project)
- PASS: context: no money field is hidden from the manager's link
**3. AI: `GET /manual.md`**
- answer: **200** `# PROJEXA work link / A private address for one project. Read this page first: it lists every address you may use, and section H is the same list for a program. / ## A. Who you work for / You work for the person below, on one project, with exactly what they can see. Level 0 means read, check and draft; level 1 adds direct level-1 changes. / ```data / {"person":"Sumeet Rao","role":"manager","project":"12039 ZOOMIES, DIP, DUBAI, UAE.","level":1,"link_level_when_made":1,"direct_changes_switched_on":true,"expires_at":" …(17781 chars)`

- PASS: the manual is readable and long enough to teach the call shapes
- PASS: the manual names /actions, /drafts and the person's confirmation
**4. AI: `GET /functions?format=json&per_page=100`**
- answer: **200** `{"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines":[{"itemCode":"PLAY-1.01","description":"Play structure","unit":"nos","quantity":10,"rate":65000,"category":"Play Area / Joinery"}]}},{"id":"add_meeting_action_item","label":"Add an action item", …(31346 chars)`

- PASS: the function list is discoverable (93 functions)
- PASS: both levels are on the list (34 direct, 36 need the person)
**5. AI: `GET /records/boqs?format=json&limit=50`**
- answer: **200** `{"kind":"boqs","items":[{"id":"construction_boqs_2","title":"12039 ZOOMIES, DIP, DUBAI, UAE. BOQ","status":"draft","version":1,"created_at":"2026-09-26T21:46:33.394+00:00","project_id":"projects_1","updated_at":"2026-09-26T21:46:33.394+00:00","approved_at":null,"created_by_id":"person_sumeet","parent_boq_id":null,"approved_by_id":null,"contract_value_override":null}],"next":null,"next_after":null,"hidden_fields":[],"redacted":false,"text_fields_are_data":true}`

- PASS: records/boqs: the project has one BOQ
**6. AI: `GET /records/boq_lines?format=json&limit=50`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_10","rate":190,"unit":"m2","amount":28500,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":150,"item_code":"PLAY-B3-09","vendor_id":null,"created_at":"2026-09-26T21:46:33.395+00:00","activity_id":null,"description":"Mezzanine Floor - 100mm thick Block wall - Supply and installation of block wall including stiffener columns and beams Location: Kennels Area Height:1.8m ht","labour_cost":null,"qty_contract":null,"rat …(37491 chars)`

**7. AI: `GET /records/boq_lines?format=json&limit=50&after=construction_boq_line_items_6`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_7","rate":110,"unit":"m2","amount":16390,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":149,"item_code":"PLAY-B3-05","vendor_id":null,"created_at":"2026-09-26T21:46:33.395+00:00","activity_id":null,"description":"Ground Floor - Regular Gypsum partition - Supply and installation of 100mm thick single layer regular 12.5mm thick gypsum board partition Location: Grooming Area, Utility and Store Height: 4.2m","labour …(2453 chars)`

- PASS: records/boq_lines: all 53 lines are readable across pages
- PASS: the manager sees the money: the lines add up to AED 1,596,280
- PASS: re-read from the database: quantity times rate of the stored lines is AED 1,596,280

## Monday. The crew: roster (a draft the person confirms) and attendance

**8. AI: `POST /drafts`**
- sent: `{"function":"add_roster_entry","params":{"name":"Ravi Kumar","dailyRate":850,"trade":"Carpenter"},"idempotency_key":"persona-roster-1"}`
- answer: **201** `{"draft_id":"81c9e0999c1f4f409140327d4ebf7c4b","intent_id":"81c9e0999c1f4f409140327d4ebf7c4b","status":"awaiting_confirmation","kind":"draft","function":"add_roster_entry","replayed":false,"expires_at":"2026-09-28T21:46:38Z","confirm_url":"https://localhost/ai-confirm.html#d=81c9e0999c1f4f409140327d4ebf7c4b.5ae7fa…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_3f…/drafts/81c9e09 …(725 chars)`

- PASS: add_roster_entry (a money field) is a draft at level 2
- PASS: re-read: the draft wrote no roster row
**9. Sumeet (signed in): `POST /drafts/81c9e0999c1f4f409140327d4ebf7c4b/preview`**
- sent: `{"confirmToken":"5ae7fa…"}`
- answer: **200** `{"draft_id":"81c9e0999c1f4f409140327d4ebf7c4b","function_id":"add_roster_entry","label":"Add a worker","params":{"name":"Ravi Kumar","trade":"Carpenter","dailyRate":850},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:38Z","expires_at":"2026-09-28T21:46:38Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**10. Sumeet (signed in): `POST /drafts/81c9e0999c1f4f409140327d4ebf7c4b/confirm`**
- sent: `{"confirmToken":"5ae7fa…"}`
- answer: **200** `{"draft_id":"81c9e0999c1f4f409140327d4ebf7c4b","status":"done","function_id":"add_roster_entry","record":{"id":"construction_labour_roster_58","route":"/labour/construction_labour_roster_58"},"submission_id":"submissions_56","message":"The change is applied to the project."}`

- PASS: the signed-in person confirms and the change is applied
**11. AI: `POST /drafts`**
- sent: `{"function":"add_roster_entry","params":{"name":"Ravi Kumar","dailyRate":850,"trade":"Carpenter"},"idempotency_key":"persona-roster-1"}`
- answer: **200** `{"draft_id":"81c9e0999c1f4f409140327d4ebf7c4b","intent_id":"81c9e0999c1f4f409140327d4ebf7c4b","status":"done","kind":"draft","function":"add_roster_entry","replayed":true,"expires_at":"2026-09-28T21:46:38Z","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_3f…/drafts/81c9e0999c1f4f409140327d4ebf7c4b","submission_id":"submissions_56","result":{"id":"construction_labour_roster_58","route":"/labour/construction_labour_roster_58"},"failure":nu …(703 chars)`

- PASS: the same draft again is a replay and does not hand out a second confirm address
**12. Sumeet (signed in): `POST /drafts/81c9e0999c1f4f409140327d4ebf7c4b/confirm`**
- sent: `{"confirmToken":"5ae7fa…"}`
- answer: **409** `{"code":"CONFIRM_ALREADY_USED","error":"This confirm code was already used, or the draft is no longer waiting."}`

- PASS: the same confirm address a second time does not apply it again (409)
- PASS: re-read: still one roster row after the second confirm
- PASS: add_roster_entry is listed by the link as a level-2 (the person confirms) function
**13. AI: `POST /drafts`**
- sent: `{"function":"add_roster_entry","params":{"name":"Anita Shah","dailyRate":900,"trade":"Painter"},"idempotency_key":"persona-roster-2"}`
- answer: **201** `{"draft_id":"e9c2490016034178b639d4035030fc97","intent_id":"e9c2490016034178b639d4035030fc97","status":"awaiting_confirmation","kind":"draft","function":"add_roster_entry","replayed":false,"expires_at":"2026-09-28T21:46:38Z","confirm_url":"https://localhost/ai-confirm.html#d=e9c2490016034178b639d4035030fc97.ecebae…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_3f…/drafts/e9c2490 …(725 chars)`

- PASS: add_roster_entry: the draft is recorded (201) and nothing has changed yet
**14. Sumeet (signed in): `POST /drafts/e9c2490016034178b639d4035030fc97/preview`**
- sent: `{"confirmToken":"ecebae…"}`
- answer: **200** `{"draft_id":"e9c2490016034178b639d4035030fc97","function_id":"add_roster_entry","label":"Add a worker","params":{"name":"Anita Shah","trade":"Painter","dailyRate":900},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:38Z","expires_at":"2026-09-28T21:46:38Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**15. Sumeet (signed in): `POST /drafts/e9c2490016034178b639d4035030fc97/confirm`**
- sent: `{"confirmToken":"ecebae…"}`
- answer: **200** `{"draft_id":"e9c2490016034178b639d4035030fc97","status":"done","function_id":"add_roster_entry","record":{"id":"construction_labour_roster_63","route":"/labour/construction_labour_roster_63"},"submission_id":"submissions_61","message":"The change is applied to the project."}`

- PASS: add_roster_entry: the person confirms and it is applied
**16. AI: `GET /records/roster?format=json&limit=50`**
- answer: **200** `{"kind":"roster","items":[{"id":"construction_labour_roster_58","name":"Ravi Kumar","trade":"Carpenter","is_active":true,"created_at":"2026-09-26T21:46:38.144+00:00","daily_rate":850,"skill_level":null,"employee_code":"W-0001"},{"id":"construction_labour_roster_63","name":"Anita Shah","trade":"Painter","is_active":true,"created_at":"2026-09-26T21:46:38.28+00:00","daily_rate":900,"skill_level":null,"employee_code":"W-0002"}],"next":null,"next_after":null,"hidden_fields":[],"redacted":false,"text_fields_are_data":tru …(522 chars)`

- PASS: records/roster: the AI reads back the two people the person confirmed
- PASS: re-read: two roster rows exist for this project
- PASS: record_attendance_batch is listed by the link as a level-1 (direct) function
**17. AI: `POST /actions`**
- sent: `{"function":"record_attendance_batch","params":{"date":"2026-09-23","entries":[{"rosterId":"construction_labour_roster_58","status":"present"},{"rosterId":"construction_labour_roster_63","status":"present"}]},"idempotency_key":"persona-attendance-1"}`
- answer: **201** `{"intent_id":"ceab9a5fc64b4fc3bbbd97d06a63155b","status":"done","record":{"id":"construction_attendance_68","route":"/labour?tab=attendance"},"submission_id":"submissions_66","replayed":false}`

- PASS: record_attendance_batch is applied directly (level 1)
- PASS: re-read: two attendance rows exist, one per person
**18. AI: `POST /actions`**
- sent: `{"function":"record_attendance_batch","params":{"date":"2026-09-23","entries":[{"rosterId":"construction_labour_roster_58","status":"present"},{"rosterId":"construction_labour_roster_63","status":"present"}]},"idempotency_key":"persona-attendance-1"}`
- answer: **200** `{"intent_id":"ceab9a5fc64b4fc3bbbd97d06a63155b","status":"done","replayed":true,"record":{"id":"construction_attendance_68","route":"/labour?tab=attendance"},"submission_id":"submissions_66"}`

- PASS: the same request again is a replay (200, replayed)
- PASS: re-read: the replay added no attendance row
- PASS: record_attendance is listed by the link as a level-1 (direct) function
**19. AI: `POST /actions`**
- sent: `{"function":"record_attendance","params":{"rosterId":"construction_labour_roster_58","date":"2026-09-24","status":"present"},"idempotency_key":"persona-attendance-2"}`
- answer: **201** `{"intent_id":"58dad203e6b44385869f775f5f25dbc9","status":"done","record":{"id":"construction_attendance_74","route":"/labour?tab=attendance"},"submission_id":"submissions_72","replayed":false}`


## Monday. Site progress against the BOQ

- PASS: create_progress_category is listed by the link as a level-1 (direct) function
**20. AI: `POST /actions`**
- sent: `{"function":"create_progress_category","params":{"name":"Play Area finishes"},"idempotency_key":"persona-category"}`
- answer: **201** `{"intent_id":"1b3a3372d0054442b4ccbf7ebe7283fb","status":"done","record":{"id":"construction_categories_79","route":"/work-progress"},"submission_id":"submissions_77","replayed":false}`

- PASS: create_progress_category
- PASS: create_activity is listed by the link as a level-1 (direct) function
**21. AI: `POST /actions`**
- sent: `{"function":"create_activity","params":{"name":"Rubber flooring","unit":"sqm"},"idempotency_key":"persona-activity"}`
- answer: **201** `{"intent_id":"198dcbbba21c4f79bac8e74d899e7420","status":"done","record":{"id":"construction_activities_85","route":"/work-progress"},"submission_id":"submissions_82","replayed":false}`

- PASS: create_activity
- PASS: record_work_progress is listed by the link as a level-1 (direct) function
**22. AI: `POST /actions`**
- sent: `{"function":"record_work_progress","params":{"itemCode":"PLAY-B3-09","percent":25,"entryDate":"2026-09-23","remarks":"Base coat done, level 1"},"idempotency_key":"persona-progress-1"}`
- answer: **201** `{"intent_id":"bfafa4a7b261467185272a552260bbea","status":"done","record":{"id":"construction_work_progress_entries_90","route":null},"submission_id":"submissions_88","replayed":false}`

- PASS: record_work_progress on BOQ line PLAY-B3-09
- PASS: re-read: the entry holds 25 percent, the date and the remarks the AI sent
- PASS: re-read: the progress entry is attributed to Sumeet, not to the AI
- PASS: record_work_progress is listed by the link as a level-1 (direct) function
**23. AI: `POST /actions`**
- sent: `{"function":"record_work_progress","params":{"itemCode":"PLAY-B3-09","percent":60,"entryDate":"2026-09-25","remarks":"Second coat and edge trim"},"idempotency_key":"persona-progress-2"}`
- answer: **201** `{"intent_id":"00ebd91c809744fea3d2a025bab994e4","status":"done","record":{"id":"construction_work_progress_entries_95","route":null},"submission_id":"submissions_93","replayed":false}`

- PASS: a second entry for the same line, later in the week
**24. AI: `GET /records/progress?format=json&limit=50`**
- answer: **200** `{"kind":"progress","items":[{"id":"construction_work_progress_entries_90","remarks":"Base coat done, level 1","created_at":"2026-09-26T21:46:38.82+00:00","entry_date":"2026-09-23","activity_id":"construction_activities_85","entry_basis":"DELTA","quantity_done":0,"recorded_by_id":"person_sumeet","boq_line_item_id":"construction_boq_line_items_10","percent_complete":25},{"id":"construction_work_progress_entries_95","remarks":"Second coat and edge trim","created_at":"2026-09-26T21:46:38.914+00:00","entry_date":"2026-0 …(812 chars)`

- PASS: records/progress: the AI reads its two entries back
**25. Sumeet (signed in): `POST /links/39c2926816ae493dab096bb649c76a37/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"39c2926816ae493dab096bb649c76a37","revoked":true,"already":false}`

- PASS: link 39c292… is revoked through the app route (200)
**26. AI (yesterday's link): `GET /context?format=json`**
- answer: **410** `{"error":"This link has expired or was revoked","hint":"Ask the person for a new link."}`

- PASS: the evening's link is gone: the same address answers 410

## Tuesday. RFIs, submittals and the punch list

**27. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"Tuesday, Sumeet's chat AI"}`
- answer: **201** `{"link_id":"54f64f1191d74f57b5625cf32e8a836c","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2783 chars)`

- PASS: Tuesday, Sumeet's chat AI: the mint route answers 201 for a project the person can read
- PASS: create_rfi is listed by the link as a level-1 (direct) function
**28. AI: `POST /actions`**
- sent: `{"function":"create_rfi","params":{"subject":"Rubber tile thickness, play area","question":"Confirm 20 mm or 25 mm tiles at the climbing zone.","dueDate":"2026-09-26"},"idempotency_key":"persona-rfi-1"}`
- answer: **201** `{"intent_id":"a1dacc4d840a43e6b1748c3acab66ce1","status":"done","record":{"id":"construction_rfis_100","route":"/rfis/construction_rfis_100"},"submission_id":"submissions_98","replayed":false}`

- PASS: create_rfi
- PASS: re-read: the RFI is open, on this project, raised by Sumeet
- PASS: answer_rfi is listed by the link as a level-2 (the person confirms) function
**29. AI: `POST /drafts`**
- sent: `{"function":"answer_rfi","params":{"rfiId":"construction_rfis_100","answer":"Use 25 mm as drawing A-14 rev C."},"idempotency_key":"persona-rfi-answer"}`
- answer: **201** `{"draft_id":"cd7b4167f3024addbfbdbb69887a9751","intent_id":"cd7b4167f3024addbfbdbb69887a9751","status":"awaiting_confirmation","kind":"draft","function":"answer_rfi","replayed":false,"expires_at":"2026-09-28T21:46:39Z","confirm_url":"https://localhost/ai-confirm.html#d=cd7b4167f3024addbfbdbb69887a9751.e2098e…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_bc…/drafts/cd7b4167f3024 …(719 chars)`

- PASS: answer_rfi: the draft is recorded (201) and nothing has changed yet
**30. Sumeet (signed in): `POST /drafts/cd7b4167f3024addbfbdbb69887a9751/preview`**
- sent: `{"confirmToken":"e2098e…"}`
- answer: **200** `{"draft_id":"cd7b4167f3024addbfbdbb69887a9751","function_id":"answer_rfi","label":"Answer an RFI","params":{"rfiId":"construction_rfis_100","answer":"Use 25 mm as drawing A-14 rev C."},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:39Z","expires_at":"2026-09-28T21:46:39Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**31. Sumeet (signed in): `POST /drafts/cd7b4167f3024addbfbdbb69887a9751/confirm`**
- sent: `{"confirmToken":"e2098e…"}`
- answer: **200** `{"draft_id":"cd7b4167f3024addbfbdbb69887a9751","status":"done","function_id":"answer_rfi","record":{"id":"construction_rfis_100","route":"/rfis/construction_rfis_100"},"submission_id":"submissions_103","message":"The change is applied to the project."}`

- PASS: answer_rfi: the person confirms and it is applied
- PASS: answer_rfi is a draft: the person confirms and it is applied
- PASS: close_rfi is listed by the link as a level-1 (direct) function
**32. AI: `POST /actions`**
- sent: `{"function":"close_rfi","params":{"rfiId":"construction_rfis_100"},"idempotency_key":"persona-rfi-close"}`
- answer: **201** `{"intent_id":"dec89428a88043b1a7bd3b8c78d8a184","status":"done","record":{"id":"construction_rfis_100","route":"/rfis/construction_rfis_100"},"submission_id":"submissions_107","replayed":false}`

- PASS: close_rfi (level 1) after the answer
- PASS: re-read: the RFI is closed
- PASS: create_submittal is listed by the link as a level-1 (direct) function
**33. AI: `POST /actions`**
- sent: `{"function":"create_submittal","params":{"title":"Rubber tile sample, play zone","specSection":"09 65 00","dueDate":"2026-09-27"},"idempotency_key":"persona-submittal-1"}`
- answer: **201** `{"intent_id":"febee30ff1284636a0f098a8304ef7cd","status":"done","record":{"id":"construction_submittals_113","route":"/submittals/construction_submittals_113"},"submission_id":"submissions_111","replayed":false}`

- PASS: create_submittal
**34. AI: `GET /records/submittals?format=json&limit=50`**
- answer: **200** `{"kind":"submittals","items":[{"id":"submittal_maya","type":"sample","title":"Partition board sample, vet area","number":1,"status":"pending","due_date":null,"created_at":"2026-09-26T21:46:33.397+00:00","reviewed_at":null,"spec_section":null,"reviewed_by_id":null,"review_comments":null,"submitted_by_id":"person_maya"},{"id":"construction_submittals_113","type":"shop_drawing","title":"Rubber tile sample, play zone","number":2,"status":"pending","due_date":"2026-09-27","created_at":"2026-09-26T21:46:39.371+00:00","re …(737 chars)`

- PASS: records/submittals: the AI finds the sample Maya raised earlier
- PASS: review_submittal is listed by the link as a level-2 (the person confirms) function
**35. AI: `POST /drafts`**
- sent: `{"function":"review_submittal","params":{"submittalId":"submittal_maya","status":"approved","comments":"Approved for the vet area only."},"idempotency_key":"persona-submittal-review"}`
- answer: **201** `{"draft_id":"fd98eff9cc2745119f2810bb5df7d9b0","intent_id":"fd98eff9cc2745119f2810bb5df7d9b0","status":"awaiting_confirmation","kind":"draft","function":"review_submittal","replayed":false,"expires_at":"2026-09-28T21:46:39Z","confirm_url":"https://localhost/ai-confirm.html#d=fd98eff9cc2745119f2810bb5df7d9b0.7a5a08…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_bc…/drafts/fd98eff …(725 chars)`

- PASS: review_submittal: the draft is recorded (201) and nothing has changed yet
**36. Sumeet (signed in): `POST /drafts/fd98eff9cc2745119f2810bb5df7d9b0/preview`**
- sent: `{"confirmToken":"7a5a08…"}`
- answer: **200** `{"draft_id":"fd98eff9cc2745119f2810bb5df7d9b0","function_id":"review_submittal","label":"Review a submittal","params":{"status":"approved","comments":"Approved for the vet area only.","submittalId":"submittal_maya"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:39Z","expires_at":"2026-09-28T21:46:39Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

(Sumeet pauses a minute before the next confirm: 10 confirm calls a minute is the limit)

**37. Sumeet (signed in): `POST /drafts/fd98eff9cc2745119f2810bb5df7d9b0/confirm`**
- sent: `{"confirmToken":"7a5a08…"}`
- answer: **200** `{"draft_id":"fd98eff9cc2745119f2810bb5df7d9b0","status":"done","function_id":"review_submittal","record":{"id":"submittal_maya","route":"/submittals/submittal_maya"},"submission_id":"submissions_116","message":"The change is applied to the project."}`

- PASS: review_submittal: the person confirms and it is applied
- PASS: re-read: Maya's submittal is approved and the reviewer is Sumeet
**38. AI: `POST /drafts`**
- sent: `{"function":"review_submittal","params":{"submittalId":"construction_submittals_113","status":"approved"},"idempotency_key":"persona-submittal-self"}`
- answer: **201** `{"draft_id":"dc7379ea2dfa4b87b377a99b03e94e79","intent_id":"dc7379ea2dfa4b87b377a99b03e94e79","status":"awaiting_confirmation","kind":"draft","function":"review_submittal","replayed":false,"expires_at":"2026-09-28T21:46:39Z","confirm_url":"https://localhost/ai-confirm.html#d=dc7379ea2dfa4b87b377a99b03e94e79.8fc04b…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_bc…/drafts/dc7379e …(725 chars)`

**39. Sumeet (signed in): `POST /drafts/dc7379ea2dfa4b87b377a99b03e94e79/preview`**
- sent: `{"confirmToken":"8fc04b…"}`
- answer: **200** `{"draft_id":"dc7379ea2dfa4b87b377a99b03e94e79","function_id":"review_submittal","label":"Review a submittal","params":{"status":"approved","submittalId":"construction_submittals_113"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:39Z","expires_at":"2026-09-28T21:46:39Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**40. Sumeet (signed in): `POST /drafts/dc7379ea2dfa4b87b377a99b03e94e79/confirm`**
- sent: `{"confirmToken":"8fc04b…"}`
- answer: **200** `{"draft_id":"dc7379ea2dfa4b87b377a99b03e94e79","status":"failed","function_id":"review_submittal","code":"NOT_PERMITTED","missing":[],"message":"Confirmed, but the change could not be applied. Ask the AI to draft it again with the missing details."}`

- PASS: a submittal cannot be reviewed by the person who raised it: it is not applied (failed NOT_PERMITTED)
- PASS: re-read: the submittal Sumeet's AI raised is still pending
- PASS: create_punch_list_item is listed by the link as a level-1 (direct) function
**41. AI: `POST /actions`**
- sent: `{"function":"create_punch_list_item","params":{"description":"Chipped skirting, vet reception","location":"Vet Area","trade":"Joinery"},"idempotency_key":"persona-punch-1"}`
- answer: **201** `{"intent_id":"34a009f050324bb28b1f1bcd06934e41","status":"done","record":{"id":"construction_punch_list_items_126","route":"/punch-list/construction_punch_list_items_126"},"submission_id":"submissions_124","replayed":false}`

- PASS: create_punch_list_item
- PASS: mark_punch_item_ready is listed by the link as a level-1 (direct) function
**42. AI: `POST /actions`**
- sent: `{"function":"mark_punch_item_ready","params":{"itemId":"construction_punch_list_items_126"},"idempotency_key":"persona-punch-ready"}`
- answer: **201** `{"intent_id":"419f65b6e7104efdae1a82fb1d3e62bd","status":"done","record":{"id":"construction_punch_list_items_126","route":"/punch-list/construction_punch_list_items_126"},"submission_id":"submissions_129","replayed":false}`

- PASS: mark_punch_item_ready
- PASS: re-read: the punch item is ready for review
- PASS: verify_punch_item_closed is listed by the link as a level-2 (the person confirms) function
**43. AI: `POST /drafts`**
- sent: `{"function":"verify_punch_item_closed","params":{"itemId":"construction_punch_list_items_126"},"idempotency_key":"persona-punch-verify"}`
- answer: **201** `{"draft_id":"83296b1845f440fa918d4964a0912286","intent_id":"83296b1845f440fa918d4964a0912286","status":"awaiting_confirmation","kind":"draft","function":"verify_punch_item_closed","replayed":false,"expires_at":"2026-09-28T21:46:39Z","confirm_url":"https://localhost/ai-confirm.html#d=83296b1845f440fa918d4964a0912286.8579ec…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_bc…/drafts …(733 chars)`

- PASS: verify_punch_item_closed: the draft is recorded (201) and nothing has changed yet
**44. Sumeet (signed in): `POST /drafts/83296b1845f440fa918d4964a0912286/preview`**
- sent: `{"confirmToken":"8579ec…"}`
- answer: **200** `{"draft_id":"83296b1845f440fa918d4964a0912286","function_id":"verify_punch_item_closed","label":"Verify a punch list item closed","params":{"itemId":"construction_punch_list_items_126"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:39Z","expires_at":"2026-09-28T21:46:39Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**45. Sumeet (signed in): `POST /drafts/83296b1845f440fa918d4964a0912286/confirm`**
- sent: `{"confirmToken":"8579ec…"}`
- answer: **200** `{"draft_id":"83296b1845f440fa918d4964a0912286","status":"done","function_id":"verify_punch_item_closed","record":{"id":"construction_punch_list_items_126","route":"/punch-list/construction_punch_list_items_126"},"submission_id":"submissions_133","message":"The change is applied to the project."}`

- PASS: verify_punch_item_closed: the person confirms and it is applied
- PASS: re-read: the punch item is verified closed
**46. Sumeet (signed in): `POST /links/54f64f1191d74f57b5625cf32e8a836c/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"54f64f1191d74f57b5625cf32e8a836c","revoked":true,"already":false}`

- PASS: link 54f64f… is revoked through the app route (200)
**47. AI (yesterday's link): `GET /context?format=json`**
- answer: **410** `{"error":"This link has expired or was revoked","hint":"Ask the person for a new link."}`

- PASS: the evening's link is gone: the same address answers 410

## Wednesday. Site diary, schedule, milestones, meetings and minutes

**48. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"Wednesday, Sumeet's chat AI"}`
- answer: **201** `{"link_id":"1ff0a9c03fef4f41bb8d7338288a8008","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2785 chars)`

- PASS: Wednesday, Sumeet's chat AI: the mint route answers 201 for a project the person can read
- PASS: create_site_diary is listed by the link as a level-1 (direct) function
**49. AI: `POST /actions`**
- sent: `{"function":"create_site_diary","params":{"diaryDate":"2026-09-25","weather":"Hot, 39 C","workDone":"Flooring base coat, partition boards","labourCount":14},"idempotency_key":"persona-diary-1"}`
- answer: **201** `{"intent_id":"887f8bcce60b421783be2951985d9773","status":"done","record":{"id":"construction_site_diaries_139","route":"/site-diary/construction_site_diaries_139"},"submission_id":"submissions_137","replayed":false}`

- PASS: create_site_diary
- PASS: re-read: the diary is recorded by Sumeet
- PASS: create_schedule_task is listed by the link as a level-1 (direct) function
**50. AI: `POST /actions`**
- sent: `{"function":"create_schedule_task","params":{"title":"Install climbing frame","startDate":"2026-09-27","durationDays":5},"idempotency_key":"persona-task-1"}`
- answer: **201** `{"intent_id":"0d300df7f7d04bc0b0a0b3a89872db43","status":"done","record":{"id":"pms_issues_149","route":"/schedule"},"submission_id":"submissions_142","replayed":false}`

- PASS: create_schedule_task
- PASS: create_milestone is listed by the link as a level-1 (direct) function
**51. AI: `POST /actions`**
- sent: `{"function":"create_milestone","params":{"title":"Play Area handover","targetDate":"2026-11-15"},"idempotency_key":"persona-milestone-1"}`
- answer: **201** `{"intent_id":"1aa0ef730081432cb931766cb5035e94","status":"done","record":{"id":"pms_milestones_154","route":"/milestones"},"submission_id":"submissions_152","replayed":false}`

- PASS: create_milestone
- PASS: update_milestone is listed by the link as a level-1 (direct) function
**52. AI: `POST /actions`**
- sent: `{"function":"update_milestone","params":{"milestoneId":"pms_milestones_154","status":"in_progress"},"idempotency_key":"persona-milestone-2"}`
- answer: **201** `{"intent_id":"d91d7ea639a5424cb22d613122ad550d","status":"done","record":{"id":"pms_milestones_154","route":"/milestones"},"submission_id":"submissions_157","replayed":false}`

- PASS: update_milestone
- PASS: create_meeting is listed by the link as a level-1 (direct) function
**53. AI: `POST /actions`**
- sent: `{"function":"create_meeting","params":{"title":"Weekly site review","scheduledAt":"2026-09-25T10:00:00Z"},"idempotency_key":"persona-meeting-1"}`
- answer: **201** `{"intent_id":"a2f41ad1698646dcbad04670663a50e3","status":"done","record":{"id":"pms_meetings_163","route":"/moms/pms_meetings_163"},"submission_id":"submissions_161","replayed":false}`

- PASS: create_meeting
- PASS: add_meeting_outcome is listed by the link as a level-1 (direct) function
**54. AI: `POST /actions`**
- sent: `{"function":"add_meeting_outcome","params":{"meetingId":"pms_meetings_163","notes":"Client accepted the mock-up of the entrance."},"idempotency_key":"persona-meeting-outcome"}`
- answer: **201** `{"intent_id":"4fac5eead7cc466880f74ee7ddfb18c2","status":"done","record":{"id":"pms_meeting_outcomes_168","route":"/meetings/pms_meetings_163"},"submission_id":"submissions_166","replayed":false}`

- PASS: add_meeting_outcome
- PASS: create_mom is listed by the link as a level-1 (direct) function
**55. AI: `POST /actions`**
- sent: `{"function":"create_mom","params":{"title":"Weekly site review minutes","scheduledAt":"2026-09-25T10:00:00Z","attendees":["Sumeet","Ravi"],"minutes":"Slab pour agreed."},"idempotency_key":"persona-mom-1"}`
- answer: **201** `{"intent_id":"0be155381be34654bf2113d3461cb58a","status":"done","record":{"id":"veri_meetings_173","route":"/moms/veri_meetings_173"},"submission_id":"submissions_171","replayed":false}`

- PASS: create_mom
- PASS: add_meeting_action_item is listed by the link as a level-1 (direct) function
**56. AI: `POST /actions`**
- sent: `{"function":"add_meeting_action_item","params":{"meetingId":"veri_meetings_173","title":"Confirm tile order with the supplier","dueDate":"2026-09-27"},"idempotency_key":"persona-meeting-action"}`
- answer: **201** `{"intent_id":"e71a2f1258d144c9bf29049172f60f8d","status":"done","record":{"id":"veri_meeting_action_items_180","route":"/moms/veri_meetings_173"},"submission_id":"submissions_177","replayed":false}`

- PASS: add_meeting_action_item on the minutes
- PASS: update_mom_minutes is listed by the link as a level-1 (direct) function
**57. AI: `POST /actions`**
- sent: `{"function":"update_mom_minutes","params":{"meetingId":"veri_meetings_173","minutes":"Slab pour agreed for Monday; tiles ordered."},"idempotency_key":"persona-mom-2"}`
- answer: **201** `{"intent_id":"895479270ec84553a2cb3eb6a6753897","status":"done","record":{"id":"veri_meetings_173","route":"/moms/veri_meetings_173"},"submission_id":"submissions_184","replayed":false}`

- PASS: update_mom_minutes
- PASS: publish_mom is listed by the link as a level-2 (the person confirms) function
**58. AI: `POST /drafts`**
- sent: `{"function":"publish_mom","params":{"meetingId":"veri_meetings_173"},"idempotency_key":"persona-mom-publish"}`
- answer: **201** `{"draft_id":"b6802275687a4b98b2c3476699fddf60","intent_id":"b6802275687a4b98b2c3476699fddf60","status":"awaiting_confirmation","kind":"draft","function":"publish_mom","replayed":false,"expires_at":"2026-09-28T21:46:41Z","confirm_url":"https://localhost/ai-confirm.html#d=b6802275687a4b98b2c3476699fddf60.66102c…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_cc…/drafts/b6802275687a …(720 chars)`

- PASS: publish_mom: the draft is recorded (201) and nothing has changed yet
**59. Sumeet (signed in): `POST /drafts/b6802275687a4b98b2c3476699fddf60/preview`**
- sent: `{"confirmToken":"66102c…"}`
- answer: **200** `{"draft_id":"b6802275687a4b98b2c3476699fddf60","function_id":"publish_mom","label":"Publish the minutes","params":{"meetingId":"veri_meetings_173"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:41Z","expires_at":"2026-09-28T21:46:41Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**60. Sumeet (signed in): `POST /drafts/b6802275687a4b98b2c3476699fddf60/confirm`**
- sent: `{"confirmToken":"66102c…"}`
- answer: **200** `{"draft_id":"b6802275687a4b98b2c3476699fddf60","status":"done","function_id":"publish_mom","record":{"id":"veri_meetings_173","route":"/moms/veri_meetings_173"},"submission_id":"submissions_189","message":"The change is applied to the project."}`

- PASS: publish_mom: the person confirms and it is applied
**61. Sumeet (signed in): `POST /links/1ff0a9c03fef4f41bb8d7338288a8008/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"1ff0a9c03fef4f41bb8d7338288a8008","revoked":true,"already":false}`

- PASS: link 1ff0a9… is revoked through the app route (200)
**62. AI (yesterday's link): `GET /context?format=json`**
- answer: **410** `{"error":"This link has expired or was revoked","hint":"Ask the person for a new link."}`

- PASS: the evening's link is gone: the same address answers 410

## Thursday. Timesheets, materials, site instructions, change orders, billing and KPI

**63. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"Thursday, Sumeet's chat AI"}`
- answer: **201** `{"link_id":"6f184a8be9094b5693efbfc28fea1399","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2784 chars)`

- PASS: Thursday, Sumeet's chat AI: the mint route answers 201 for a project the person can read
- PASS: record_timesheet is listed by the link as a level-1 (direct) function
**64. AI: `POST /actions`**
- sent: `{"function":"record_timesheet","params":{"task":"Install climbing frame","hours":3.5},"idempotency_key":"persona-timesheet-1"}`
- answer: **201** `{"intent_id":"dde13f698dc54918a320473edafcb4b7","status":"done","record":{"id":"pms_time_entries_196","route":"/schedule/timesheet"},"submission_id":"submissions_194","replayed":false}`

- PASS: record_timesheet against the schedule task the AI made on Wednesday
**65. AI: `GET /records/timesheets?format=json&limit=50`**
- answer: **200** `{"kind":"timesheets","items":[{"id":"pms_time_entries_196","hours":3.5,"user_id":"person_sumeet","billable":true,"comments":null,"issue_id":"pms_issues_149","spent_on":"2026-09-26","created_at":"2026-09-26T21:46:41.167+00:00","activity_type":null,"approval_status":"draft","invoice_item_id":null,"hourly_rate_snapshot":null},{"id":"time_maya","hours":6,"user_id":"person_maya","billable":true,"comments":null,"issue_id":"issue_setout","spent_on":"2026-09-25","created_at":"2026-09-26T21:46:33.397+00:00","activity_type": …(702 chars)`

- PASS: records/timesheets: the AI reads its own entry and Maya's submitted week
- PASS: the AI finds Maya's submitted timesheet
- PASS: approve_timesheet is listed by the link as a level-2 (the person confirms) function
**66. AI: `POST /drafts`**
- sent: `{"function":"approve_timesheet","params":{"timeEntryId":"time_maya"},"idempotency_key":"persona-timesheet-approve"}`
- answer: **201** `{"draft_id":"3bc5a978d1d3440c8ed242efb7f91540","intent_id":"3bc5a978d1d3440c8ed242efb7f91540","status":"awaiting_confirmation","kind":"draft","function":"approve_timesheet","replayed":false,"expires_at":"2026-09-28T21:46:41Z","confirm_url":"https://localhost/ai-confirm.html#d=3bc5a978d1d3440c8ed242efb7f91540.3942e1…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_42…/drafts/3bc5a9 …(726 chars)`

- PASS: approve_timesheet: the draft is recorded (201) and nothing has changed yet
**67. Sumeet (signed in): `POST /drafts/3bc5a978d1d3440c8ed242efb7f91540/preview`**
- sent: `{"confirmToken":"3942e1…"}`
- answer: **200** `{"draft_id":"3bc5a978d1d3440c8ed242efb7f91540","function_id":"approve_timesheet","label":"Approve a timesheet entry","params":{"timeEntryId":"time_maya"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:41Z","expires_at":"2026-09-28T21:46:41Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

(Sumeet pauses a minute before the next confirm: 10 confirm calls a minute is the limit)

**68. Sumeet (signed in): `POST /drafts/3bc5a978d1d3440c8ed242efb7f91540/confirm`**
- sent: `{"confirmToken":"3942e1…"}`
- answer: **200** `{"draft_id":"3bc5a978d1d3440c8ed242efb7f91540","status":"done","function_id":"approve_timesheet","record":{"id":"time_maya","route":"/timesheets"},"submission_id":"submissions_199","message":"The change is applied to the project."}`

- PASS: approve_timesheet: the person confirms and it is applied
- PASS: re-read: Maya's timesheet is approved
- PASS: re-read: the entry the AI recorded for Sumeet stays a draft (no link function submits a timesheet)
- PASS: create_material is listed by the link as a level-2 (the person confirms) function
**69. AI: `POST /drafts`**
- sent: `{"function":"create_material","params":{"name":"Rubber tile 25 mm","unit":"sqm","unitCost":210},"idempotency_key":"persona-material-1"}`
- answer: **201** `{"draft_id":"643ecd77ce924a5aab6632a7c631475a","intent_id":"643ecd77ce924a5aab6632a7c631475a","status":"awaiting_confirmation","kind":"draft","function":"create_material","replayed":false,"expires_at":"2026-09-28T21:46:41Z","confirm_url":"https://localhost/ai-confirm.html#d=643ecd77ce924a5aab6632a7c631475a.3e5d51…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_42…/drafts/643ecd77 …(724 chars)`

- PASS: create_material: the draft is recorded (201) and nothing has changed yet
**70. Sumeet (signed in): `POST /drafts/643ecd77ce924a5aab6632a7c631475a/preview`**
- sent: `{"confirmToken":"3e5d51…"}`
- answer: **200** `{"draft_id":"643ecd77ce924a5aab6632a7c631475a","function_id":"create_material","label":"New material","params":{"name":"Rubber tile 25 mm","unit":"sqm","unitCost":210},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:41Z","expires_at":"2026-09-28T21:46:41Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**71. Sumeet (signed in): `POST /drafts/643ecd77ce924a5aab6632a7c631475a/confirm`**
- sent: `{"confirmToken":"3e5d51…"}`
- answer: **200** `{"draft_id":"643ecd77ce924a5aab6632a7c631475a","status":"done","function_id":"create_material","record":{"id":"construction_materials_205","route":"/materials"},"submission_id":"submissions_203","message":"The change is applied to the project."}`

- PASS: create_material: the person confirms and it is applied
- PASS: record_material_receipt is listed by the link as a level-2 (the person confirms) function
**72. AI: `POST /drafts`**
- sent: `{"function":"record_material_receipt","params":{"materialId":"construction_materials_205","quantity":120,"unitCost":205,"receivedDate":"2026-09-26"},"idempotency_key":"persona-receipt-1"}`
- answer: **201** `{"draft_id":"e6ddc96992c84443bc0327d562cbcc5f","intent_id":"e6ddc96992c84443bc0327d562cbcc5f","status":"awaiting_confirmation","kind":"draft","function":"record_material_receipt","replayed":false,"expires_at":"2026-09-28T21:46:41Z","confirm_url":"https://localhost/ai-confirm.html#d=e6ddc96992c84443bc0327d562cbcc5f.3ab16c…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_42…/drafts/ …(732 chars)`

- PASS: record_material_receipt: the draft is recorded (201) and nothing has changed yet
**73. Sumeet (signed in): `POST /drafts/e6ddc96992c84443bc0327d562cbcc5f/preview`**
- sent: `{"confirmToken":"3ab16c…"}`
- answer: **200** `{"draft_id":"e6ddc96992c84443bc0327d562cbcc5f","function_id":"record_material_receipt","label":"Record a material receipt","params":{"quantity":120,"unitCost":205,"materialId":"construction_materials_205","receivedDate":"2026-09-26"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:41Z","expires_at":"2026-09-28T21:46:41Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes …(536 chars)`

**74. Sumeet (signed in): `POST /drafts/e6ddc96992c84443bc0327d562cbcc5f/confirm`**
- sent: `{"confirmToken":"3ab16c…"}`
- answer: **200** `{"draft_id":"e6ddc96992c84443bc0327d562cbcc5f","status":"done","function_id":"record_material_receipt","record":{"id":"construction_material_receipts_210","route":"/materials"},"submission_id":"submissions_208","message":"The change is applied to the project."}`

- PASS: record_material_receipt: the person confirms and it is applied
- PASS: record_material_receipt (money) is applied after the confirm
- PASS: record_material_issue is listed by the link as a level-1 (direct) function
**75. AI: `POST /actions`**
- sent: `{"function":"record_material_issue","params":{"materialId":"construction_materials_205","quantity":40,"issuedDate":"2026-09-27","issuedTo":"Flooring gang"},"idempotency_key":"persona-issue-1"}`
- answer: **201** `{"intent_id":"1df97cd23d23495a84df08f8eb44bc17","status":"done","record":{"id":"construction_material_issues_215","route":"/materials"},"submission_id":"submissions_213","replayed":false}`

- PASS: record_material_issue (level 1) against the received stock
**76. AI: `POST /actions`**
- sent: `{"function":"record_material_issue","params":{"materialId":"construction_materials_205","quantity":500,"issuedDate":"2026-09-27","issuedTo":"Flooring gang"},"idempotency_key":"persona-issue-over"}`
- answer: **422** `{"code":"REQUEST_REJECTED","missing":[],"error":"The change could not be applied.","hint":"code and missing say what to fix; a corrected request with the same parameters can run."}`

- PASS: issuing more than is in stock is refused (422 REQUEST_REJECTED)
- PASS: create_site_instruction is listed by the link as a level-2 (the person confirms) function
**77. AI: `POST /drafts`**
- sent: `{"function":"create_site_instruction","params":{"issueDate":"2026-09-26","toContractor":"Main contractor","description":"Move the reception door 300 mm to the left"},"idempotency_key":"persona-si-1"}`
- answer: **201** `{"draft_id":"633db484fa744637b4aed4f065747611","intent_id":"633db484fa744637b4aed4f065747611","status":"awaiting_confirmation","kind":"draft","function":"create_site_instruction","replayed":false,"expires_at":"2026-09-28T21:46:41Z","confirm_url":"https://localhost/ai-confirm.html#d=633db484fa744637b4aed4f065747611.e38ef0…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_42…/drafts/ …(732 chars)`

- PASS: create_site_instruction: the draft is recorded (201) and nothing has changed yet
**78. Sumeet (signed in): `POST /drafts/633db484fa744637b4aed4f065747611/preview`**
- sent: `{"confirmToken":"e38ef0…"}`
- answer: **200** `{"draft_id":"633db484fa744637b4aed4f065747611","function_id":"create_site_instruction","label":"New site instruction","params":{"issueDate":"2026-09-26","description":"Move the reception door 300 mm to the left","toContractor":"Main contractor"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:41Z","expires_at":"2026-09-28T21:46:41Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Not …(548 chars)`

**79. Sumeet (signed in): `POST /drafts/633db484fa744637b4aed4f065747611/confirm`**
- sent: `{"confirmToken":"e38ef0…"}`
- answer: **200** `{"draft_id":"633db484fa744637b4aed4f065747611","status":"done","function_id":"create_site_instruction","record":{"id":"construction_site_instructions_224","route":"/site-instructions"},"submission_id":"submissions_222","message":"The change is applied to the project."}`

- PASS: create_site_instruction: the person confirms and it is applied
- PASS: create_change_order is listed by the link as a level-2 (the person confirms) function
**80. AI: `POST /drafts`**
- sent: `{"function":"create_change_order","params":{"title":"Extra partition, vet area","reason":"Client request","scheduleImpactDays":3},"idempotency_key":"persona-co-1"}`
- answer: **201** `{"draft_id":"a67691cfae754628aa285f37b09701f9","intent_id":"a67691cfae754628aa285f37b09701f9","status":"awaiting_confirmation","kind":"draft","function":"create_change_order","replayed":false,"expires_at":"2026-09-28T21:46:42Z","confirm_url":"https://localhost/ai-confirm.html#d=a67691cfae754628aa285f37b09701f9.4e87d1…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_42…/drafts/a676 …(728 chars)`

- PASS: create_change_order: the draft is recorded (201) and nothing has changed yet
**81. Sumeet (signed in): `POST /drafts/a67691cfae754628aa285f37b09701f9/preview`**
- sent: `{"confirmToken":"4e87d1…"}`
- answer: **200** `{"draft_id":"a67691cfae754628aa285f37b09701f9","function_id":"create_change_order","label":"New change order","params":{"title":"Extra partition, vet area","reason":"Client request","scheduleImpactDays":3},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:42Z","expires_at":"2026-09-28T21:46:42Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

(Sumeet pauses a minute before the next confirm: 10 confirm calls a minute is the limit)

**82. Sumeet (signed in): `POST /drafts/a67691cfae754628aa285f37b09701f9/confirm`**
- sent: `{"confirmToken":"4e87d1…"}`
- answer: **200** `{"draft_id":"a67691cfae754628aa285f37b09701f9","status":"done","function_id":"create_change_order","record":{"id":"construction_change_orders_229","route":"/change-orders/construction_change_orders_229"},"submission_id":"submissions_227","message":"The change is applied to the project."}`

- PASS: create_change_order: the person confirms and it is applied
- PASS: re-read: the change order exists
- PASS: create_progress_claim is listed by the link as a level-2 (the person confirms) function
**83. AI: `POST /drafts`**
- sent: `{"function":"create_progress_claim","params":{"boqId":"construction_boqs_2","customerId":"customer_zoomies","milestoneDescription":"Play Area partitions complete","scheduledDate":"2026-09-27","retentionPercent":5},"idempotency_key":"persona-claim-1"}`
- answer: **201** `{"draft_id":"c11ec593d64e4747b0b28dc15f95bddc","intent_id":"c11ec593d64e4747b0b28dc15f95bddc","status":"awaiting_confirmation","kind":"draft","function":"create_progress_claim","replayed":false,"expires_at":"2026-09-28T21:46:42Z","confirm_url":"https://localhost/ai-confirm.html#d=c11ec593d64e4747b0b28dc15f95bddc.3ac360…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_42…/drafts/c1 …(730 chars)`

- PASS: create_progress_claim: the draft is recorded (201) and nothing has changed yet
**84. Sumeet (signed in): `POST /drafts/c11ec593d64e4747b0b28dc15f95bddc/preview`**
- sent: `{"confirmToken":"3ac360…"}`
- answer: **200** `{"draft_id":"c11ec593d64e4747b0b28dc15f95bddc","function_id":"create_progress_claim","label":"Draft a progress claim","params":{"boqId":"construction_boqs_2","customerId":"customer_zoomies","scheduledDate":"2026-09-27","retentionPercent":5,"milestoneDescription":"Play Area partitions complete"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:42Z","expires_at":"2026-09-28T21:46:42Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message" …(598 chars)`

**85. Sumeet (signed in): `POST /drafts/c11ec593d64e4747b0b28dc15f95bddc/confirm`**
- sent: `{"confirmToken":"3ac360…"}`
- answer: **200** `{"draft_id":"c11ec593d64e4747b0b28dc15f95bddc","status":"done","function_id":"create_progress_claim","record":{"id":"construction_progress_claims_234","route":"/billing-milestones/construction_progress_claims_234"},"submission_id":"submissions_232","message":"The change is applied to the project."}`

- PASS: create_progress_claim: the person confirms and it is applied
- PASS: re-read: the billing claim was created for Sumeet
- PASS: draft_progress_claim is listed by the link as a level-2 (the person confirms) function
**86. AI: `POST /drafts`**
- sent: `{"function":"draft_progress_claim","params":{"claimId":"construction_progress_claims_234"},"idempotency_key":"persona-claim-2"}`
- answer: **201** `{"draft_id":"90eae53cbace473ebab74550505758b0","intent_id":"90eae53cbace473ebab74550505758b0","status":"awaiting_confirmation","kind":"draft","function":"draft_progress_claim","replayed":false,"expires_at":"2026-09-28T21:46:42Z","confirm_url":"https://localhost/ai-confirm.html#d=90eae53cbace473ebab74550505758b0.94d55c…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_42…/drafts/90e …(729 chars)`

- PASS: draft_progress_claim: the draft is recorded (201) and nothing has changed yet
**87. Sumeet (signed in): `POST /drafts/90eae53cbace473ebab74550505758b0/preview`**
- sent: `{"confirmToken":"94d55c…"}`
- answer: **200** `{"draft_id":"90eae53cbace473ebab74550505758b0","function_id":"draft_progress_claim","label":"Mark a claim drafted","params":{"claimId":"construction_progress_claims_234"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:42Z","expires_at":"2026-09-28T21:46:42Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**88. Sumeet (signed in): `POST /drafts/90eae53cbace473ebab74550505758b0/confirm`**
- sent: `{"confirmToken":"94d55c…"}`
- answer: **200** `{"draft_id":"90eae53cbace473ebab74550505758b0","status":"done","function_id":"draft_progress_claim","record":{"id":"construction_progress_claims_234","route":"/billing-milestones/construction_progress_claims_234"},"submission_id":"submissions_237","message":"The change is applied to the project."}`

- PASS: draft_progress_claim: the person confirms and it is applied
- PASS: submit_progress_claim is listed by the link as a level-2 (the person confirms) function
**89. AI: `POST /drafts`**
- sent: `{"function":"submit_progress_claim","params":{"claimId":"construction_progress_claims_234"},"idempotency_key":"persona-claim-3"}`
- answer: **201** `{"draft_id":"45acde7dc3ed4619b5e6d28e7ece511e","intent_id":"45acde7dc3ed4619b5e6d28e7ece511e","status":"awaiting_confirmation","kind":"draft","function":"submit_progress_claim","replayed":false,"expires_at":"2026-09-28T21:46:42Z","confirm_url":"https://localhost/ai-confirm.html#d=45acde7dc3ed4619b5e6d28e7ece511e.1f335b…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_42…/drafts/45 …(730 chars)`

- PASS: submit_progress_claim: the draft is recorded (201) and nothing has changed yet
**90. Sumeet (signed in): `POST /drafts/45acde7dc3ed4619b5e6d28e7ece511e/preview`**
- sent: `{"confirmToken":"1f335b…"}`
- answer: **200** `{"draft_id":"45acde7dc3ed4619b5e6d28e7ece511e","function_id":"submit_progress_claim","label":"Mark a claim submitted","params":{"claimId":"construction_progress_claims_234"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:42Z","expires_at":"2026-09-28T21:46:42Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**91. Sumeet (signed in): `POST /drafts/45acde7dc3ed4619b5e6d28e7ece511e/confirm`**
- sent: `{"confirmToken":"1f335b…"}`
- answer: **200** `{"draft_id":"45acde7dc3ed4619b5e6d28e7ece511e","status":"done","function_id":"submit_progress_claim","record":{"id":"construction_progress_claims_234","route":"/billing-milestones/construction_progress_claims_234"},"submission_id":"submissions_241","message":"The change is applied to the project."}`

- PASS: submit_progress_claim: the person confirms and it is applied
- PASS: re-read: the billing claim is submitted
- PASS: submit_kpi_entry is listed by the link as a level-2 (the person confirms) function
**92. AI: `POST /drafts`**
- sent: `{"function":"submit_kpi_entry","params":{"kpiDefinitionId":"kpi_progress","period":"2026-09","actualValue":42},"idempotency_key":"persona-kpi-1"}`
- answer: **201** `{"draft_id":"c2d4e335fb4c48b69f414ee80982c665","intent_id":"c2d4e335fb4c48b69f414ee80982c665","status":"awaiting_confirmation","kind":"draft","function":"submit_kpi_entry","replayed":false,"expires_at":"2026-09-28T21:46:42Z","confirm_url":"https://localhost/ai-confirm.html#d=c2d4e335fb4c48b69f414ee80982c665.c2ea21…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_42…/drafts/c2d4e33 …(725 chars)`

- PASS: submit_kpi_entry: the draft is recorded (201) and nothing has changed yet
**93. Sumeet (signed in): `POST /drafts/c2d4e335fb4c48b69f414ee80982c665/preview`**
- sent: `{"confirmToken":"c2ea21…"}`
- answer: **200** `{"draft_id":"c2d4e335fb4c48b69f414ee80982c665","function_id":"submit_kpi_entry","label":"Submit a KPI value","params":{"period":"2026-09","actualValue":42,"kpiDefinitionId":"kpi_progress"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:42Z","expires_at":"2026-09-28T21:46:42Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

(Sumeet pauses a minute before the next confirm: 10 confirm calls a minute is the limit)

**94. Sumeet (signed in): `POST /drafts/c2d4e335fb4c48b69f414ee80982c665/confirm`**
- sent: `{"confirmToken":"c2ea21…"}`
- answer: **200** `{"draft_id":"c2d4e335fb4c48b69f414ee80982c665","status":"done","function_id":"submit_kpi_entry","record":{"id":"construction_kpi_entries_247","route":"/kpis"},"submission_id":"submissions_245","message":"The change is applied to the project."}`

- PASS: submit_kpi_entry: the person confirms and it is applied
- PASS: submit_kpi_entry is applied after the confirm
**95. AI: `POST /drafts`**
- sent: `{"function":"submit_boq_for_approval","params":{"boqId":"construction_boqs_2"},"idempotency_key":"persona-boq-approval"}`
- answer: **201** `{"draft_id":"9b69b9f59e05407ba00e1b8638ca9fff","intent_id":"9b69b9f59e05407ba00e1b8638ca9fff","status":"awaiting_confirmation","kind":"draft","function":"submit_boq_for_approval","replayed":false,"expires_at":"2026-09-28T21:46:42Z","confirm_url":"https://localhost/ai-confirm.html#d=9b69b9f59e05407ba00e1b8638ca9fff.501a6b…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_42…/drafts/ …(732 chars)`

- PASS: submit_boq_for_approval is drafted for a decision the person takes later
- PASS: re-read: the BOQ is still a draft: an unconfirmed draft changed nothing
- PASS: update_project is listed by the link as a level-2 (the person confirms) function
**96. AI: `POST /drafts`**
- sent: `{"function":"update_project","params":{"targetDate":"2026-12-15","description":"Play Area and Vet Area fit-out"},"idempotency_key":"persona-project-1"}`
- answer: **201** `{"draft_id":"7da686be583c47cabd592f3e93b7c4bb","intent_id":"7da686be583c47cabd592f3e93b7c4bb","status":"awaiting_confirmation","kind":"draft","function":"update_project","replayed":false,"expires_at":"2026-09-28T21:46:42Z","confirm_url":"https://localhost/ai-confirm.html#d=7da686be583c47cabd592f3e93b7c4bb.87175c…","status_url":"http://127.0.0.1:8935/functions/v1/ai-work-link/pxa_42…/drafts/7da686be5 …(723 chars)`

- PASS: update_project: the draft is recorded (201) and nothing has changed yet
**97. Sumeet (signed in): `POST /drafts/7da686be583c47cabd592f3e93b7c4bb/preview`**
- sent: `{"confirmToken":"87175c…"}`
- answer: **200** `{"draft_id":"7da686be583c47cabd592f3e93b7c4bb","function_id":"update_project","label":"Update the project","params":{"targetDate":"2026-12-15","description":"Play Area and Vet Area fit-out"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:42Z","expires_at":"2026-09-28T21:46:42Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**98. Sumeet (signed in): `POST /drafts/7da686be583c47cabd592f3e93b7c4bb/confirm`**
- sent: `{"confirmToken":"87175c…"}`
- answer: **200** `{"draft_id":"7da686be583c47cabd592f3e93b7c4bb","status":"done","function_id":"update_project","record":{"id":"projects_1","route":"/dashboard/project"},"submission_id":"submissions_250","message":"The change is applied to the project."}`

- PASS: update_project: the person confirms and it is applied
- PASS: update_project is applied after the confirm
**99. Sumeet (signed in): `POST /links/6f184a8be9094b5693efbfc28fea1399/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"6f184a8be9094b5693efbfc28fea1399","revoked":true,"already":false}`

- PASS: link 6f184a… is revoked through the app route (200)
**100. AI (yesterday's link): `GET /context?format=json`**
- answer: **410** `{"error":"This link has expired or was revoked","hint":"Ask the person for a new link."}`

- PASS: the evening's link is gone: the same address answers 410

## Friday. What the AI is not allowed to do, and reports

**101. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"Friday, Sumeet's chat AI"}`
- answer: **201** `{"link_id":"51830514967b446f8e6f98d910663f31","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2782 chars)`

- PASS: Friday, Sumeet's chat AI: the mint route answers 201 for a project the person can read
**102. AI: `POST /actions`**
- sent: `{"function":"execute_code","params":{"language":"bash","code":"cat /etc/passwd"},"idempotency_key":"persona-code-1"}`
- answer: **403** `{"code":"FUNCTION_NOT_ON_LINK","error":"This link may not use that function.","hint":"GET /functions lists what this link may use now."}`

- PASS: a coding action is not a function of this link: refused (403)
**103. AI: `POST /functions/run_sql`**
- sent: `{"params":{"sql":"select * from users"}}`
- answer: **403** `{"code":"FUNCTION_NOT_ON_LINK","error":"This link may not use that function.","hint":"GET /functions lists what this link may use now."}`

- PASS: raw SQL is not a function of this link (403)
**104. AI: `POST /actions`**
- sent: `{"function":"delete_project","params":{"projectId":"projects_1"},"idempotency_key":"persona-admin-1"}`
- answer: **403** `{"code":"FUNCTION_NOT_ON_LINK","error":"This link may not use that function.","hint":"GET /functions lists what this link may use now."}`

- PASS: deleting the project is not on the link (refused)
**105. AI: `POST /actions`**
- sent: `{"function":"add_roster_entry","params":{"name":"Sneaky","dailyRate":1},"idempotency_key":"persona-level-2-direct"}`
- answer: **403** `{"code":"LEVEL_NOT_ALLOWED","error":"This function needs the person's confirmation: use /drafts."}`

- PASS: a level-2 function sent straight to /actions is refused with LEVEL_NOT_ALLOWED
- PASS: re-read: nothing was written for it
**106. AI: `POST /actions`**
- sent: `{"function":"create_rfi","params":{"subject":"Question","question":"Please confirm","sql":"drop table users","role":"admin","orgId":"org_elsewhere"},"idempotency_key":"persona-inject-1"}`
- answer: **422** `{"code":"PARAMS_INVALID","missing":[],"error":"The change is not valid yet.","hint":"Unknown parameter sql. Unknown parameter role. Unknown parameter orgId."}`

- PASS: an RFI with extra sql/role/orgId fields: the answer is 422
- PASS: re-read: whatever was written stayed in this organisation and this project (extra fields do not move a record)
**107. AI: `POST /actions`**
- sent: `{"function":"create_rfi","params":{"projectId":"project_oakwood","subject":"Other project","question":"x"},"idempotency_key":"persona-other-1"}`
- answer: **403** `{"code":"WRONG_PROJECT","error":"This link is for one project only.","hint":"Leave projectId out: the link supplies it."}`

- PASS: naming another project of the same organisation is refused (403)
**108. AI: `POST /actions`**
- sent: `{"function":"create_rfi","params":{"projectId":"project_elsewhere","subject":"Other org","question":"x"},"idempotency_key":"persona-other-2"}`
- answer: **403** `{"code":"WRONG_PROJECT","error":"This link is for one project only.","hint":"Leave projectId out: the link supplies it."}`

- PASS: naming a project of another organisation is refused (403)
**109. AI: `POST /actions`**
- sent: `{"function":"close_rfi","params":{"rfiId":"rfi_oakwood"},"idempotency_key":"persona-other-3"}`
- answer: **422** `{"code":"RECORD_NOT_FOUND","missing":[],"error":"The change could not be applied.","hint":"code and missing say what to fix; a corrected request with the same parameters can run."}`

- PASS: an id from another project reads as absent (422 RECORD_NOT_FOUND)
**110. AI: `POST /actions`**
- sent: `{"function":"record_attendance","params":{"rosterId":"roster_oakwood","date":"2026-09-27"},"idempotency_key":"persona-other-4"}`
- answer: **422** `{"code":"RECORD_NOT_FOUND","missing":["worker"],"error":"The change could not be applied.","hint":"code and missing say what to fix; a corrected request with the same parameters can run."}`

- PASS: a roster id from another project reads as absent (422 RECORD_NOT_FOUND)
**111. AI: `POST /actions`**
- sent: `{"function":"close_rfi","params":{"rfiId":"rfi_elsewhere"},"idempotency_key":"persona-other-5"}`
- answer: **422** `{"code":"RECORD_NOT_FOUND","missing":[],"error":"The change could not be applied.","hint":"code and missing say what to fix; a corrected request with the same parameters can run."}`

- PASS: an id from another organisation reads as absent (422 RECORD_NOT_FOUND)
**112. AI: `GET /records/rfis/rfi_oakwood`**
- answer: **404** `{"error":"No such record in this project."}`

- PASS: GET records/rfis/{id} of another project's RFI is 404
**113. AI: `GET /records/rfis?format=json&limit=50`**
- answer: **200** `{"kind":"rfis","items":[{"id":"construction_rfis_100","answer":"Use 25 mm as drawing A-14 rev C.","number":1,"status":"closed","subject":"Rubber tile thickness, play area","due_date":"2026-09-26","question":"Confirm 20 mm or 25 mm tiles at the climbing zone.","created_at":"2026-09-26T21:46:39.036+00:00","answered_at":"2026-09-26T21:46:39.139+00:00","raised_by_id":"person_sumeet","ball_in_court":"contractor","answered_by_id":"person_sumeet","assigned_to_id":null}],"next":null,"next_after":null,"hidden_fields":[],"re …(562 chars)`

- PASS: records/rfis lists 0 rows of another project or organisation
- PASS: re-read: the rows of the other projects are byte-identical before and after the attempts
**114. AI (a made-up token): `GET /context?format=json`**
- answer: **410** `{"error":"This link has expired or was revoked","hint":"Ask the person for a new link."}`

- PASS: a made-up token answers 410 and no data
**115. AI (token in the query string): `GET /context?token=pxa_e7…`**
- answer: **400** `{"error":"Put the token in the path or a header, never in the query string."}`

- PASS: a token sent as a query parameter is refused (400)

## Friday. Reports and exceptions

**116. AI: `POST /functions/get_project_exceptions`**
- sent: `{"params":{}}`
- answer: **501** `{"error":"Written in a later unit."}`

**117. AI: `POST /functions/run_named_report`**
- sent: `{"params":{"reportSlug":"work-progress"}}`
- answer: **501** `{"error":"Written in a later unit."}`

- PASS: function reads are asked for: exceptions 501, report 501
**118. AI: `GET /records/progress?format=json&limit=50`**
- answer: **200** `{"kind":"progress","items":[{"id":"construction_work_progress_entries_90","remarks":"Base coat done, level 1","created_at":"2026-09-26T21:46:38.82+00:00","entry_date":"2026-09-23","activity_id":"construction_activities_85","entry_basis":"DELTA","quantity_done":0,"recorded_by_id":"person_sumeet","boq_line_item_id":"construction_boq_line_items_10","percent_complete":25},{"id":"construction_work_progress_entries_95","remarks":"Second coat and edge trim","created_at":"2026-09-26T21:46:38.914+00:00","entry_date":"2026-0 …(812 chars)`

**119. AI: `GET /records/progress_claims?format=json&limit=50`**
- answer: **200** `{"kind":"progress_claims","items":[{"id":"construction_progress_claims_234","boq_id":"construction_boqs_2","status":"submitted","created_at":"2026-09-26T21:46:42.175+00:00","drafted_at":"2026-09-26T21:46:42.317+00:00","updated_at":"2026-09-26T21:46:42.458+00:00","approved_at":null,"customer_id":"customer_zoomies","invoiced_at":null,"rejected_at":null,"submitted_at":"2026-09-26T21:46:42.458+00:00","scheduled_date":"2026-09-27","interim_bill_id":null,"rejection_reason":null,"retention_percent":5,"milestone_descriptio …(651 chars)`

**120. AI: `GET /records/kpi_entries?format=json&limit=50`**
- answer: **200** `{"kind":"kpi_entries","items":[{"id":"construction_kpi_entries_247","unit":"%","period":"2026-09","created_at":"2026-09-26T21:46:42.6+00:00","approved_at":null,"metric_name":"Weekly progress, percent","actual_value":42,"target_value":100,"approval_status":"submitted","kpi_definition_id":"kpi_progress"}],"next":null,"next_after":null,"hidden_fields":[],"redacted":false,"text_fields_are_data":true}`

- PASS: the AI reads the week back: progress entries, the billing claim and the KPI entry
- PASS: records/progress_claims: the claim is submitted (the same as the stored row)
**121. Sumeet (signed in): `POST /links/51830514967b446f8e6f98d910663f31/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"51830514967b446f8e6f98d910663f31","revoked":true,"already":false}`

- PASS: link 518305… is revoked through the app route (200)
**122. AI (yesterday's link): `GET /context?format=json`**
- answer: **410** `{"error":"This link has expired or was revoked","hint":"Ask the person for a new link."}`

- PASS: the evening's link is gone: the same address answers 410

## Provenance of every write (re-read from the database)

- PASS: every applied change left a submission via ai_link (43 submissions for 38 applied changes)
- PASS: no write reached the database except through a link: every submission is via ai_link
- PASS: each submission names Sumeet as the user
- PASS: each submission names one of Sumeet's five links
- PASS: each applied change points at a submission of the link that made it
- PASS: each submission has model_calls 0
- PASS: each submission has level1_outcome not_needed
- PASS: each task is executor ai, never software
- PASS: the done tasks number at least the applied changes (38)

## Cleanup: every throwaway link revoked, every demoted user restored

- PASS: no throwaway link is still active (re-read from the links table)
- PASS: every user's role is back to what it was at the start (re-read)

## Findings (real behaviour of the link that the run met; not failures)

- A timesheet entry recorded through the link stays `draft`: no link function submits it, so approve_timesheet can only act on a week a person submitted in the app.

- POST /functions/{fn} for a READ function (get_project_exceptions, run_named_report) answers 501 even with writes on and the exec function wired ("Written in a later unit"): reports and exceptions are not readable through the link yet. The AI worked from records/ instead.

