REVOKE EXECUTE ON FUNCTION public.prune_maintenance_tables() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_maintenance_tables() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_maintenance_tables() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prune_maintenance_tables() TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_maintenance_tables() TO postgres;
