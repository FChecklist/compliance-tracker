# Persona run (roles), dry mode, 2026-09-27

Run by the Claude Code session acting as the EXTERNAL AI, over plain HTTP against the local execution host in dry mode.
The AI uses only the link address; the person's steps use a local session; the assertions re-read persisted rows. Tokens and confirm codes are cut to six characters.


## Set-up. Sumeet's AI records a crew member and a material (money rows), so the money columns hold data to hide

**1. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"Set-up, Sumeet's chat AI"}`
- answer: **201** `{"link_id":"471f9b27e70a44f3bf55da76adbaab38","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2782 chars)`

**2. Sumeet's AI: `POST /drafts`**
- sent: `{"function":"add_roster_entry","params":{"name":"Ravi Kumar","dailyRate":850,"trade":"Carpenter"},"idempotency_key":"persona-roles-roster"}`
- answer: **201** `{"draft_id":"90024ca94f1848b3b1c3ef6feb4c630e","intent_id":"90024ca94f1848b3b1c3ef6feb4c630e","status":"awaiting_confirmation","kind":"draft","function":"add_roster_entry","replayed":false,"expires_at":"2026-09-28T21:46:53Z","confirm_url":"https://localhost/ai-confirm.html#d=90024ca94f1848b3b1c3ef6feb4c630e.b86b5a…","status_url":"http://127.0.0.1:8906/functions/v1/ai-work-link/pxa_25…/drafts/90024ca …(725 chars)`

**3. Sumeet (signed in): `POST /drafts/90024ca94f1848b3b1c3ef6feb4c630e/preview`**
- sent: `{"confirmToken":"b86b5a…"}`
- answer: **200** `{"draft_id":"90024ca94f1848b3b1c3ef6feb4c630e","function_id":"add_roster_entry","label":"Add a worker","params":{"name":"Ravi Kumar","trade":"Carpenter","dailyRate":850},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:53Z","expires_at":"2026-09-28T21:46:53Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**4. Sumeet (signed in): `POST /drafts/90024ca94f1848b3b1c3ef6feb4c630e/confirm`**
- sent: `{"confirmToken":"b86b5a…"}`
- answer: **200** `{"draft_id":"90024ca94f1848b3b1c3ef6feb4c630e","status":"done","function_id":"add_roster_entry","record":{"id":"construction_labour_roster_58","route":"/labour/construction_labour_roster_58"},"submission_id":"submissions_56","message":"The change is applied to the project."}`

- PASS: set-up: add_roster_entry is drafted by the AI and confirmed by Sumeet
**5. Sumeet's AI: `POST /drafts`**
- sent: `{"function":"create_material","params":{"name":"Rubber tile 25 mm","unit":"sqm","unitCost":210},"idempotency_key":"persona-roles-material"}`
- answer: **201** `{"draft_id":"31aacc694c3d4e2f85713b7d3eddbbce","intent_id":"31aacc694c3d4e2f85713b7d3eddbbce","status":"awaiting_confirmation","kind":"draft","function":"create_material","replayed":false,"expires_at":"2026-09-28T21:46:53Z","confirm_url":"https://localhost/ai-confirm.html#d=31aacc694c3d4e2f85713b7d3eddbbce.f5a758…","status_url":"http://127.0.0.1:8906/functions/v1/ai-work-link/pxa_25…/drafts/31aacc69 …(724 chars)`

**6. Sumeet (signed in): `POST /drafts/31aacc694c3d4e2f85713b7d3eddbbce/preview`**
- sent: `{"confirmToken":"f5a758…"}`
- answer: **200** `{"draft_id":"31aacc694c3d4e2f85713b7d3eddbbce","function_id":"create_material","label":"New material","params":{"name":"Rubber tile 25 mm","unit":"sqm","unitCost":210},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:53Z","expires_at":"2026-09-28T21:46:53Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**7. Sumeet (signed in): `POST /drafts/31aacc694c3d4e2f85713b7d3eddbbce/confirm`**
- sent: `{"confirmToken":"f5a758…"}`
- answer: **200** `{"draft_id":"31aacc694c3d4e2f85713b7d3eddbbce","status":"done","function_id":"create_material","record":{"id":"construction_materials_63","route":"/materials"},"submission_id":"submissions_61","message":"The change is applied to the project."}`

- PASS: set-up: create_material is drafted by the AI and confirmed by Sumeet
**8. Sumeet's AI: `GET /records/boq_lines?format=json&limit=50`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_10","rate":190,"unit":"m2","amount":28500,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":150,"item_code":"PLAY-B3-09","vendor_id":null,"created_at":"2026-09-26T21:46:48.712+00:00","activity_id":null,"description":"Mezzanine Floor - 100mm thick Block wall - Supply and installation of block wall including stiffener columns and beams Location: Kennels Area Height:1.8m ht","labour_cost":null,"qty_contract":null,"rat …(37491 chars)`

**9. Sumeet's AI: `GET /records/boq_lines?format=json&limit=50&after=construction_boq_line_items_6`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_7","rate":110,"unit":"m2","amount":16390,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":149,"item_code":"PLAY-B3-05","vendor_id":null,"created_at":"2026-09-26T21:46:48.712+00:00","activity_id":null,"description":"Ground Floor - Regular Gypsum partition - Supply and installation of 100mm thick single layer regular 12.5mm thick gypsum board partition Location: Grooming Area, Utility and Store Height: 4.2m","labour …(2453 chars)`

**10. Sumeet's AI: `GET /records/roster?format=json&limit=50`**
- answer: **200** `{"kind":"roster","items":[{"id":"construction_labour_roster_58","name":"Ravi Kumar","trade":"Carpenter","is_active":true,"created_at":"2026-09-26T21:46:53.338+00:00","daily_rate":850,"skill_level":null,"employee_code":"W-0001"}],"next":null,"next_after":null,"hidden_fields":[],"redacted":false,"text_fields_are_data":true}`

- PASS: the manager's link sees every line with its rate
- PASS: the manager's link sees the daily rate of the crew member

## Maya, a member (rank 2): what her link can and cannot do

**11. Maya (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"Maya's chat AI"}`
- answer: **201** `{"link_id":"856b6b705fb74417836eaf1f39ccb5b8","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","capture_artifact","close_rfi","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_plan","create_material","create_meeting","create_milestone","create_mom","create_mood_board"," …(2056 chars)`

- PASS: a member can make a level-1 link for a project she can read
**12. Maya's AI: `GET /context?format=json`**
- answer: **200** `{"rate":{"limit_per_minute":120,"calls_last_minute":1},"level":1,"product":"projexa","project":{"id":"projects_1","name":"12039 ZOOMIES, DIP, DUBAI, UAE."},"counters":{"intents":0,"submissions":0},"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines …(24461 chars)`

- PASS: context: the money fields hidden from this link are listed (boq_lines rate among them)
**13. Maya's AI: `GET /functions?format=json&per_page=100`**
- answer: **200** `{"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines":[{"itemCode":"PLAY-1.01","description":"Play structure","unit":"nos","quantity":10,"rate":65000,"category":"Play Area / Joinery"}]}},{"id":"add_meeting_action_item","label":"Add an action item", …(21630 chars)`

- PASS: every function on Maya's link needs rank 2 or lower (63 functions)
- PASS: approve_timesheet (rank 3) is not on Maya's link
- PASS: seal_boq (rank 3) is not on Maya's link
- PASS: publish_mom (rank 3) is not on Maya's link
- PASS: review_submittal (rank 3) is not on Maya's link
- PASS: verify_punch_item_closed (rank 3) is not on Maya's link
- PASS: approve_kpi_entry (rank 3) is not on Maya's link
- PASS: submit_progress_claim (rank 3) is not on Maya's link
- PASS: create_progress_claim (rank 3) is not on Maya's link
**14. Maya's AI: `POST /actions`**
- sent: `{"function":"approve_timesheet","params":{"timeEntryId":"time_maya"},"idempotency_key":"persona-maya-approve"}`
- answer: **403** `{"code":"FUNCTION_NOT_ON_LINK","error":"This link may not use that function.","hint":"GET /functions lists what this link may use now."}`

- PASS: a rank-3 function sent to /actions on Maya's link is refused (403)
**15. Maya's AI: `POST /drafts`**
- sent: `{"function":"seal_boq","params":{"boqId":"x","controlTotals":{"grand":1},"expectedLineCount":1},"idempotency_key":"persona-maya-seal"}`
- answer: **403** `{"code":"FUNCTION_NOT_ON_LINK","error":"This link may not use that function.","hint":"GET /functions lists what this link may use now."}`

- PASS: a rank-3 function sent to /drafts on Maya's link is refused (403)
**16. Maya's AI: `GET /records/boq_lines?format=json&limit=50`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_10","rate":null,"unit":"m2","amount":null,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":150,"item_code":"PLAY-B3-09","vendor_id":null,"created_at":"2026-09-26T21:46:48.712+00:00","activity_id":null,"description":"Mezzanine Floor - 100mm thick Block wall - Supply and installation of block wall including stiffener columns and beams Location: Kennels Area Height:1.8m ht","labour_cost":null,"qty_contract":null,"rat …(38619 chars)`

**17. Maya's AI: `GET /records/boq_lines?format=json&limit=50&after=construction_boq_line_items_6`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_7","rate":null,"unit":"m2","amount":null,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":149,"item_code":"PLAY-B3-05","vendor_id":null,"created_at":"2026-09-26T21:46:48.712+00:00","activity_id":null,"description":"Ground Floor - Regular Gypsum partition - Supply and installation of 100mm thick single layer regular 12.5mm thick gypsum board partition Location: Grooming Area, Utility and Store Height: 4.2m","labour …(2720 chars)`

- PASS: records/boq_lines: 53 rows, 0 money values (0 non-null in 14 hidden columns)
**18. Maya's AI: `GET /records/roster?format=json&limit=50`**
- answer: **200** `{"kind":"roster","items":[{"id":"construction_labour_roster_58","name":"Ravi Kumar","trade":"Carpenter","is_active":true,"created_at":"2026-09-26T21:46:53.338+00:00","daily_rate":null,"skill_level":null,"employee_code":"W-0001","redacted":true}],"next":null,"next_after":null,"hidden_fields":["daily_rate"],"redacted":true,"text_fields_are_data":true}`

- PASS: records/roster: the crew member is visible, the daily rate is not
**19. Maya's AI: `GET /records/materials?format=json&limit=50`**
- answer: **200** `{"kind":"materials","items":[{"id":"construction_materials_63","name":"Rubber tile 25 mm","spec":null,"unit":"sqm","is_active":true,"unit_cost":null,"created_at":"2026-09-26T21:46:53.459+00:00","reorder_level":null,"redacted":true}],"next":null,"next_after":null,"hidden_fields":["unit_cost"],"redacted":true,"text_fields_are_data":true}`

- PASS: records/materials: the material is visible, its cost is not
**20. Maya's AI: `GET /records/boqs?format=json&limit=50`**
- answer: **200** `{"kind":"boqs","items":[{"id":"construction_boqs_2","title":"12039 ZOOMIES, DIP, DUBAI, UAE. BOQ","status":"draft","version":1,"created_at":"2026-09-26T21:46:48.711+00:00","project_id":"projects_1","updated_at":"2026-09-26T21:46:48.711+00:00","approved_at":null,"created_by_id":"person_sumeet","parent_boq_id":null,"approved_by_id":null,"contract_value_override":null,"redacted":true}],"next":null,"next_after":null,"hidden_fields":["contract_value_override"],"redacted":true,"text_fields_are_data":true}`

- PASS: records/boqs: no contract value
**21. Maya's AI: `GET /records/boq_lines?format=csv&limit=5`**
- answer: **200** `id,rate,unit,amount,boq_id,category,quantity,item_code,vendor_id,created_at,activity_id,description,labour_cost,qty_contract,rate_project,material_cost,rate_contract,vendor_amount,equipment_cost,profit_percent,manpower_amount,material_amount,overhead_percent,budget_percentage,parent_line_item_id,breakdown_percentage,redacted / construction_boq_line_items_10,,m2,,construction_boqs_2,Play Area - Partition and Lining,150,PLAY-B3-09,,2026-09-26T21:46:48.712+00:00,,Mezzanine Floor - 100mm thick Block wall - Supply and i …(1979 chars)`

- PASS: the CSV form of the same page carries no money either
**22. Maya's AI: `POST /actions`**
- sent: `{"function":"record_work_progress","params":{"itemCode":"PLAY-B3-09","percent":10,"entryDate":"2026-09-27","remarks":"Maya, walk-round"},"idempotency_key":"persona-maya-progress"}`
- answer: **201** `{"intent_id":"80aa5379072c4712bbd30c33c0f8c4d2","status":"done","record":{"id":"construction_work_progress_entries_70","route":null},"submission_id":"submissions_66","replayed":false}`

- PASS: what a member may do works: a level-1 progress entry
- PASS: re-read: the entry is attributed to Maya, not to Sumeet
**23. Maya's AI: `POST /drafts`**
- sent: `{"function":"add_roster_entry","params":{"name":"Maya's man","dailyRate":700},"idempotency_key":"persona-maya-money"}`
- answer: **201** `{"draft_id":"8321fc797a6b492c8c04196e719b908b","intent_id":"8321fc797a6b492c8c04196e719b908b","status":"awaiting_confirmation","kind":"draft","function":"add_roster_entry","replayed":false,"expires_at":"2026-09-28T21:46:53Z","confirm_url":"https://localhost/ai-confirm.html#d=8321fc797a6b492c8c04196e719b908b.41c1f4…","status_url":"http://127.0.0.1:8906/functions/v1/ai-work-link/pxa_9a…/drafts/8321fc7 …(725 chars)`

- PASS: a money change on Maya's link is a DRAFT: nothing is written until the person confirms
- PASS: re-read: the money draft wrote no row
**24. Maya's AI: `POST /actions`**
- sent: `{"function":"add_roster_entry","params":{"name":"Maya's man 2","dailyRate":700},"idempotency_key":"persona-maya-money-direct"}`
- answer: **403** `{"code":"LEVEL_NOT_ALLOWED","error":"This function needs the person's confirmation: use /drafts."}`

- PASS: sent straight to /actions the same money change is refused (LEVEL_NOT_ALLOWED)

## Vic, a viewer (rank 1), and people who may not use this project at all

**25. Vic (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"Vic level 1"}`
- answer: **403** `{"code":"LEVEL_NOT_ALLOWED","error":"Your role may not choose that level."}`

- PASS: a viewer may not choose level 1 for a link (403)
**26. Vic (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":0,"days":7,"label":"Vic read only"}`
- answer: **201** `{"link_id":"c795597e7ce444719c0949d148eab76a","level":0,"allowed_functions":["get_construction_project_dashboard"],"hide_personal":true,"label":"Vic read only","expires_at":"2026-10-03T21:46:53Z","project":{"id":"projects_1","name":"12039 ZOOMIES, DIP, DUBAI, UAE."},"token":"pxa_88…","links":{"link":"http://127.0.0.1:8906/functions/v1/ai-work-link/pxa_88…","header_base":"http://127.0.0.1:8906/fu …(780 chars)`

- PASS: a viewer may make a level-0 (read and draft) link
**27. Vic's AI: `GET /functions?format=json&per_page=100`**
- answer: **200** `{"functions":[{"id":"get_construction_project_dashboard","label":"View project dashboard","module":"dashboard","kind":"read","level":0,"available":true,"drafts_open":false,"direct_open":false,"reads_open":true,"money_sensitive":true,"min_role_rank":1,"required":[],"example_params":{}}],"page":1,"per_page":100,"total":1,"pages":1,"changes_available":true,"text_fields_are_data":true}`

- PASS: Vic's link lists only rank 1 functions (1)
**28. Vic's AI: `POST /actions`**
- sent: `{"function":"create_rfi","params":{"subject":"x","question":"y"},"idempotency_key":"persona-vic-rfi"}`
- answer: **403** `{"code":"FUNCTION_NOT_ON_LINK","error":"This link may not use that function.","hint":"GET /functions lists what this link may use now."}`

- PASS: Vic's level-0 link cannot make a direct change
**29. Olga (another organisation) (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"not hers"}`
- answer: **404** `{"code":"PROJECT_NOT_FOUND","error":"No such project for you."}`

- PASS: a person of another organisation cannot make a link for this project (404)
**30. Maya (signed in): `POST /mint`**
- sent: `{"projectId":"project_elsewhere","level":0,"days":7,"label":"not hers"}`
- answer: **404** `{"code":"PROJECT_NOT_FOUND","error":"No such project for you."}`

- PASS: Maya cannot make a link for a project of another organisation (404)

## A link for another project of the same organisation

**31. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"project_oakwood","level":1,"days":7,"label":"Oakwood, Sumeet's chat AI"}`
- answer: **201** `{"link_id":"18b005b565df42dc9f084fb3f2f78e21","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2764 chars)`

- PASS: Sumeet can make a link for the Oakwood project too
**32. AI (Oakwood link): `POST /actions`**
- sent: `{"function":"create_rfi","params":{"projectId":"projects_1","subject":"Wrong project","question":"x"},"idempotency_key":"persona-oak-wrong"}`
- answer: **403** `{"code":"WRONG_PROJECT","error":"This link is for one project only.","hint":"Leave projectId out: the link supplies it."}`

- PASS: the Oakwood link naming the ZOOMIES project is refused (403)
**33. Sumeet's AI: `GET /records/roster?format=json&limit=50`**
- answer: **200** `{"kind":"roster","items":[{"id":"construction_labour_roster_58","name":"Ravi Kumar","trade":"Carpenter","is_active":true,"created_at":"2026-09-26T21:46:53.338+00:00","daily_rate":850,"skill_level":null,"employee_code":"W-0001"}],"next":null,"next_after":null,"hidden_fields":[],"redacted":false,"text_fields_are_data":true}`

**34. AI (Oakwood link): `POST /actions`**
- sent: `{"function":"record_attendance","params":{"rosterId":"construction_labour_roster_58","date":"2026-09-27"},"idempotency_key":"persona-oak-roster"}`
- answer: **422** `{"code":"RECORD_NOT_FOUND","missing":["worker"],"error":"The change could not be applied.","hint":"code and missing say what to fix; a corrected request with the same parameters can run."}`

- PASS: the Oakwood link using a ZOOMIES roster id reads it as absent (422 RECORD_NOT_FOUND)
**35. AI (Oakwood link): `GET /records/boq_lines?format=json&limit=50`**
- answer: **200** `{"kind":"boq_lines","items":[],"next":null,"next_after":null,"hidden_fields":[],"redacted":false,"text_fields_are_data":true}`

- PASS: the Oakwood link's records hold no ZOOMIES BOQ line
- PASS: re-read: nothing was written on the ZOOMIES project by the Oakwood link
- PASS: re-read: no attendance row exists

## A demotion changes what an existing link may do, at once

**36. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"Before the demotion"}`
- answer: **201** `{"link_id":"6b7ce54126fa47acb2d660bbf43622da","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2777 chars)`

**37. AI (Sumeet's link): `GET /functions?format=json&per_page=100`**
- answer: **200** `{"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines":[{"itemCode":"PLAY-1.01","description":"Play structure","unit":"nos","quantity":10,"rate":65000,"category":"Play Area / Joinery"}]}},{"id":"add_meeting_action_item","label":"Add an action item", …(31346 chars)`

- PASS: before: the manager's link carries approve_timesheet
**38. AI (Sumeet's link): `POST /drafts`**
- sent: `{"function":"approve_timesheet","params":{"timeEntryId":"time_maya"},"idempotency_key":"persona-pre-demotion-draft"}`
- answer: **201** `{"draft_id":"2b18befe515c4c5dbb910d7d6131ceb5","intent_id":"2b18befe515c4c5dbb910d7d6131ceb5","status":"awaiting_confirmation","kind":"draft","function":"approve_timesheet","replayed":false,"expires_at":"2026-09-28T21:46:54Z","confirm_url":"https://localhost/ai-confirm.html#d=2b18befe515c4c5dbb910d7d6131ceb5.17d76a…","status_url":"http://127.0.0.1:8906/functions/v1/ai-work-link/pxa_2d…/drafts/2b18be …(726 chars)`

- PASS: the AI drafts approve_timesheet while Sumeet is a manager
**39. AI (Sumeet's link): `GET /functions?format=json&per_page=100`**
- answer: **200** `{"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines":[{"itemCode":"PLAY-1.01","description":"Play structure","unit":"nos","quantity":10,"rate":65000,"category":"Play Area / Joinery"}]}},{"id":"add_meeting_action_item","label":"Add an action item", …(21630 chars)`

- PASS: after the demotion the same link no longer carries approve_timesheet
**40. AI (Sumeet's link): `GET /records/boq_lines?format=json&limit=50`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_10","rate":null,"unit":"m2","amount":null,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":150,"item_code":"PLAY-B3-09","vendor_id":null,"created_at":"2026-09-26T21:46:48.712+00:00","activity_id":null,"description":"Mezzanine Floor - 100mm thick Block wall - Supply and installation of block wall including stiffener columns and beams Location: Kennels Area Height:1.8m ht","labour_cost":null,"qty_contract":null,"rat …(38619 chars)`

**41. AI (Sumeet's link): `GET /records/boq_lines?format=json&limit=50&after=construction_boq_line_items_6`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_7","rate":null,"unit":"m2","amount":null,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":149,"item_code":"PLAY-B3-05","vendor_id":null,"created_at":"2026-09-26T21:46:48.712+00:00","activity_id":null,"description":"Ground Floor - Regular Gypsum partition - Supply and installation of 100mm thick single layer regular 12.5mm thick gypsum board partition Location: Grooming Area, Utility and Store Height: 4.2m","labour …(2720 chars)`

- PASS: after the demotion the same link reads no rates (money is redacted by the role NOW)
**42. Sumeet (signed in): `POST /drafts/2b18befe515c4c5dbb910d7d6131ceb5/preview`**
- sent: `{"confirmToken":"17d76a…"}`
- answer: **200** `{"draft_id":"2b18befe515c4c5dbb910d7d6131ceb5","function_id":"approve_timesheet","label":"Approve a timesheet entry","params":{"timeEntryId":"time_maya"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:54Z","expires_at":"2026-09-28T21:46:54Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**43. Sumeet (signed in): `POST /drafts/2b18befe515c4c5dbb910d7d6131ceb5/confirm`**
- sent: `{"confirmToken":"17d76a…"}`
- answer: **200** `{"draft_id":"2b18befe515c4c5dbb910d7d6131ceb5","status":"refused","function_id":"approve_timesheet","code":"ROLE_CHANGED","message":"Confirmed, but nothing was applied: your role no longer allows this change."}`

- PASS: confirming the earlier draft after the demotion does not apply it (200 refused ROLE_CHANGED)
- PASS: re-read: Maya's timesheet is still submitted (the demoted person's confirm changed nothing)
**44. AI (Sumeet's link): `GET /functions?format=json&per_page=100`**
- answer: **200** `{"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines":[{"itemCode":"PLAY-1.01","description":"Play structure","unit":"nos","quantity":10,"rate":65000,"category":"Play Area / Joinery"}]}},{"id":"add_meeting_action_item","label":"Add an action item", …(31346 chars)`

- PASS: after the role is restored the same link carries approve_timesheet again
**45. AI (Sumeet's link): `POST /drafts`**
- sent: `{"function":"approve_timesheet","params":{"timeEntryId":"time_maya"},"idempotency_key":"persona-post-demotion-draft"}`
- answer: **201** `{"draft_id":"0615b5a84a6140cbabe6fb9d77adaafc","intent_id":"0615b5a84a6140cbabe6fb9d77adaafc","status":"awaiting_confirmation","kind":"draft","function":"approve_timesheet","replayed":false,"expires_at":"2026-09-28T21:46:54Z","confirm_url":"https://localhost/ai-confirm.html#d=0615b5a84a6140cbabe6fb9d77adaafc.3a2372…","status_url":"http://127.0.0.1:8906/functions/v1/ai-work-link/pxa_2d…/drafts/0615b5 …(726 chars)`

**46. Sumeet (signed in): `POST /drafts/0615b5a84a6140cbabe6fb9d77adaafc/preview`**
- sent: `{"confirmToken":"3a2372…"}`
- answer: **200** `{"draft_id":"0615b5a84a6140cbabe6fb9d77adaafc","function_id":"approve_timesheet","label":"Approve a timesheet entry","params":{"timeEntryId":"time_maya"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:46:54Z","expires_at":"2026-09-28T21:46:54Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**47. Sumeet (signed in): `POST /drafts/0615b5a84a6140cbabe6fb9d77adaafc/confirm`**
- sent: `{"confirmToken":"3a2372…"}`
- answer: **200** `{"draft_id":"0615b5a84a6140cbabe6fb9d77adaafc","status":"done","function_id":"approve_timesheet","record":{"id":"time_maya","route":"/timesheets"},"submission_id":"submissions_77","message":"The change is applied to the project."}`

- PASS: a new draft confirmed by the restored manager is applied

## Cleanup: every throwaway link revoked, every demoted user restored

**48. Sumeet (signed in): `POST /links/471f9b27e70a44f3bf55da76adbaab38/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"471f9b27e70a44f3bf55da76adbaab38","revoked":false,"already":true}`

- PASS: link 471f9b… is revoked through the app route (200)
**49. Maya (signed in): `POST /links/856b6b705fb74417836eaf1f39ccb5b8/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"856b6b705fb74417836eaf1f39ccb5b8","revoked":true,"already":false}`

- PASS: link 856b6b… is revoked through the app route (200)
**50. Vic (signed in): `POST /links/c795597e7ce444719c0949d148eab76a/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"c795597e7ce444719c0949d148eab76a","revoked":true,"already":false}`

- PASS: link c79559… is revoked through the app route (200)
**51. Sumeet (signed in): `POST /links/18b005b565df42dc9f084fb3f2f78e21/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"18b005b565df42dc9f084fb3f2f78e21","revoked":true,"already":false}`

- PASS: link 18b005… is revoked through the app route (200)
**52. Sumeet (signed in): `POST /links/6b7ce54126fa47acb2d660bbf43622da/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"6b7ce54126fa47acb2d660bbf43622da","revoked":true,"already":false}`

- PASS: link 6b7ce5… is revoked through the app route (200)
- PASS: no throwaway link is still active (re-read from the links table)
- PASS: every user's role is back to what it was at the start (re-read)

## Findings (real behaviour of the link that the run met; not failures)

- Maya's member link carries 15 money-sensitive WRITE functions as level-2 drafts (rank 2 is enough: add_boq_lines, add_roster_entry, apply_boq_import, create_boq, create_boq_revision, create_change_order ...); her draft of add_roster_entry was 201. The register row AW-702 reads "cannot write money functions"; what the code guarantees is "sees no money, and every money change waits for the person's confirmation".

