-- Dog-Friendly Airports + pilot profile preference
-- Run this in: app.supabase.com → SQL Editor → New query → Run

-- ── 1. Dog-friendly airports table ──────────────────────────────────────────

create table if not exists dog_friendly_airports (
  id           uuid        primary key default gen_random_uuid(),
  airport_icao text        not null unique,
  dog_notes    text,
  dog_features text[]      default '{}',
  created_at   timestamptz not null default now()
);

create index if not exists dog_friendly_icao_idx
  on dog_friendly_airports (airport_icao);

alter table dog_friendly_airports enable row level security;

create policy "Anyone can read dog-friendly airports"
  on dog_friendly_airports for select using (true);

create policy "Authenticated users can insert dog-friendly airports"
  on dog_friendly_airports for insert with check (true);

-- ── 2. Seed data ────────────────────────────────────────────────────────────

insert into dog_friendly_airports (airport_icao, dog_notes, dog_features) values
  ('KOSH', 'AirVenture has a dedicated pet area with shade and water. Dogs welcome on the grounds.', '{"Grass Area","Water Station","Pet Relief Area","FBO Welcomes Dogs"}'),
  ('KSBA', 'Grassy areas along the general aviation ramp. FBO staff are very dog-friendly.', '{"Grass Area","FBO Welcomes Dogs","Shaded Walk"}'),
  ('KBZN', 'Wide open grassy fields around the GA parking area. Mountains in the background.', '{"Grass Area","Off-Leash Area","Shaded Walk"}'),
  ('KJAC', 'Beautiful grassy areas with mountain views. Plenty of room to roam.', '{"Grass Area","Off-Leash Area","Water Station"}'),
  ('KSEZ', 'Desert landscape with paved walkways. FBO keeps water out for pets.', '{"Water Station","FBO Welcomes Dogs","Pet Relief Area"}'),
  ('KFAT', 'GA side has a large grassy patch. Crew car available to hit nearby dog parks.', '{"Grass Area","Dog Waste Bags"}'),
  ('KMRY', 'Ocean breeze, grassy median near ramp. One of the best dog walks in GA.', '{"Grass Area","Shaded Walk","Water Station","FBO Welcomes Dogs"}'),
  ('KHHR', 'Small but clean grass area near the FBO. Water available inside.', '{"Grass Area","Water Station","FBO Welcomes Dogs"}')
on conflict (airport_icao) do nothing;

-- ── 3. Add flies_with_dogs to pilot profiles ────────────────────────────────

alter table pilot_profiles add column if not exists flies_with_dogs boolean not null default false;
