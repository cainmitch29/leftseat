-- Pilot posts: photo + caption social posts
CREATE TABLE IF NOT EXISTS pilot_posts (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url    text NOT NULL,
  caption      text,
  airport_icao text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX idx_pilot_posts_user_id ON pilot_posts(user_id);
CREATE INDEX idx_pilot_posts_created_at ON pilot_posts(created_at DESC);

ALTER TABLE pilot_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read posts" ON pilot_posts FOR SELECT USING (true);
CREATE POLICY "Users create own posts" ON pilot_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own posts" ON pilot_posts FOR DELETE USING (auth.uid() = user_id);
