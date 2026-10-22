-- Large native designs include embedded artwork and collaboration snapshots.
-- Production returned SQLSTATE 57014 while replacing that JSONB envelope under
-- the inherited 8-second API timeout. Bound trusted server writes at 30 seconds;
-- browser roles, permissions, RLS and stored artwork are unchanged.
alter role service_role set statement_timeout = '30s';

-- PostgREST reloads role settings without restarting the database.
notify pgrst, 'reload config';

-- Rollback, if required:
-- alter role service_role reset statement_timeout;
-- notify pgrst, 'reload config';
