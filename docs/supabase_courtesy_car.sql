-- ─── Courtesy Car schema ───────────────────────────────────────────────────────
--
-- Run in Supabase SQL editor.
--
-- The existing `crew_cars` table already stores one row per report.
-- This migration:
--   1. Adds a `status` text column to `crew_cars` for the richer 4-value status
--      (Available / Call Ahead / Not Available / Unknown).
--   2. Backfills `status` from the legacy `available` boolean for existing rows.
--   3. Creates an index for fast per-airport lookups.
--
-- The app continues to write `available` (bool) alongside the new `status` field
-- so older app versions remain compatible.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add new columns (idempotent)
alter table crew_cars add column if not exists status        text;
alter table crew_cars add column if not exists reporter_name text;

-- 2. Backfill existing rows from legacy boolean
update crew_cars
set status = case
  when available = true  and notes = 'Rental car available' then 'Available'
  when available = true                                      then 'Available'
  when available = false                                     then 'Not Available'
  else 'Unknown'
end
where status is null;

-- 3. Index for fast per-airport queries ordered by recency
create index if not exists crew_cars_icao_reported_at_idx
  on crew_cars (icao, reported_at desc);

-- ─── How the app uses this table ─────────────────────────────────────────────
--
-- READ  (airport detail screen on load):
--   select * from crew_cars
--   where icao = 'KSUS'
--   order by reported_at desc
--   limit 3
--
--   The most-recent row is displayed as the current status.
--   The up-to-3 rows are shown in the "Recent Reports" section of the detail sheet.
--
-- WRITE (pilot submits a new report):
--   insert into crew_cars (icao, user_id, available, status, notes)
--   values ('KSUS', '<user_uuid>', true, 'Call Ahead', 'Call the FBO before assuming it is free.')
--
--   Status → available mapping used on insert:
--     'Available'     → available = true
--     'Call Ahead'    → available = true
--     'Not Available' → available = false
--     'Unknown'       → available = false
--
-- There is intentionally no separate summary table — the latest row IS the
-- current status. Fetching `limit 1` gives the authoritative current state.
--
-- ─────────────────────────────────────────────────────────────────────────────
