-- Airport Reviews — pilot intel collected after "I've Flown Here"
-- Run this in: app.supabase.com → SQL Editor → New query → Run

create table if not exists airport_reviews (
  id           uuid        primary key default gen_random_uuid(),
  user_id      text        not null,
  airport_icao text        not null,
  visited_at   timestamptz not null default now(),
  courtesy_car text        check (courtesy_car in ('yes', 'no', 'unknown')),
  fuel_available boolean,
  fuel_price   numeric,
  fbo_rating   smallint    check (fbo_rating between 1 and 5),
  visit_reason text        check (visit_reason in ('food', 'golf', 'scenic', 'event', 'quick_stop', 'other')),
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists airport_reviews_user_idx
  on airport_reviews (user_id, created_at desc);

create index if not exists airport_reviews_airport_idx
  on airport_reviews (airport_icao, created_at desc);

alter table airport_reviews enable row level security;

create policy "Anyone can read reviews"
  on airport_reviews for select using (true);

create policy "Authenticated users can insert reviews"
  on airport_reviews for insert with check (true);

create policy "Users can update own reviews"
  on airport_reviews for update using (auth.uid()::text = user_id);

create policy "Users can delete own reviews"
  on airport_reviews for delete using (auth.uid()::text = user_id);
