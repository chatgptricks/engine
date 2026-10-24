-- Polling data->>'revision' repeatedly decompresses the full JSONB workspace,
-- including embedded artwork, even though its HTTP result is one UUID. Store
-- that UUID beside the JSONB so idle collaboration reads only a scalar column.
-- Generated values remain atomic with all existing writes and revision CAS.
-- Other gf_client_state namespaces without a revision receive NULL.
alter table public.gf_client_state
  add column if not exists state_revision text
  generated always as (data ->> 'revision') stored;

notify pgrst, 'reload schema';

-- Rollback, if required (the application falls back for older databases):
-- alter table public.gf_client_state drop column if exists state_revision;
-- notify pgrst, 'reload schema';
