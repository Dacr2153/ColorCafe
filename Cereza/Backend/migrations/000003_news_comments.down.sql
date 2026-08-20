-- 000003_news_comments.down.sql
DROP INDEX IF EXISTS idx_news_comments_parent;
DROP INDEX IF EXISTS idx_news_comments_user;
DROP INDEX IF EXISTS idx_news_comments_news;
DROP TABLE IF EXISTS news_comments;
