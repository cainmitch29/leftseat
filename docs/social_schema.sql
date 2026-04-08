-- LeftSeat Social Layer — Phase 1
-- Run this in: app.supabase.com → SQL Editor → New query → Run
--
-- What this adds:
--   1. is_public column on pilot_profiles   (public/private toggle)
--   2. pilot_follows table                  (follow / unfollow relationships)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Profile visibility
--    Default: true (public) so existing pilots don't silently disappear.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE pilot_profiles
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Follow relationships
--    Each row = follower_id follows following_id.
--    Primary key on both columns prevents duplicate follows.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pilot_follows (
  follower_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id)
);

ALTER TABLE pilot_follows ENABLE ROW LEVEL SECURITY;

-- Anyone can read follow counts / check if following
CREATE POLICY "Follows are publicly readable"
  ON pilot_follows FOR SELECT USING (true);

-- You can only add rows where you are the follower
CREATE POLICY "Users can follow others"
  ON pilot_follows FOR INSERT WITH CHECK (auth.uid() = follower_id);

-- You can only remove rows where you are the follower
CREATE POLICY "Users can unfollow"
  ON pilot_follows FOR DELETE USING (auth.uid() = follower_id);
