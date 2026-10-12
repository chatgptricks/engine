-- Instagram connections for Engine channels.
-- One row per (owner, channel): the long-lived Instagram token plus the
-- account identity, written by /api/instagram/callback after the user logs
-- in to Instagram and grants access. Server-side so a connection works from
-- any device (ManyChat-style), not just the browser that performed it.

create table if not exists gf_ig_credentials (
  owner text not null,
  channel_id text not null,
  ig_user_id text not null default '',
  username text not null default '',
  token text not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner, channel_id)
);

alter table gf_ig_credentials enable row level security;
-- Service-role access only (same posture as gf_stories): no public policies.
