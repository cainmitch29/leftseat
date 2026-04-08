-- ─── Events table — v3 migration ──────────────────────────────────────────────
--
-- Run once in Supabase SQL editor after supabase_events_v2.sql.
-- Adds coordinate and verification columns to support proper
-- event-venue → nearest-airport matching.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- Event venue coordinates (may differ from airport coordinates for in-town festivals)
alter table events add column if not exists event_lat  float;
alter table events add column if not exists event_lng  float;

-- Whether nearest_airport was confirmed via coordinate lookup or manual review.
-- Default true for existing records (user-submitted events assume the submitter
-- knows the correct airport).  Set false for auto-assigned imports.
alter table events add column if not exists airport_verified    boolean default true;

-- Straight-line distance from nearest_airport to the event venue in nm.
-- 0 = event is at the airport itself.
alter table events add column if not exists airport_distance_nm float;

-- ─── Index ─────────────────────────────────────────────────────────────────

create index if not exists events_airport_verified_idx on events (airport_verified);

-- ─── Helper view: unverified events for review ─────────────────────────────
--
-- SELECT * FROM events_needing_review ORDER BY start_date;
--
create or replace view events_needing_review as
  select
    id,
    event_name,
    city,
    state,
    start_date,
    nearest_airport,
    event_lat,
    event_lng,
    airport_distance_nm
  from events
  where airport_verified = false
    and start_date >= current_date
  order by start_date;
