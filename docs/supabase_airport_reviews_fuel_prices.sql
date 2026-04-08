-- Add fuel_prices JSONB column for per-fuel-type pricing
-- Run this in: app.supabase.com → SQL Editor → New query → Run

ALTER TABLE airport_reviews ADD COLUMN IF NOT EXISTS fuel_prices jsonb;
