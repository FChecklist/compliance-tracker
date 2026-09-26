# Persona run (way3), dry mode, 2026-09-27

Run by the Claude Code session acting as the EXTERNAL AI, over plain HTTP against the local execution host in dry mode.
The AI uses only the link address; the person's steps use a local session; the assertions re-read persisted rows. Tokens and confirm codes are cut to six characters.


## The person clicks "New project with my AI": a shell project and a link, nothing else

**1. Sumeet (signed in): `POST /new-project`**
- sent: `{"days":7}`
- answer: **201** `{"shell":true,"product_id":"product_construction","link_id":"737d2fd9ea8344edaed7c3f1aa62974b","level":0,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","c …(2832 chars)`

- PASS: the shell project and its link are made in one action (201)
**2. AI: `GET /context?format=json`**
- answer: **200** `{"rate":{"limit_per_minute":120,"calls_last_minute":1},"level":0,"product":"projexa","project":{"id":"c443c4cf-9e58-4c6d-a884-4fff6818617e","name":"New project (AI setup)"},"counters":{"intents":0,"submissions":0},"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>"," …(34084 chars)`

- PASS: the link of a shell project is made at level 0: the AI drafts, the person confirms
**3. AI: `GET /records/boqs?format=json&limit=50`**
- answer: **200** `{"kind":"boqs","items":[],"next":null,"next_after":null,"hidden_fields":[],"redacted":false,"text_fields_are_data":true}`

- PASS: records/boqs: the shell project has no BOQ
**4. AI: `GET /records/boq_lines?format=json&limit=50`**
- answer: **200** `{"kind":"boq_lines","items":[],"next":null,"next_after":null,"hidden_fields":[],"redacted":false,"text_fields_are_data":true}`

- PASS: records/boq_lines: the shell project has no lines
**5. AI: `POST /actions`**
- sent: `{"function":"record_work_progress","params":{"itemCode":"X","percent":1},"idempotency_key":"persona-way3-level0"}`
- answer: **403** `{"code":"LEVEL_NOT_ALLOWED","error":"This link was made at level 0: it can propose and draft changes, and the person confirms each one.","hint":"POST /drafts records a draft."}`

- PASS: a level-0 link cannot make a direct change (LEVEL_NOT_ALLOWED)

## The AI opens the workbook itself (its own reading; the link is not involved)

- PASS: the AI found 53 lines (50 priced, 3 lump sums the file prints as bill totals)
- PASS: the workbook prints a grand total of AED 1,596,280
- PASS: the AI's own lines add up to the printed grand total
The AI's control totals per area: {"Play Area":1343445,"Vet Area":252835}; grand 1596280; 53 lines.


## The AI fills the project: rename, empty BOQ, lines in batches, control totals

**6. AI: `POST /drafts`**
- sent: `{"function":"update_project","params":{"name":"12039 ZOOMIES , DIP, DUBAI, UAE.","description":"Play Area and Vet Area fit-out"},"idempotency_key":"persona-way3-rename"}`
- answer: **201** `{"draft_id":"6786bcbd5b044e58a93c32567e7498fa","intent_id":"6786bcbd5b044e58a93c32567e7498fa","status":"awaiting_confirmation","kind":"draft","function":"update_project","replayed":false,"expires_at":"2026-09-28T21:47:07Z","confirm_url":"https://localhost/ai-confirm.html#d=6786bcbd5b044e58a93c32567e7498fa.110e93…","status_url":"http://127.0.0.1:8962/functions/v1/ai-work-link/pxa_5b…/drafts/6786bcbd5 …(723 chars)`

