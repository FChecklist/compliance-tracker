# Persona run (cleanup), dry mode, 2026-09-27

Run by the Claude Code session acting as the EXTERNAL AI, over plain HTTP against the local execution host in dry mode.
The AI uses only the link address; the person's steps use a local session; the assertions re-read persisted rows. Tokens and confirm codes are cut to six characters.


## Make a mess on purpose: four throwaway links and two demoted people

**1. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"throwaway 1"}`
- answer: **201** `{"link_id":"bfb62dba2f1944e28a12be107cb59a99","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2769 chars)`

**2. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"project_oakwood","level":0,"days":7,"label":"throwaway 2"}`
- answer: **201** `{"link_id":"36c5d2383ac849bfa5c4dd546a5f99fb","level":0,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2750 chars)`

**3. Maya (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"throwaway 3"}`
- answer: **201** `{"link_id":"c182ec3537ff4f00982642aafa4936ca","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","capture_artifact","close_rfi","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_plan","create_material","create_meeting","create_milestone","create_mom","create_mood_board"," …(2053 chars)`

**4. Vic (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":0,"days":7,"label":"throwaway 4"}`
- answer: **201** `{"link_id":"b7b7d963558047978b831903d6baa22f","level":0,"allowed_functions":["get_construction_project_dashboard"],"hide_personal":true,"label":"throwaway 4","expires_at":"2026-10-03T21:47:00Z","project":{"id":"projects_1","name":"12039 ZOOMIES, DIP, DUBAI, UAE."},"token":"pxa_9a…","links":{"link":"http://127.0.0.1:8965/functions/v1/ai-work-link/pxa_9a…","header_base":"http://127.0.0.1:8965/func …(778 chars)`

- PASS: four links were made
- PASS: two people are demoted (Sumeet to member, Maya to viewer)
- PASS: re-read: four links are active
**5. AI (throwaway 1): `GET /context?format=json`**
- answer: **200** `{"rate":{"limit_per_minute":120,"calls_last_minute":1},"level":1,"product":"projexa","project":{"id":"projects_1","name":"12039 ZOOMIES, DIP, DUBAI, UAE."},"counters":{"intents":0,"submissions":0},"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines …(24462 chars)`

- PASS: a throwaway link works before the cleanup
**6. Sumeet (signed in): `POST /mint`**
- sent: `{"projectId":"projects_1","level":1,"days":7,"label":"throwaway 1, again"}`
- answer: **201** `{"link_id":"cccbef2ced1a4cc5a978efce0a9b464d","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","capture_artifact","close_rfi","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_plan","create_material","create_meeting","create_milestone","create_mom","create_mood_board"," …(2060 chars)`

**7. AI (throwaway 1): `GET /context?format=json`**
- answer: **410** `{"error":"This link has expired or was revoked","hint":"Ask the person for a new link."}`

- PASS: a second link for the same person and project revokes the first (410 on its address)
**8. AI (throwaway 1, again): `GET /context?format=json`**
- answer: **200** `{"rate":{"limit_per_minute":120,"calls_last_minute":1},"level":1,"product":"projexa","project":{"id":"projects_1","name":"12039 ZOOMIES, DIP, DUBAI, UAE."},"counters":{"intents":0,"submissions":0},"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines …(24462 chars)`

- PASS: and the new one works

## Cleanup: every throwaway link revoked, every demoted user restored

**9. Sumeet (signed in): `POST /links/bfb62dba2f1944e28a12be107cb59a99/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"bfb62dba2f1944e28a12be107cb59a99","revoked":false,"already":true}`

- PASS: link bfb62d… is revoked through the app route (200)
**10. Sumeet (signed in): `POST /links/36c5d2383ac849bfa5c4dd546a5f99fb/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"36c5d2383ac849bfa5c4dd546a5f99fb","revoked":true,"already":false}`

- PASS: link 36c5d2… is revoked through the app route (200)
**11. Maya (signed in): `POST /links/c182ec3537ff4f00982642aafa4936ca/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"c182ec3537ff4f00982642aafa4936ca","revoked":true,"already":false}`

- PASS: link c182ec… is revoked through the app route (200)
**12. Vic (signed in): `POST /links/b7b7d963558047978b831903d6baa22f/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"b7b7d963558047978b831903d6baa22f","revoked":true,"already":false}`

- PASS: link b7b7d9… is revoked through the app route (200)
**13. Sumeet (signed in): `POST /links/cccbef2ced1a4cc5a978efce0a9b464d/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"cccbef2ced1a4cc5a978efce0a9b464d","revoked":true,"already":false}`

- PASS: link cccbef… is revoked through the app route (200)
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
- answer: **201** `{"link_id":"867b8a7a1f234190942bec8e428f16c8","level":1,"allowed_functions":["add_boq_lines","add_meeting_action_item","add_meeting_outcome","add_mood_board_item","add_room","add_roster_entry","answer_rfi","apply_boq_import","approve_kpi_entry","approve_timesheet","capture_artifact","capture_schedule_baseline","close_rfi","compare_boq_revisions","compare_schedule_baseline","create_activity","create_boq","create_boq_revision","create_change_order","create_document","create_drawing","create_ffe_item","create_floor_pl …(2771 chars)`

**19. AI (fresh link): `GET /functions?format=json&per_page=100`**
- answer: **200** `{"functions":[{"id":"add_boq_lines","label":"Add BOQ lines","module":"scope","kind":"write","level":2,"available":true,"drafts_open":true,"direct_open":false,"reads_open":false,"money_sensitive":true,"min_role_rank":2,"required":["boqId","batchNo","lines"],"example_params":{"boqId":"<id from create_boq>","batchNo":1,"lines":[{"itemCode":"PLAY-1.01","description":"Play structure","unit":"nos","quantity":10,"rate":65000,"category":"Play Area / Joinery"}]}},{"id":"add_meeting_action_item","label":"Add an action item", …(31346 chars)`

- PASS: a fresh link of Sumeet carries the manager's functions again (the demotion is undone)
**20. Sumeet (signed in): `POST /links/867b8a7a1f234190942bec8e428f16c8/revoke`**
- sent: `{}`
- answer: **200** `{"link_id":"867b8a7a1f234190942bec8e428f16c8","revoked":true,"already":false}`

- PASS: link 867b8a… is revoked through the app route (200)
- PASS: re-read: no link is active at the very end
