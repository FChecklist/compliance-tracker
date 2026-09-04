-- R75 Phase 0 (Z0-02): revokes the temporary BYPASSRLS grant from migration
-- 0564, immediately after the one pg_dump run it was granted for completed
-- successfully (exit 0, 49,771,517 bytes). Restores app_runtime to its
-- correct, least-privilege posture. Verified live against pg_roles
-- .rolbypassrls in the same phase, not assumed.
ALTER ROLE app_runtime NOBYPASSRLS;
