# Persona run (roles), dry mode, 2026-09-27

Run by the Claude Code session acting as the EXTERNAL AI, over plain HTTP against the local execution host in dry mode.
The AI uses only the link address; the person's steps use a local session; the assertions re-read persisted rows. Tokens and confirm codes are cut to six characters.


## Set-up. Sumeet's AI records a crew member and a material (money rows), so the money columns hold data to hide

**1. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"Set-up, Sumeet's chat AI"}`
- answer: **201** `{"link_id":"88dd38f4490c44ee8e388d93611c04cd","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2782 chars)`

**2. Sumeet's AI: `POST /drafts`**
- sent: `{"function":"add_roster_entry","params":{"name":"Ravi Kumar","dailyRate":850,"trade":"Carpenter"},"idempotency_key":"<key>"}`
- answer: **201** `{"draft_id":"daddcccac1e04fc28d9aab59dd41483f","intent_id":"daddcccac1e04fc28d9aab59dd41483f","status":"awaiting_confirmation","kind":"draft","function":"add_roster_entry","replayed":false,"expires_at":"2026-09-28T23:42:56Z","confirm_url":"https://localhost/ai-confirm.html#d=daddcccac1e04fc28d9aab59dd41483f.bb3ad5…","status_url":"http://127.0.0.1:8849/functions/v1/ai-work-link/pxa_b9…/drafts/daddccc …(725 chars)`

**3. Sumeet (signed in): `POST /drafts/daddcccac1e04fc28d9aab59dd41483f/preview`**
- sent: `{"confirmToken":"bb3ad5…"}`
- answer: **200** `{"draft_id":"daddcccac1e04fc28d9aab59dd41483f","function_id":"add_roster_entry","label":"Add a worker","params":{"name":"Ravi Kumar","trade":"Carpenter","dailyRate":850},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T23:42:56Z","expires_at":"2026-09-28T23:42:56Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**4. Sumeet (signed in): `POST /drafts/daddcccac1e04fc28d9aab59dd41483f/confirm`**
- sent: `{"confirmToken":"bb3ad5…"}`
- answer: **200** `{"draft_id":"daddcccac1e04fc28d9aab59dd41483f","status":"done","function_id":"add_roster_entry","record":{"id":"construction_labour_roster_58","route":"/labour/construction_labour_roster_58"},"submission_id":"submissions_56","message":"The change is applied to the project."}`

- PASS: set-up: add_roster_entry is drafted by the AI and confirmed by Sumeet
**5. Sumeet's AI: `POST /drafts`**
- sent: `{"function":"create_material","params":{"name":"Rubber tile 25 mm","unit":"sqm","unitCost":210},"idempotency_key":"<key>"}`
- answer: **201** `{"draft_id":"066b95d759c840e8b5d01ba020438e84","intent_id":"066b95d759c840e8b5d01ba020438e84","status":"awaiting_confirmation","kind":"draft","function":"create_material","replayed":false,"expires_at":"2026-09-28T23:42:56Z","confirm_url":"https://localhost/ai-confirm.html#d=066b95d759c840e8b5d01ba020438e84.b8c835…","status_url":"http://127.0.0.1:8849/functions/v1/ai-work-link/pxa_b9…/drafts/066b95d7 …(724 chars)`

**6. Sumeet (signed in): `POST /drafts/066b95d759c840e8b5d01ba020438e84/preview`**
- sent: `{"confirmToken":"b8c835…"}`
- answer: **200** `{"draft_id":"066b95d759c840e8b5d01ba020438e84","function_id":"create_material","label":"New material","params":{"name":"Rubber tile 25 mm","unit":"sqm","unitCost":210},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T23:42:56Z","expires_at":"2026-09-28T23:42:56Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**7. Sumeet (signed in): `POST /drafts/066b95d759c840e8b5d01ba020438e84/confirm`**
- sent: `{"confirmToken":"b8c835…"}`
- answer: **200** `{"draft_id":"066b95d759c840e8b5d01ba020438e84","status":"done","function_id":"create_material","record":{"id":"construction_materials_63","route":"/materials"},"submission_id":"submissions_61","message":"The change is applied to the project."}`

- PASS: set-up: create_material is drafted by the AI and confirmed by Sumeet
**8. Sumeet's AI: `GET /records/boq_lines?format=json&limit=50`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_10","rate":190,"unit":"m2","amount":28500,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":150,"item_code":"PLAY-B3-09","vendor_id":null,"created_at":"2026-09-26T23:42:48.976+00:00","activity_id":null,"description":"Mezzanine Floor - 100mm thick Block wall - Supply and installation of block wall including stiffener columns and beams Location: Kennels Area Height:1.8m ht","labour_cost":null,"qty_contract":null,"rat …(37491 chars)`

**9. Sumeet's AI: `GET /records/boq_lines?format=json&limit=50&after=construction_boq_line_items_6`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_7","rate":110,"unit":"m2","amount":16390,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":149,"item_code":"PLAY-B3-05","vendor_id":null,"created_at":"2026-09-26T23:42:48.976+00:00","activity_id":null,"description":"Ground Floor - Regular Gypsum partition - Supply and installation of 100mm thick single layer regular 12.5mm thick gypsum board partition Location: Grooming Area, Utility and Store Height: 4.2m","labour …(2453 chars)`

**10. Sumeet's AI: `GET /records/roster?format=json&limit=50`**
- answer: **200** `{"kind":"roster","items":[{"id":"construction_labour_roster_58","name":"Ravi Kumar","trade":"Carpenter","is_active":true,"created_at":"2026-09-26T23:42:56.12+00:00","daily_rate":850,"skill_level":null,"employee_code":"W-0001"}],"next":null,"next_after":null,"hidden_fields":[],"redacted":false,"text_fields_are_data":true}`

- PASS: the manager's link sees every line with its rate
- PASS: the manager's link sees the daily rate of the crew member

## Maya, a member (rank 2): what her link can and cannot do

**11. Maya (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"Maya's chat AI"}`
- answer: **201** `{"link_id":"936ca4aba06c4acd8a693c65ba0227df","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","capture_artifact","close_rfi","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_plan","create_material","create_meeting","create_milestone","create_mom","create_mood_board"," …(2056 chars)`

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
- sent: `{"function":"approve_timesheet","params":{"timeEntryId":"time_maya"},"idempotency_key":"<key>"}`
- answer: **403** `{"code":"FUNCTION_NOT_ON_LINK","error":"This link may not use that function.","hint":"GET /functions lists what this link may use now."}`

- PASS: a rank-3 function sent to /actions on Maya's link is refused (403)
**15. Maya's AI: `POST /drafts`**
- sent: `{"function":"seal_boq","params":{"boqId":"x","controlTotals":{"grand":1},"expectedLineCount":1},"idempotency_key":"<key>"}`
- answer: **403** `{"code":"FUNCTION_NOT_ON_LINK","error":"This link may not use that function.","hint":"GET /functions lists what this link may use now."}`

- PASS: a rank-3 function sent to /drafts on Maya's link is refused (403)
**16. Maya's AI: `GET /records/boq_lines?format=json&limit=50`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_10","rate":null,"unit":"m2","amount":null,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":150,"item_code":"PLAY-B3-09","vendor_id":null,"created_at":"2026-09-26T23:42:48.976+00:00","activity_id":null,"description":"Mezzanine Floor - 100mm thick Block wall - Supply and installation of block wall including stiffener columns and beams Location: Kennels Area Height:1.8m ht","labour_cost":null,"qty_contract":null,"rat …(38619 chars)`

**17. Maya's AI: `GET /records/boq_lines?format=json&limit=50&after=construction_boq_line_items_6`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_7","rate":null,"unit":"m2","amount":null,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":149,"item_code":"PLAY-B3-05","vendor_id":null,"created_at":"2026-09-26T23:42:48.976+00:00","activity_id":null,"description":"Ground Floor - Regular Gypsum partition - Supply and installation of 100mm thick single layer regular 12.5mm thick gypsum board partition Location: Grooming Area, Utility and Store Height: 4.2m","labour …(2720 chars)`

- PASS: records/boq_lines: 53 rows, 0 money values (0 non-null in 14 hidden columns)
**18. Maya's AI: `GET /records/roster?format=json&limit=50`**
- answer: **200** `{"kind":"roster","items":[{"id":"construction_labour_roster_58","name":"Ravi Kumar","trade":"Carpenter","is_active":true,"created_at":"2026-09-26T23:42:56.12+00:00","daily_rate":null,"skill_level":null,"employee_code":"W-0001","redacted":true}],"next":null,"next_after":null,"hidden_fields":["daily_rate"],"redacted":true,"text_fields_are_data":true}`

- PASS: records/roster: the crew member is visible, the daily rate is not
**19. Maya's AI: `GET /records/materials?format=json&limit=50`**
- answer: **200** `{"kind":"materials","items":[{"id":"construction_materials_63","name":"Rubber tile 25 mm","spec":null,"unit":"sqm","is_active":true,"unit_cost":null,"created_at":"2026-09-26T23:42:56.348+00:00","reorder_level":null,"redacted":true}],"next":null,"next_after":null,"hidden_fields":["unit_cost"],"redacted":true,"text_fields_are_data":true}`

- PASS: records/materials: the material is visible, its cost is not
**20. Maya's AI: `GET /records/boqs?format=json&limit=50`**
- answer: **200** `{"kind":"boqs","items":[{"id":"construction_boqs_2","title":"12039 ZOOMIES, DIP, DUBAI, UAE. BOQ","status":"draft","version":1,"created_at":"2026-09-26T23:42:48.975+00:00","project_id":"projects_1","updated_at":"2026-09-26T23:42:48.975+00:00","approved_at":null,"created_by_id":"person_sumeet","parent_boq_id":null,"approved_by_id":null,"contract_value_override":null,"redacted":true}],"next":null,"next_after":null,"hidden_fields":["contract_value_override"],"redacted":true,"text_fields_are_data":true}`

- PASS: records/boqs: no contract value
**21. Maya's AI: `GET /records/boq_lines?format=csv&limit=5`**
- answer: **200** `id,rate,unit,amount,boq_id,category,quantity,item_code,vendor_id,created_at,activity_id,description,labour_cost,qty_contract,rate_project,material_cost,rate_contract,vendor_amount,equipment_cost,profit_percent,manpower_amount,material_amount,overhead_percent,budget_percentage,parent_line_item_id,breakdown_percentage,redacted / construction_boq_line_items_10,,m2,,construction_boqs_2,Play Area - Partition and Lining,150,PLAY-B3-09,,2026-09-26T23:42:48.976+00:00,,Mezzanine Floor - 100mm thick Block wall - Supply and i …(1979 chars)`

- PASS: the CSV form of the same page carries no money either
**22. Maya's AI: `POST /actions`**
- sent: `{"function":"record_work_progress","params":{"itemCode":"PLAY-B3-09","percent":10,"entryDate":"2026-09-27","remarks":"Maya, walk-round"},"idempotency_key":"<key>"}`
- answer: **201** `{"intent_id":"7b36ecdc19444a20a31fd19cd4ebdf90","status":"done","record":{"id":"construction_work_progress_entries_70","route":null},"submission_id":"submissions_66","replayed":false}`

- PASS: what a member may do works: a level-1 progress entry
- PASS: re-read: the entry is attributed to Maya, not to Sumeet
**23. Maya's AI: `POST /drafts`**
- sent: `{"function":"add_roster_entry","params":{"name":"Maya's man","dailyRate":700},"idempotency_key":"<key>"}`
- answer: **201** `{"draft_id":"0a6ef08d970e4807b149e774e7755c7a","intent_id":"0a6ef08d970e4807b149e774e7755c7a","status":"awaiting_confirmation","kind":"draft","function":"add_roster_entry","replayed":false,"expires_at":"2026-09-28T23:42:56Z","confirm_url":"https://localhost/ai-confirm.html#d=0a6ef08d970e4807b149e774e7755c7a.7c6e88…","status_url":"http://127.0.0.1:8849/functions/v1/ai-work-link/pxa_11…/drafts/0a6ef08 …(725 chars)`

- PASS: a money change on Maya's link is a DRAFT: nothing is written until the person confirms
- PASS: re-read: the money draft wrote no row
**24. Maya's AI: `POST /actions`**
- sent: `{"function":"add_roster_entry","params":{"name":"Maya's man 2","dailyRate":700},"idempotency_key":"<key>"}`
- answer: **403** `{"code":"LEVEL_NOT_ALLOWED","error":"This function needs the person's confirmation: use /drafts."}`

- PASS: sent straight to /actions the same money change is refused (LEVEL_NOT_ALLOWED)

## Vic, a viewer (rank 1), and people who may not use this project at all

**25. Vic (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"Vic level 1"}`
- answer: **403** `{"code":"LEVEL_NOT_ALLOWED","error":"Your role may not choose that level."}`

- PASS: a viewer may not choose level 1 for a link (403)
**26. Vic (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":0,"days":7,"label":"Vic read only"}`
- answer: **201** `{"link_id":"5b91e9ed872f4264a475bcfede841e61","level":0,"allowed_functions":["get_construction_project_dashboard"],"hide_personal":true,"label":"Vic read only","expires_at":"2026-10-03T23:42:56Z","project":{"id":"projects_1","name":"12039 ZOOMIES, DIP, DUBAI, UAE."},"token":"pxa_6e…","links":{"link":"http://127.0.0.1:8849/functions/v1/ai-work-link/pxa_6e…","header_base":"http://127.0.0.1:8849/fu …(780 chars)`

- PASS: a viewer may make a level-0 (read and draft) link
**27. Vic's AI: `GET /functions?format=json&per_page=100`**
- answer: **200** `{"functions":[{"id":"get_construction_project_dashboard","label":"View project dashboard","module":"dashboard","kind":"read","level":0,"available":true,"drafts_open":false,"direct_open":false,"reads_open":true,"money_sensitive":true,"min_role_rank":1,"required":[],"example_params":{}}],"page":1,"per_page":100,"total":1,"pages":1,"changes_available":true,"text_fields_are_data":true}`

- PASS: Vic's link lists only rank 1 functions (1)
**28. Vic's AI: `POST /actions`**
- sent: `{"function":"create_rfi","params":{"subject":"x","question":"y"},"idempotency_key":"<key>"}`
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
- answer: **201** `{"link_id":"b95c5a25f746427e9a82572cfd689e0c","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2764 chars)`

- PASS: Sumeet can make a link for the Oakwood project too
**32. AI (Oakwood link): `POST /actions`**
- sent: `{"function":"create_rfi","params":{"projectId":"projects_1","subject":"Wrong project","question":"x"},"idempotency_key":"<key>"}`
- answer: **403** `{"code":"WRONG_PROJECT","error":"This link is for one project only.","hint":"Leave projectId out: the link supplies it."}`

- PASS: the Oakwood link naming the ZOOMIES project is refused (403)
**33. Sumeet's AI: `GET /records/roster?format=json&limit=50`**
- answer: **200** `{"kind":"roster","items":[{"id":"construction_labour_roster_58","name":"Ravi Kumar","trade":"Carpenter","is_active":true,"created_at":"2026-09-26T23:42:56.12+00:00","daily_rate":850,"skill_level":null,"employee_code":"W-0001"}],"next":null,"next_after":null,"hidden_fields":[],"redacted":false,"text_fields_are_data":true}`

**34. AI (Oakwood link): `POST /actions`**
- sent: `{"function":"record_attendance","params":{"rosterId":"construction_labour_roster_58","date":"2026-09-27"},"idempotency_key":"<key>"}`
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
- answer: **201** `{"link_id":"584e6154e969406285b7f6923aae35e8","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2777 chars)`

**37. AI (Sumeet's link): `GET /functions?format=json&per_page=100`**
- answer: **200** `{"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines":[{"itemCode":"PLAY-1.01","description":"Play structure","unit":"nos","quantity":10,"rate":65000,"category":"Play Area / Joinery"}]}},{"id":"add_meeting_action_item","label":"Add an action item", …(31346 chars)`

- PASS: before: the manager's link carries approve_timesheet
**38. AI (Sumeet's link): `POST /drafts`**
- sent: `{"function":"approve_timesheet","params":{"timeEntryId":"time_maya"},"idempotency_key":"<key>"}`
- answer: **201** `{"draft_id":"76997c4146974781a8823842531e7496","intent_id":"76997c4146974781a8823842531e7496","status":"awaiting_confirmation","kind":"draft","function":"approve_timesheet","replayed":false,"expires_at":"2026-09-28T23:42:57Z","confirm_url":"https://localhost/ai-confirm.html#d=76997c4146974781a8823842531e7496.7bca4b…","status_url":"http://127.0.0.1:8849/functions/v1/ai-work-link/pxa_0a…/drafts/76997c …(726 chars)`

- PASS: the AI drafts approve_timesheet while Sumeet is a manager
**39. AI (Sumeet's link): `GET /functions?format=json&per_page=100`**
- answer: **200** `{"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines":[{"itemCode":"PLAY-1.01","description":"Play structure","unit":"nos","quantity":10,"rate":65000,"category":"Play Area / Joinery"}]}},{"id":"add_meeting_action_item","label":"Add an action item", …(21630 chars)`

- PASS: after the demotion the same link no longer carries approve_timesheet
**40. AI (Sumeet's link): `GET /records/boq_lines?format=json&limit=50`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_10","rate":null,"unit":"m2","amount":null,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":150,"item_code":"PLAY-B3-09","vendor_id":null,"created_at":"2026-09-26T23:42:48.976+00:00","activity_id":null,"description":"Mezzanine Floor - 100mm thick Block wall - Supply and installation of block wall including stiffener columns and beams Location: Kennels Area Height:1.8m ht","labour_cost":null,"qty_contract":null,"rat …(38619 chars)`

**41. AI (Sumeet's link): `GET /records/boq_lines?format=json&limit=50&after=construction_boq_line_items_6`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_7","rate":null,"unit":"m2","amount":null,"boq_id":"construction_boqs_2","category":"Play Area - Partition and Lining","quantity":149,"item_code":"PLAY-B3-05","vendor_id":null,"created_at":"2026-09-26T23:42:48.976+00:00","activity_id":null,"description":"Ground Floor - Regular Gypsum partition - Supply and installation of 100mm thick single layer regular 12.5mm thick gypsum board partition Location: Grooming Area, Utility and Store Height: 4.2m","labour …(2720 chars)`

- PASS: after the demotion the same link reads no rates (money is redacted by the role NOW)
**42. Sumeet (signed in): `POST /drafts/76997c4146974781a8823842531e7496/preview`**
- sent: `{"confirmToken":"7bca4b…"}`
- answer: **200** `{"draft_id":"76997c4146974781a8823842531e7496","function_id":"approve_timesheet","label":"Approve a timesheet entry","params":{"timeEntryId":"time_maya"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T23:42:57Z","expires_at":"2026-09-28T23:42:57Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**43. Sumeet (signed in): `POST /drafts/76997c4146974781a8823842531e7496/confirm`**
- sent: `{"confirmToken":"7bca4b…"}`
- answer: **200** `{"draft_id":"76997c4146974781a8823842531e7496","status":"refused","function_id":"approve_timesheet","code":"ROLE_CHANGED","message":"Confirmed, but nothing was applied: your role no longer allows this change."}`

- PASS: confirming the earlier draft after the demotion does not apply it (200 refused ROLE_CHANGED)
- PASS: re-read: Maya's timesheet is still submitted (the demoted person's confirm changed nothing)
**44. AI (Sumeet's link): `GET /functions?format=json&per_page=100`**
- answer: **200** `{"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines":[{"itemCode":"PLAY-1.01","description":"Play structure","unit":"nos","quantity":10,"rate":65000,"category":"Play Area / Joinery"}]}},{"id":"add_meeting_action_item","label":"Add an action item", …(31346 chars)`

- PASS: after the role is restored the same link carries approve_timesheet again
**45. AI (Sumeet's link): `POST /drafts`**
- sent: `{"function":"approve_timesheet","params":{"timeEntryId":"time_maya"},"idempotency_key":"<key>"}`
- answer: **201** `{"draft_id":"4fbe4b8fadf3488984846865f29cd531","intent_id":"4fbe4b8fadf3488984846865f29cd531","status":"awaiting_confirmation","kind":"draft","function":"approve_timesheet","replayed":false,"expires_at":"2026-09-28T23:42:57Z","confirm_url":"https://localhost/ai-confirm.html#d=4fbe4b8fadf3488984846865f29cd531.2a1335…","status_url":"http://127.0.0.1:8849/functions/v1/ai-work-link/pxa_0a…/drafts/4fbe4b …(726 chars)`

**46. Sumeet (signed in): `POST /drafts/4fbe4b8fadf3488984846865f29cd531/preview`**
- sent: `{"confirmToken":"2a1335…"}`
- answer: **200** `{"draft_id":"4fbe4b8fadf3488984846865f29cd531","function_id":"approve_timesheet","label":"Approve a timesheet entry","params":{"timeEntryId":"time_maya"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T23:42:57Z","expires_at":"2026-09-28T23:42:57Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**47. Sumeet (signed in): `POST /drafts/4fbe4b8fadf3488984846865f29cd531/confirm`**
- sent: `{"confirmToken":"2a1335…"}`
- answer: **200** `{"draft_id":"4fbe4b8fadf3488984846865f29cd531","status":"done","function_id":"approve_timesheet","record":{"id":"time_maya","route":"/timesheets"},"submission_id":"submissions_77","message":"The change is applied to the project."}`

- PASS: a new draft confirmed by the restored manager is applied

## Cleanup: every throwaway link revoked, every demoted user restored

**48. Sumeet (signed in): `POST /links/88dd38f4490c44ee8e388d93611c04cd/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"88dd38f4490c44ee8e388d93611c04cd","revoked":false,"already":true}`

- PASS: link 88dd38… is revoked through the app route (200)
**49. Maya (signed in): `POST /links/936ca4aba06c4acd8a693c65ba0227df/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"936ca4aba06c4acd8a693c65ba0227df","revoked":true,"already":false}`

- PASS: link 936ca4… is revoked through the app route (200)
**50. Vic (signed in): `POST /links/5b91e9ed872f4264a475bcfede841e61/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"5b91e9ed872f4264a475bcfede841e61","revoked":true,"already":false}`

- PASS: link 5b91e9… is revoked through the app route (200)
**51. Sumeet (signed in): `POST /links/b95c5a25f746427e9a82572cfd689e0c/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"b95c5a25f746427e9a82572cfd689e0c","revoked":true,"already":false}`

- PASS: link b95c5a… is revoked through the app route (200)
**52. Sumeet (signed in): `POST /links/584e6154e969406285b7f6923aae35e8/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"584e6154e969406285b7f6923aae35e8","revoked":true,"already":false}`

- PASS: link 584e61… is revoked through the app route (200)
- PASS: no throwaway link is still active (re-read from the links table)
- PASS: every user's role is back to what it was at the start (re-read)

## Findings (real behaviour of the link that the run met; not failures)

- Maya's member link carries 15 money-sensitive WRITE functions as level-2 drafts (rank 2 is enough: add_boq_lines, add_roster_entry, apply_boq_import, create_boq, create_boq_revision, create_change_order ...); her draft of add_roster_entry was 201. The register row AW-702 reads "cannot write money functions"; what the code guarantees is "sees no money, and every money change waits for the person's confirmation".

