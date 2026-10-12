-- 0014_engine.sql
--
-- Engine — server-side store for the automatic story finder.
--
-- Two tables, both reached ONLY through the service-role client
-- (lib/supabase/admin.ts) from owner-gated/cron routes, so RLS is on with
-- no public policies (service role bypasses RLS).
--
--   gf_stories   — stories the scheduled finder generates. The tool reads
--                  these (merged with the in-repo seed); manual Create
--                  stories still live in the browser's localStorage.
--   gf_schedule  — a single settings row (id = 1): the on/off kill switch,
--                  the interval, and when it last ran. The Vercel cron
--                  ticks on a fixed cadence and only generates when this
--                  says it's enabled AND due.

set search_path to public;

create table if not exists public.gf_stories (
  id          text primary key,
  data        jsonb       not null,
  status      text        not null default 'queue',
  source      text        not null default 'auto',
  created_at  timestamptz not null default now()
);

create index if not exists gf_stories_created_idx
  on public.gf_stories (created_at desc);

alter table public.gf_stories enable row level security;

create table if not exists public.gf_schedule (
  id               smallint primary key default 1 check (id = 1),
  enabled          boolean     not null default false,
  interval_minutes integer     not null default 1440,
  last_run_at      timestamptz,
  updated_at       timestamptz not null default now()
);

alter table public.gf_schedule enable row level security;

-- Seed the single settings row (off by default — never researches until the
-- curator toggles it on from the Profile page).
insert into public.gf_schedule (id, enabled, interval_minutes)
  values (1, false, 1440)
  on conflict (id) do nothing;
