-- Wave: persistent VERI Chat composer. Registered as a product branch
-- (not a bespoke boolean column) per the Wave 106 Master AI OS convention --
-- every current/future vertical enables/disables itself through
-- product-branch-service.ts's generic functions, never a one-off column
-- (see schema.ts's comment on orgProductBranchEnablements explaining why
-- organisations.pageAgentEnabled, a bespoke boolean, is regretted). Disabled
-- by default for every org; each org opts in individually via
-- enableVeriChatV2ForOrg(), same as PMS.
INSERT INTO compliance.product_branches (branch_key, display_name, domain, description, status) VALUES
  ('veri_chat_v2', 'VERI Chat (persistent composer)', 'platform_ui', 'Persistent, page-independent AI composer with a cascading task-chain selector, plus an independent VERI Chat panel (Overview/Tasks/Chats/To Do). Replaces the floating GlobalChatDock and the Home page''s bespoke composer for orgs that opt in.', 'building')
ON CONFLICT (branch_key) DO NOTHING;
