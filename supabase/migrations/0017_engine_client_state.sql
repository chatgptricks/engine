-- Engine — durable client state (designs + created stories + channels).
--
-- The studio's per-story DESIGNS (slideStyles / selection / caption edits /
-- star / set-aside), the curator's manually-CREATED stories, channels, and the
-- deleted-ids overlay previously lived ONLY in the browser's localStorage, so a
-- Safari storage eviction (ITP), "clear data", or switching devices wiped them
-- with no recovery. This table mirrors that state server-side, owner-keyed, so
-- it survives the browser and restores on the next load.
--
-- One row per owner; `data` is the JSON snapshot the store writes through on
-- change. Accessed only via the service-role client.

create table if not exists gf_client_state (
  owner       text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.gf_client_state enable row level security;