- PASS: update_project is drafted
**7. Sumeet (signed in): `POST /drafts/6786bcbd5b044e58a93c32567e7498fa/preview`**
- sent: `{"confirmToken":"110e93…"}`
- answer: **200** `{"draft_id":"6786bcbd5b044e58a93c32567e7498fa","function_id":"update_project","label":"Update the project","params":{"name":"12039 ZOOMIES , DIP, DUBAI, UAE.","description":"Play Area and Vet Area fit-out"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:47:07Z","expires_at":"2026-09-28T21:47:07Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**8. Sumeet (signed in): `POST /drafts/6786bcbd5b044e58a93c32567e7498fa/confirm`**
- sent: `{"confirmToken":"110e93…"}`
- answer: **200** `{"draft_id":"6786bcbd5b044e58a93c32567e7498fa","status":"done","function_id":"update_project","record":{"id":"c443c4cf-9e58-4c6d-a884-4fff6818617e","route":"/dashboard/project"},"submission_id":"submissions_1","message":"The change is applied to the project."}`

- PASS: the person confirms the new name
- PASS: re-read: the project carries the name the AI read from the workbook
**9. AI: `POST /drafts`**
- sent: `{"function":"create_boq","params":{"title":"12039 ZOOMIES , DIP, DUBAI, UAE. BOQ","idempotency_key":"way3-boq-1"},"idempotency_key":"persona-way3-boq"}`
- answer: **201** `{"draft_id":"b287181ef9824ed683065e133f4c92f1","intent_id":"b287181ef9824ed683065e133f4c92f1","status":"awaiting_confirmation","kind":"draft","function":"create_boq","replayed":false,"expires_at":"2026-09-28T21:47:07Z","confirm_url":"https://localhost/ai-confirm.html#d=b287181ef9824ed683065e133f4c92f1.a509d0…","status_url":"http://127.0.0.1:8962/functions/v1/ai-work-link/pxa_5b…/drafts/b287181ef9824 …(719 chars)`

- PASS: create_boq (empty) is drafted
**10. Sumeet (signed in): `POST /drafts/b287181ef9824ed683065e133f4c92f1/preview`**
- sent: `{"confirmToken":"a509d0…"}`
- answer: **200** `{"draft_id":"b287181ef9824ed683065e133f4c92f1","function_id":"create_boq","label":"New BOQ","params":{"title":"12039 ZOOMIES , DIP, DUBAI, UAE. BOQ","idempotency_key":"way3-boq-1"},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:47:07Z","expires_at":"2026-09-28T21:47:07Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing changes until you do."}`

**11. Sumeet (signed in): `POST /drafts/b287181ef9824ed683065e133f4c92f1/confirm`**
- sent: `{"confirmToken":"a509d0…"}`
- answer: **200** `{"draft_id":"b287181ef9824ed683065e133f4c92f1","status":"done","function_id":"create_boq","record":{"id":"construction_boqs_7","route":"/scope/construction_boqs_7"},"submission_id":"submissions_5","message":"The change is applied to the project."}`

- PASS: the person confirms the empty BOQ
- PASS: re-read: the BOQ exists with 0 lines
- PASS: 53 lines are 3 batches of at most 25
**12. AI: `POST /drafts`**
- sent: `{"function":"add_boq_lines","params":{"boqId":"construction_boqs_7","batchNo":1,"lines":[{"itemCode":"PLAY-B3-01","description":"Ground Floor - Acoustic Wall full height (floor to roof) - Supply and installation of 125mm thick double layer regular 12.5mm thick gypsum board partition with 40kg/m3 rockwool Location: Café and Reception area Height: 8.5m","unit":"m2","quantity":351,"rate":230,"category":"Play Area / Part …(6982 chars)`
- answer: **201** `{"draft_id":"2d8215c040ef4aa19c998ed8bccedeff","intent_id":"2d8215c040ef4aa19c998ed8bccedeff","status":"awaiting_confirmation","kind":"draft","function":"add_boq_lines","replayed":false,"expires_at":"2026-09-28T21:47:07Z","confirm_url":"https://localhost/ai-confirm.html#d=2d8215c040ef4aa19c998ed8bccedeff.fc5692…","status_url":"http://127.0.0.1:8962/functions/v1/ai-work-link/pxa_5b…/drafts/2d8215c040 …(722 chars)`

- PASS: add_boq_lines batch 1 (25 lines) is drafted
**13. Sumeet (signed in): `POST /drafts/2d8215c040ef4aa19c998ed8bccedeff/preview`**
- sent: `{"confirmToken":"fc5692…"}`
- answer: **200** `{"draft_id":"2d8215c040ef4aa19c998ed8bccedeff","function_id":"add_boq_lines","label":"Add BOQ lines","params":{"boqId":"construction_boqs_7","lines":[{"rate":230,"unit":"m2","category":"Play Area / Partition and Lining","itemCode":"PLAY-B3-01","quantity":351,"description":"Ground Floor - Acoustic Wall full height (floor to roof) - Supply and installation of 125mm thick double layer regular 12.5mm thick gypsum board partition with 40kg/m3 rockwool Location: Café and Reception area Height: 8.5m"},{"rate":130,"unit":" …(7316 chars)`

**14. Sumeet (signed in): `POST /drafts/2d8215c040ef4aa19c998ed8bccedeff/confirm`**
- sent: `{"confirmToken":"fc5692…"}`
- answer: **200** `{"draft_id":"2d8215c040ef4aa19c998ed8bccedeff","status":"done","function_id":"add_boq_lines","record":{"id":"construction_boqs_7","route":"/scope/construction_boqs_7"},"submission_id":"submissions_11","message":"The change is applied to the project."}`

- PASS: the person confirms batch 1
- PASS: re-read: 25 lines are stored after batch 1
**15. AI: `POST /drafts`**
- sent: `{"function":"add_boq_lines","params":{"boqId":"construction_boqs_7","batchNo":2,"lines":[{"itemCode":"PLAY-B5-04","description":"ANTIMICROBIAL PAINT FINISH -W204 - Supply and installation of new paint finish Location : GF/MF Jotun or equivalent","unit":"m2","quantity":280,"rate":40,"category":"Play Area / Wall Finishes"},{"itemCode":"PLAY-B5-05","description":"W-301 WALL TILE - Supply and installation of wall tile P. …(6645 chars)`
- answer: **201** `{"draft_id":"0f85c9fff66642cb88bbacc12547ee27","intent_id":"0f85c9fff66642cb88bbacc12547ee27","status":"awaiting_confirmation","kind":"draft","function":"add_boq_lines","replayed":false,"expires_at":"2026-09-28T21:47:08Z","confirm_url":"https://localhost/ai-confirm.html#d=0f85c9fff66642cb88bbacc12547ee27.b4ca50…","status_url":"http://127.0.0.1:8962/functions/v1/ai-work-link/pxa_5b…/drafts/0f85c9fff6 …(722 chars)`

- PASS: add_boq_lines batch 2 (25 lines) is drafted
**16. Sumeet (signed in): `POST /drafts/0f85c9fff66642cb88bbacc12547ee27/preview`**
- sent: `{"confirmToken":"b4ca50…"}`
- answer: **200** `{"draft_id":"0f85c9fff66642cb88bbacc12547ee27","function_id":"add_boq_lines","label":"Add BOQ lines","params":{"boqId":"construction_boqs_7","lines":[{"rate":40,"unit":"m2","category":"Play Area / Wall Finishes","itemCode":"PLAY-B5-04","quantity":280,"description":"ANTIMICROBIAL PAINT FINISH -W204 - Supply and installation of new paint finish Location : GF/MF Jotun or equivalent"},{"rate":120,"unit":"m2","category":"Play Area / Wall Finishes","itemCode":"PLAY-B5-05","quantity":370,"description":"W-301 WALL TILE - S …(6979 chars)`

**17. Sumeet (signed in): `POST /drafts/0f85c9fff66642cb88bbacc12547ee27/confirm`**
- sent: `{"confirmToken":"b4ca50…"}`
- answer: **200** `{"draft_id":"0f85c9fff66642cb88bbacc12547ee27","status":"done","function_id":"add_boq_lines","record":{"id":"construction_boqs_7","route":"/scope/construction_boqs_7"},"submission_id":"submissions_41","message":"The change is applied to the project."}`

- PASS: the person confirms batch 2
- PASS: re-read: 50 lines are stored after batch 2
**18. AI: `POST /drafts`**
- sent: `{"function":"add_boq_lines","params":{"boqId":"construction_boqs_7","batchNo":3,"lines":[{"itemCode":"PLAY-B1A-LS","description":"Preliminaries and General Requirements (lump sum from the bill total; the lines are not priced in the file)","unit":"LS","quantity":1,"rate":175000,"category":"Play Area / Preliminaries and General Requirements"},{"itemCode":"PLAY-B1B-LS","description":"Approval and Design Development (lum …(839 chars)`
- answer: **201** `{"draft_id":"881febeb1e2141cdbc6fd7a172a7b4cf","intent_id":"881febeb1e2141cdbc6fd7a172a7b4cf","status":"awaiting_confirmation","kind":"draft","function":"add_boq_lines","replayed":false,"expires_at":"2026-09-28T21:47:08Z","confirm_url":"https://localhost/ai-confirm.html#d=881febeb1e2141cdbc6fd7a172a7b4cf.ccab83…","status_url":"http://127.0.0.1:8962/functions/v1/ai-work-link/pxa_5b…/drafts/881febeb1e …(722 chars)`

- PASS: add_boq_lines batch 3 (3 lines) is drafted
(Sumeet pauses a minute before the next confirm: 10 confirm calls a minute is the limit)

**19. Sumeet (signed in): `POST /drafts/881febeb1e2141cdbc6fd7a172a7b4cf/preview`**
- sent: `{"confirmToken":"ccab83…"}`
- answer: **200** `{"draft_id":"881febeb1e2141cdbc6fd7a172a7b4cf","function_id":"add_boq_lines","label":"Add BOQ lines","params":{"boqId":"construction_boqs_7","lines":[{"rate":175000,"unit":"LS","category":"Play Area / Preliminaries and General Requirements","itemCode":"PLAY-B1A-LS","quantity":1,"description":"Preliminaries and General Requirements (lump sum from the bill total; the lines are not priced in the file)"},{"rate":22000,"unit":"LS","category":"Play Area / Approval and Design Development","itemCode":"PLAY-B1B-LS","quantit …(1173 chars)`

**20. Sumeet (signed in): `POST /drafts/881febeb1e2141cdbc6fd7a172a7b4cf/confirm`**
- sent: `{"confirmToken":"ccab83…"}`
- answer: **200** `{"draft_id":"881febeb1e2141cdbc6fd7a172a7b4cf","status":"done","function_id":"add_boq_lines","record":{"id":"construction_boqs_7","route":"/scope/construction_boqs_7"},"submission_id":"submissions_71","message":"The change is applied to the project."}`

- PASS: the person confirms batch 3
- PASS: re-read: 53 lines are stored after batch 3
**21. AI: `POST /drafts`**
- sent: `{"function":"add_boq_lines","params":{"boqId":"construction_boqs_7","batchNo":2,"lines":[{"itemCode":"PLAY-B5-04","description":"ANTIMICROBIAL PAINT FINISH -W204 - Supply and installation of new paint finish Location : GF/MF Jotun or equivalent","unit":"m2","quantity":280,"rate":40,"category":"Play Area / Wall Finishes"},{"itemCode":"PLAY-B5-05","description":"W-301 WALL TILE - Supply and installation of wall tile P. …(6651 chars)`
- answer: **201** `{"draft_id":"6b358f445c2b4b4ea8416950f9f32b61","intent_id":"6b358f445c2b4b4ea8416950f9f32b61","status":"awaiting_confirmation","kind":"draft","function":"add_boq_lines","replayed":false,"expires_at":"2026-09-28T21:47:08Z","confirm_url":"https://localhost/ai-confirm.html#d=6b358f445c2b4b4ea8416950f9f32b61.afe22a…","status_url":"http://127.0.0.1:8962/functions/v1/ai-work-link/pxa_5b…/drafts/6b358f445c …(722 chars)`

**22. Sumeet (signed in): `POST /drafts/6b358f445c2b4b4ea8416950f9f32b61/preview`**
- sent: `{"confirmToken":"afe22a…"}`
- answer: **200** `{"draft_id":"6b358f445c2b4b4ea8416950f9f32b61","function_id":"add_boq_lines","label":"Add BOQ lines","params":{"boqId":"construction_boqs_7","lines":[{"rate":40,"unit":"m2","category":"Play Area / Wall Finishes","itemCode":"PLAY-B5-04","quantity":280,"description":"ANTIMICROBIAL PAINT FINISH -W204 - Supply and installation of new paint finish Location : GF/MF Jotun or equivalent"},{"rate":120,"unit":"m2","category":"Play Area / Wall Finishes","itemCode":"PLAY-B5-05","quantity":370,"description":"W-301 WALL TILE - S …(6979 chars)`

**23. Sumeet (signed in): `POST /drafts/6b358f445c2b4b4ea8416950f9f32b61/confirm`**
- sent: `{"confirmToken":"afe22a…"}`
- answer: **200** `{"draft_id":"6b358f445c2b4b4ea8416950f9f32b61","status":"done","function_id":"add_boq_lines","record":{"id":"construction_boqs_7","route":"/scope/construction_boqs_7"},"submission_id":"submissions_79","message":"The change is applied to the project."}`

- PASS: batch 2 sent again is accepted as a replay
- PASS: re-read: still 53 lines, no copy of batch 2
**24. AI: `POST /drafts`**
- sent: `{"function":"seal_boq","params":{"boqId":"construction_boqs_7","controlTotals":{"areas":{"Play Area":1343445,"Vet Area":252835},"grand":1597280},"expectedLineCount":53},"idempotency_key":"persona-way3-seal-wrong"}`
- answer: **201** `{"draft_id":"4c0dd59bab5140e9ac0592bbcbc06256","intent_id":"4c0dd59bab5140e9ac0592bbcbc06256","status":"awaiting_confirmation","kind":"draft","function":"seal_boq","replayed":false,"expires_at":"2026-09-28T21:47:08Z","confirm_url":"https://localhost/ai-confirm.html#d=4c0dd59bab5140e9ac0592bbcbc06256.fad819…","status_url":"http://127.0.0.1:8962/functions/v1/ai-work-link/pxa_5b…/drafts/4c0dd59bab5140e …(717 chars)`

**25. Sumeet (signed in): `POST /drafts/4c0dd59bab5140e9ac0592bbcbc06256/preview`**
- sent: `{"confirmToken":"fad819…"}`
- answer: **200** `{"draft_id":"4c0dd59bab5140e9ac0592bbcbc06256","function_id":"seal_boq","label":"Seal the BOQ","params":{"boqId":"construction_boqs_7","controlTotals":{"areas":{"Vet Area":252835,"Play Area":1343445},"grand":1597280},"expectedLineCount":53},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:47:08Z","expires_at":"2026-09-28T21:47:08Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing  …(543 chars)`

**26. Sumeet (signed in): `POST /drafts/4c0dd59bab5140e9ac0592bbcbc06256/confirm`**
- sent: `{"confirmToken":"fad819…"}`
- answer: **200** `{"draft_id":"4c0dd59bab5140e9ac0592bbcbc06256","status":"failed","function_id":"seal_boq","code":"TOTAL_MISMATCH","missing":[],"message":"Confirmed, but the change could not be applied. Ask the AI to draft it again with the missing details."}`

- PASS: a seal with control totals that do not match is refused (failed TOTAL_MISMATCH)
- PASS: re-read: the refused seal left no seal record
**27. AI: `POST /drafts`**
- sent: `{"function":"seal_boq","params":{"boqId":"construction_boqs_7","controlTotals":{"areas":{"Play Area":1343445,"Vet Area":252835},"grand":1596280},"expectedLineCount":53},"idempotency_key":"persona-way3-seal"}`
- answer: **201** `{"draft_id":"31277a7d792349ea9e04b5787f1918cc","intent_id":"31277a7d792349ea9e04b5787f1918cc","status":"awaiting_confirmation","kind":"draft","function":"seal_boq","replayed":false,"expires_at":"2026-09-28T21:47:08Z","confirm_url":"https://localhost/ai-confirm.html#d=31277a7d792349ea9e04b5787f1918cc.17de9c…","status_url":"http://127.0.0.1:8962/functions/v1/ai-work-link/pxa_5b…/drafts/31277a7d792349e …(717 chars)`

**28. Sumeet (signed in): `POST /drafts/31277a7d792349ea9e04b5787f1918cc/preview`**
- sent: `{"confirmToken":"17de9c…"}`
- answer: **200** `{"draft_id":"31277a7d792349ea9e04b5787f1918cc","function_id":"seal_boq","label":"Seal the BOQ","params":{"boqId":"construction_boqs_7","controlTotals":{"areas":{"Vet Area":252835,"Play Area":1343445},"grand":1596280},"expectedLineCount":53},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:47:08Z","expires_at":"2026-09-28T21:47:08Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Check the change, type the code and confirm. Nothing  …(543 chars)`

**29. Sumeet (signed in): `POST /drafts/31277a7d792349ea9e04b5787f1918cc/confirm`**
- sent: `{"confirmToken":"17de9c…"}`
- answer: **200** `{"draft_id":"31277a7d792349ea9e04b5787f1918cc","status":"done","function_id":"seal_boq","record":{"id":"construction_boqs_7","route":"/scope/construction_boqs_7"},"submission_id":"submissions_87","message":"The change is applied to the project."}`

- PASS: the right control totals seal the BOQ (done  [])
- PASS: re-read: one seal record exists for the BOQ
**30. AI: `POST /drafts`**
- sent: `{"function":"add_boq_lines","params":{"boqId":"construction_boqs_7","batchNo":4,"lines":[{"itemCode":"LATE-1","description":"A line after the seal","unit":"nos","quantity":1,"rate":100,"category":"Play Area / Late"}]},"idempotency_key":"persona-way3-late"}`
- answer: **201** `{"draft_id":"7a60982a73e541939531e1d9341db1e3","intent_id":"7a60982a73e541939531e1d9341db1e3","status":"awaiting_confirmation","kind":"draft","function":"add_boq_lines","replayed":false,"expires_at":"2026-09-28T21:47:08Z","confirm_url":"https://localhost/ai-confirm.html#d=7a60982a73e541939531e1d9341db1e3.dc8e86…","status_url":"http://127.0.0.1:8962/functions/v1/ai-work-link/pxa_5b…/drafts/7a60982a73 …(722 chars)`

(Sumeet pauses a minute before the next confirm: 10 confirm calls a minute is the limit)

**31. Sumeet (signed in): `POST /drafts/7a60982a73e541939531e1d9341db1e3/preview`**
- sent: `{"confirmToken":"dc8e86…"}`
- answer: **200** `{"draft_id":"7a60982a73e541939531e1d9341db1e3","function_id":"add_boq_lines","label":"Add BOQ lines","params":{"boqId":"construction_boqs_7","lines":[{"rate":100,"unit":"nos","category":"Play Area / Late","itemCode":"LATE-1","quantity":1,"description":"A line after the seal"}],"batchNo":4},"state":"awaiting_confirmation","can_confirm":true,"writes_enabled":true,"created_at":"2026-09-26T21:47:08Z","expires_at":"2026-09-28T21:47:08Z","confirmed_at":null,"submission_id":null,"result":null,"failure":null,"message":"Che …(593 chars)`

**32. Sumeet (signed in): `POST /drafts/7a60982a73e541939531e1d9341db1e3/confirm`**
- sent: `{"confirmToken":"dc8e86…"}`
- answer: **200** `{"draft_id":"7a60982a73e541939531e1d9341db1e3","status":"failed","function_id":"add_boq_lines","code":"BOQ_SEALED","missing":[],"message":"Confirmed, but the change could not be applied. Ask the AI to draft it again with the missing details."}`

- PASS: a sealed BOQ takes no more lines (failed BOQ_SEALED)

## Re-read from the database

- PASS: 53 stored lines
- PASS: the stored lines add up to AED 1,596,280
- PASS: no item code is stored twice
- PASS: the BOQ is attributed to Sumeet
- PASS: every BOQ audit row (5) names Sumeet
**33. AI: `GET /records/boq_lines?format=json&limit=50`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_13","rate":230,"unit":"m2","amount":80730,"boq_id":"construction_boqs_7","category":"Play Area / Partition and Lining","quantity":351,"item_code":"PLAY-B3-01","vendor_id":null,"created_at":"2026-09-26T21:47:07.968+00:00","activity_id":null,"description":"Ground Floor - Acoustic Wall full height (floor to roof) - Supply and installation of 125mm thick double layer regular 12.5mm thick gypsum board partition with 40kg/m3 rockwool Location: Café and Recep …(37681 chars)`

**34. AI: `GET /records/boq_lines?format=json&limit=50&after=construction_boq_line_items_67`**
- answer: **200** `{"kind":"boq_lines","items":[{"id":"construction_boq_line_items_73","rate":175000,"unit":"LS","amount":175000,"boq_id":"construction_boqs_7","category":"Play Area / Preliminaries and General Requirements","quantity":1,"item_code":"PLAY-B1A-LS","vendor_id":null,"created_at":"2026-09-26T21:47:08.202+00:00","activity_id":null,"description":"Preliminaries and General Requirements (lump sum from the bill total; the lines are not priced in the file)","labour_cost":null,"qty_contract":null,"rate_project":null,"material_co …(2272 chars)`

- PASS: records/boq_lines: the AI reads all 53 lines back through the link
- PASS: each of the 9 confirmed changes is a submission via ai_link by Sumeet on this link with model_calls 0
- PASS: each task is executor ai

## Cleanup: every throwaway link revoked, every demoted user restored

**35. Sumeet (signed in): `POST /links/737d2fd9ea8344edaed7c3f1aa62974b/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"737d2fd9ea8344edaed7c3f1aa62974b","revoked":true,"already":false}`

- PASS: link 737d2f… is revoked through the app route (200)
- PASS: no throwaway link is still active (re-read from the links table)
- PASS: every user's role is back to what it was at the start (re-read)

## Findings (real behaviour of the link that the run met; not failures)

- The reader (WP-01) writes a category as "<Area> - <Bill>" and the seal (WP-04) takes the area from the text before the first "/": an AI that sends the reader categories unchanged cannot seal with per-area control totals (every category is its own area). The persona AI rewrites the separator as the manual example shows; the two conventions should be one.

