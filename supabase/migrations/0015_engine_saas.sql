-- Engine as a product: partition the story store by owner.
-- 'owner' = the site owner (default, so every existing row stays theirs);
-- members get a stable hash of their subscription email
-- (lib/engine/member.ts memberOwnerKey).

alter table gf_stories
  add column if not exists owner text not null default 'owner';

create index if not exists gf_stories_owner_created_idx
  on gf_stories (owner, created_at desc);
