-- ─── Events table ─────────────────────────────────────────────────────────────
--
-- Run once in Supabase SQL editor.
--
-- ─────────────────────────────────────────────────────────────────────────────

create table events (
  id              uuid primary key default gen_random_uuid(),
  event_name      text,
  city            text,
  state           text,
  start_date      date,
  end_date        date,
  nearest_airport text,       -- ICAO code of the closest airport
  distance_miles  int,        -- miles from nearest_airport to the event venue
  category        text,       -- 'Fly-In' | 'Airshow' | 'Pancake Breakfast' | etc.
  event_link      text,       -- official event website URL
  description     text,
  created_at      timestamp default now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

create index events_start_date_idx    on events (start_date);
create index events_nearest_airport_idx on events (nearest_airport);

-- ─── Row-level security ───────────────────────────────────────────────────────

alter table events enable row level security;

-- Anyone can read upcoming events
create policy "events_select" on events for select using (true);
