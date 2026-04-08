-- Run this in the Supabase SQL editor.
-- Stores one row per flight logged by a user.
-- Multiple visits to the same airport are allowed (each tap of "I've Flown Here" = one row).
--
-- Column note: 'icao' stores the airport ICAO code, 'name' stores the airport name.
-- These match the field names used by the app's insert code exactly.

create table if not exists visited_airports (
  id           uuid        primary key default gen_random_uuid(),
  user_id      text        not null,             -- e.g. 'mitchell'
  icao         text        not null,             -- e.g. 'KSGF', always uppercase
  name         text,                             -- e.g. 'Springfield-Branson National'
  city         text,
  state        text,
  lat          numeric,
  lng          numeric,
  visited_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- Fast lookup by user, most recent first
create index if not exists visited_airports_user_idx
  on visited_airports (user_id, visited_at desc);

-- Row-level security (required when RLS is enabled)
alter table visited_airports enable row level security;

create policy "App can read visited airports"
  on visited_airports for select
  using (true);

create policy "App can insert visited airports"
  on visited_airports for insert
  with check (true);

create policy "App can delete visited airports"
  on visited_airports for delete
  using (true);
