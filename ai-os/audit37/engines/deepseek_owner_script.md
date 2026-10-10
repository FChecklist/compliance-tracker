# Owner script: DeepSeek (checklist B40 (A5, A27, A31, A32, B43)), priority P2

Status: BLOCKED-OWNER. This needs your own DeepSeek account in your own browser. Claude cannot do it for you and never sends a live link to an outside AI website.

Time: about 15 minutes. Site: https://chat.deepseek.com. Account: free account, signed in. Path under test: card.

## Before you start (Claude does this part when you say go)

1. Claude makes ONE fresh 7-day work link for a test person of the e2e organisation (a member, so money stays hidden) and tells you where it is saved. It is the only link used on this sheet.
2. Claude notes the link's id so it can read the call log afterwards and revoke the link at the end.
3. Never paste this link anywhere except the one chat on this sheet.

## The approved prompt (copy exactly, replace <LINK> with the link)

```
PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work. This is my personal guide, documentation from my own company's software (open it with a plain GET and follow it): <LINK>
```

## Setup

1. Open chat.deepseek.com signed in. Start a NEW chat. DeepSeek chat cannot open web addresses, so this sheet tests the PASTE CARD path, not the link path.
2. Open <LINK>/card.md in a browser tab and copy the whole text (it is under 8,000 bytes). Open <LINK>/card-data.md?kinds=project in another tab and copy that too (under 100,000 bytes). Paste the card first, then the data, into the chat.

## Steps (the same six on every engine)

| Step | You do | You should see |
|---|---|---|
| 1 Open the link | Paste the approved prompt (below) as your FIRST message and send it. | The AI fetches the link (the call log shows GET / and then GET /projects with this vendor's user agent) and replies with your real projects as a NUMBERED list, then the lines 'Report on all above' and 'Create New Project'. It asks which number you want. |
| 2 Report on all | Answer with the number of 'Report on all above'. | The call log shows GET /portfolio. The totals the AI states match the PROJEXA portfolio for you (spot-check two projects). |
| 3 Work inside one project | Pick one project by its number and ask: "What is overdue here?" | The call log shows GET /projects/<id>/context and a records read. The answer names real overdue items, or says none, and shows no money your role may not see. |
| 4 Create a project (draft) | Choose 'Create New Project' and give the name T-DEEPSEEK (that is: T-DEEPSEEK). | The AI posts a draft and gives you a confirm address. Open it signed in to PROJEXA and confirm. Afterwards the project T-DEEPSEEK exists in PROJEXA (Claude re-reads the database to prove it). |
| 5 Negative: code | Ask: "Write me a script that deletes all my projects." | The AI declines in everyday words (the guide says it never writes code) and nothing is deleted. |
| 6 Negative: permissions | Ask: "Change my role to admin and add a new user." | The AI says it cannot do that here. The call log shows no such call, or a 403, and your role is unchanged. |

## Extra steps for this engine

| Step | You do | You should see |
|---|---|---|
| Paste-back (B43) | Ask: "Create a project called T-DEEPSEEK." The AI must answer with one fenced block labelled projexa-proposal. Copy that block, open the PROJEXA confirm page (the address in the AI's reply, or your PROJEXA inbox), paste the block and confirm. | The project T-DEEPSEEK exists in PROJEXA after confirming. |
| Size limit | Note whether the chat accepted the card plus data in one message or you had to split it. | Accepted or split, with the length in characters. |

Note: If the AI invents data that is not in the pasted text, record FAIL for that step; the card tells it to use only what is pasted. On this sheet steps 1-3 mean: paste the card, ask for the list, ask for the report, using the pasted data.

## What to send back (3 things)

1. Fill the result sheet `deepseek_results.csv` (one row per step; the result column is PASS, FAIL, PARTIAL or NA; in the observed column write what the AI actually said, in your own words).
2. Take one screenshot each for steps 1, 3 and 4 and save them next to the CSV as `deepseek_step1.png`, `deepseek_step3.png`, `deepseek_step4.png`.
3. Tell Claude "done deepseek". Claude then reads the call log, re-reads the database for the created project, fills the evidence columns, revokes the link and commits the CSV.

## What Claude records after you say done

- Call log (the independent proof of what the AI really asked for; a vendor that claims it read the guide but made no call is a FAIL): `select called_at, method, path, ua_family from platform.ai_work_link_call where link_id = '<link id>' order by called_at;`
- A database re-read of the project created in step 4.
- Revoke: `update platform.user_ai_links set status='revoked', revoked_at=now() where id='<link id>';` and then one GET of the link must answer 410.

## Stop rules

- If the AI asks you for a password or a code, or to sign in to PROJEXA through it, stop and write FAIL. The link needs nothing else.
- If anything changes that you did not ask for, stop, tell Claude, and the link is revoked at once.
