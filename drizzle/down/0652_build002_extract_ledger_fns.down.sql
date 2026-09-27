-- Down of 0652: drop the three ledger functions. The projexa-document-extract Edge function then fails closed (a ledger that cannot be read refuses every call).
DROP FUNCTION IF EXISTS public.projexa_extract_ledger_settle(text, integer, integer, numeric, boolean, text);
DROP FUNCTION IF EXISTS public.projexa_extract_ledger_reserve(text, text, text, text, text, text, integer, integer, numeric);
DROP FUNCTION IF EXISTS public.projexa_extract_ledger_total(text);
