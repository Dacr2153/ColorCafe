-- 000003_news_comments.up.sql
-- Foro de discusión para noticias: comentarios con hilos (parent_id) y soft-delete.

CREATE TABLE IF NOT EXISTS news_comments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    news_id     UUID NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id   UUID REFERENCES news_comments(id) ON DELETE CASCADE,
    body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
    edited_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_comments_news      ON news_comments(news_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_comments_user      ON news_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_news_comments_parent    ON news_comments(parent_id) WHERE parent_id IS NOT NULL;
