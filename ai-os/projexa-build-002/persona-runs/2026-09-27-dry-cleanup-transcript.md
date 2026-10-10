# Persona run (cleanup), dry mode, 2026-09-27

Run by the Claude Code session acting as the EXTERNAL AI, over plain HTTP against the local execution host in dry mode.
The AI uses only the link address; the person's steps use a local session; the assertions re-read persisted rows. Tokens and confirm codes are cut to six characters.


## Make a mess on purpose: four throwaway links and two demoted people

**1. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"throwaway 1"}`
- answer: **201** `{"link_id":"47d35749fc89492a92858b908d9192d8","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2769 chars)`

**2. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"project_oakwood","level":0,"days":7,"label":"throwaway 2"}`
- answer: **201** `{"link_id":"874eef5e6a9140a6ba453a15675865aa","level":0,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2750 chars)`

**3. Maya (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"throwaway 3"}`
- answer: **201** `{"link_id":"37470b01f9de4114b011e746e37910a1","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","capture_artifact","close_rfi","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_plan","create_material","create_meeting","create_milestone","create_mom","create_mood_board"," …(2053 chars)`

**4. Vic (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":0,"days":7,"label":"throwaway 4"}`
- answer: **201** `{"link_id":"c4da32a53ead447189680d5b0177093c","level":0,"allowed_functions":["get_construction_project_dashboard"],"hide_personal":true,"label":"throwaway 4","expires_at":"2026-10-03T23:45:15Z","project":{"id":"projects_1","name":"12039 ZOOMIES, DIP, DUBAI, UAE."},"token":"pxa_3a…","links":{"link":"http://127.0.0.1:8980/functions/v1/ai-work-link/pxa_3a…","header_base":"http://127.0.0.1:8980/func …(778 chars)`

- PASS: four links were made
- PASS: two people are demoted (Sumeet to member, Maya to viewer)
- PASS: re-read: four links are active
**5. AI (throwaway 1): `GET /context?format=json`**
- answer: **200** `{"rate":{"limit_per_minute":120,"calls_last_minute":1},"level":1,"product":"projexa","project":{"id":"projects_1","name":"12039 ZOOMIES, DIP, DUBAI, UAE."},"counters":{"intents":0,"submissions":0},"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines …(24462 chars)`

- PASS: a throwaway link works before the cleanup
**6. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"throwaway 1, again"}`
- answer: **201** `{"link_id":"cb8f678c61e2412c8a64429196a447fe","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","capture_artifact","close_rfi","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_plan","create_material","create_meeting","create_milestone","create_mom","create_mood_board"," …(2060 chars)`

**7. AI (throwaway 1): `GET /context?format=json`**
- answer: **410** `{"error":"This link has expired or was revoked","hint":"Ask the person for a new link."}`

- PASS: a second link for the same person and project revokes the first (410 on its address)
**8. AI (throwaway 1, again): `GET /context?format=json`**
- answer: **200** `{"rate":{"limit_per_minute":120,"calls_last_minute":1},"level":1,"product":"projexa","project":{"id":"projects_1","name":"12039 ZOOMIES, DIP, DUBAI, UAE."},"counters":{"intents":0,"submissions":0},"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines …(24462 chars)`

- PASS: and the new one works

## Cleanup: every throwaway link revoked, every demoted user restored

**9. Sumeet (signed in): `POST /links/47d35749fc89492a92858b908d9192d8/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"47d35749fc89492a92858b908d9192d8","revoked":false,"already":true}`

- PASS: link 47d357… is revoked through the app route (200)
**10. Sumeet (signed in): `POST /links/874eef5e6a9140a6ba453a15675865aa/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"874eef5e6a9140a6ba453a15675865aa","revoked":true,"already":false}`

- PASS: link 874eef… is revoked through the app route (200)
**11. Maya (signed in): `POST /links/37470b01f9de4114b011e746e37910a1/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"37470b01f9de4114b011e746e37910a1","revoked":true,"already":false}`

- PASS: link 37470b… is revoked through the app route (200)
**12. Vic (signed in): `POST /links/c4da32a53ead447189680d5b0177093c/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"c4da32a53ead447189680d5b0177093c","revoked":true,"already":false}`

- PASS: link c4da32… is revoked through the app route (200)
**13. Sumeet (signed in): `POST /links/cb8f678c61e2412c8a64429196a447fe/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"cb8f678c61e2412c8a64429196a447fe","revoked":true,"already":false}`

- PASS: link cb8f67… is revoked through the app route (200)
- PASS: no throwaway link is still active (re-read from the links table)
- PASS: every user's role is back to what it was at the start (re-read)

## After the cleanup

**14. AI (after cleanup): `GET /context?format=json`**
- answer: **410** `{"error":"This link has expired or was revoked","hint":"Ask the person for a new link."}`

- PASS: a throwaway link answers 410 after the cleanup
**15. AI (after cleanup): `GET /context?format=json`**
- answer: **410** `{"error":"This link has expired or was revoked","hint":"Ask the person for a new link."}`

- PASS: a throwaway link answers 410 after the cleanup
**16. AI (after cleanup): `GET /context?format=json`**
- answer: **410** `{"error":"This link has expired or was revoked","hint":"Ask the person for a new link."}`

- PASS: a throwaway link answers 410 after the cleanup
**17. AI (after cleanup): `GET /context?format=json`**
- answer: **410** `{"error":"This link has expired or was revoked","hint":"Ask the person for a new link."}`

- PASS: a throwaway link answers 410 after the cleanup
**18. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"after cleanup"}`
- answer: **201** `{"link_id":"ce5ad24c37374e99b7adbb51620b0361","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2771 chars)`

**19. AI (fresh link): `GET /functions?format=json&per_page=100`**
- answer: **200** `{"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines":[{"itemCode":"PLAY-1.01","description":"Play structure","unit":"nos","quantity":10,"rate":65000,"category":"Play Area / Joinery"}]}},{"id":"add_meeting_action_item","label":"Add an action item", …(31346 chars)`

- PASS: a fresh link of Sumeet carries the manager's functions again (the demotion is undone)
**20. Sumeet (signed in): `POST /links/ce5ad24c37374e99b7adbb51620b0361/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"ce5ad24c37374e99b7adbb51620b0361","revoked":true,"already":false}`

- PASS: link ce5ad2… is revoked through the app route (200)
- PASS: re-read: no link is active at the very end
