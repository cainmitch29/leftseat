-- Add fbo_name column to airport_reviews
-- Run this in: app.supabase.com → SQL Editor → New query → Run

ALTER TABLE airport_reviews ADD COLUMN IF NOT EXISTS fbo_name text;
