-- Airport Reviews V2 — new structured intel fields
-- Run this in: app.supabase.com → SQL Editor → New query → Run

ALTER TABLE airport_reviews ADD COLUMN IF NOT EXISTS fee_status text;
ALTER TABLE airport_reviews ADD COLUMN IF NOT EXISTS fee_amount_text text;
ALTER TABLE airport_reviews ADD COLUMN IF NOT EXISTS after_hours_access text;
ALTER TABLE airport_reviews ADD COLUMN IF NOT EXISTS transport_options text[];
ALTER TABLE airport_reviews ADD COLUMN IF NOT EXISTS overnight_friendly text;
ALTER TABLE airport_reviews ADD COLUMN IF NOT EXISTS food_access text;
ALTER TABLE airport_reviews ADD COLUMN IF NOT EXISTS fuel_service_type text;
