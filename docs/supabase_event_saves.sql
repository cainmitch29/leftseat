-- Event saves: tracks which users saved which events
-- Enables community save count on event cards
CREATE TABLE IF NOT EXISTS event_saves (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id   text NOT NULL,
  event_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, event_id)
);

-- Index for fast count queries
CREATE INDEX idx_event_saves_event_id ON event_saves(event_id);
CREATE INDEX idx_event_saves_user_id ON event_saves(user_id);

-- RLS
ALTER TABLE event_saves ENABLE ROW LEVEL SECURITY;

-- Anyone can read save counts
CREATE POLICY "Public read" ON event_saves FOR SELECT USING (true);

-- Users can insert/delete their own saves
CREATE POLICY "Users manage own saves" ON event_saves
  FOR ALL USING (auth.uid() = user_id);
