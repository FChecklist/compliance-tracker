-- R75 Phase 0 (Z0-03 retry): revokes the temporary BYPASSRLS grant from
-- migration 0567, immediately after the custom-format (-Fc) pg_dump run it
-- was granted for completed successfully (exit 0, 13,087,617 bytes).
-- Restores app_runtime to its correct, least-privilege posture. Verified
-- live against pg_roles.rolbypassrls in the same phase, not assumed.
ALTER ROLE app_runtime NOBYPASSRLS;
