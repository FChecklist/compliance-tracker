-- PRE-APPROVED-LIVE-DDL: Owner delegated full PM authority and ordered the 100-point audit gaps closed, in chat on 2026-10-05; adds the read-only service_role-only SECURITY DEFINER function public.ai_work_link_person_card (AUDIT-100 item 4) and its roll-back
-- down: drop the person card read
DROP FUNCTION IF EXISTS public.ai_work_link_person_card(text);
