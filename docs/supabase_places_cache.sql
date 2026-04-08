-- Run this in the Supabase SQL editor.
-- Each airport×category gets its own row. Unique key: (airport_icao, category).
-- If you ran a previous version of this file, drop the old table first:
--   drop table if exists airport_places_cache;

create table if not exists airport_places_cache (
  id           uuid primary key default gen_random_uuid(),
  airport_icao text not null,                          -- e.g. "KSUS", always uppercase
  category     text not null,                          -- 'restaurants' | 'hotels' | 'golf' | 'things'
  data         jsonb not null default '[]',            -- array of processed place objects
  fetched_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  unique (airport_icao, category)
);

-- Fast lookup by airport + category (the only query pattern used)
create index if not exists airport_places_cache_icao_cat_idx
  on airport_places_cache (airport_icao, category);

-- Row-level security
alter table airport_places_cache enable row level security;

create policy "App can read cache"
  on airport_places_cache for select
  using (true);

create policy "App can insert cache"
  on airport_places_cache for insert
  with check (true);

create policy "App can update cache"
  on airport_places_cache for update
  using (true);

-- Optional: daily cleanup of rows expired > 30 days ago (requires pg_cron)
-- select cron.schedule(
--   'clean-expired-places-cache',
--   '0 3 * * *',
--   $$ delete from airport_places_cache where expires_at < now() - interval '30 days'; $$
-- );
