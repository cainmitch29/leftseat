-- Post likes: tracks which users liked which posts
CREATE TABLE IF NOT EXISTS post_likes (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES pilot_posts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, post_id)
);

CREATE INDEX idx_post_likes_post_id ON post_likes(post_id);
CREATE INDEX idx_post_likes_user_id ON post_likes(user_id);

ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read likes" ON post_likes FOR SELECT USING (true);
CREATE POLICY "Users manage own likes" ON post_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own likes" ON post_likes FOR DELETE USING (auth.uid() = user_id);
