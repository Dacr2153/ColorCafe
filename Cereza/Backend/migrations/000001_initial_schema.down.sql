-- Rollback initial schema
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS email_verification_tokens CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS agronomic_tips CASCADE;
DROP TABLE IF EXISTS news_articles CASCADE;
DROP TABLE IF EXISTS order_messages CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS product_listings CASCADE;
DROP TABLE IF EXISTS email_queue CASCADE;
DROP TABLE IF EXISTS analysis_queue CASCADE;
DROP TABLE IF EXISTS grain_detections CASCADE;
DROP TABLE IF EXISTS image_analyses CASCADE;
DROP TABLE IF EXISTS harvests CASCADE;
DROP TABLE IF EXISTS farm_documents CASCADE;
DROP TABLE IF EXISTS farms CASCADE;
DROP TABLE IF EXISTS buyer_profiles CASCADE;
DROP TABLE IF EXISTS producer_profiles CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS order_status;
DROP TYPE IF EXISTS listing_status;
DROP TYPE IF EXISTS listing_process;
DROP TYPE IF EXISTS tip_category;
DROP TYPE IF EXISTS tip_difficulty;
DROP TYPE IF EXISTS analysis_status;
DROP TYPE IF EXISTS harvest_period;
DROP TYPE IF EXISTS farm_document_type;
DROP TYPE IF EXISTS user_role;

DROP FUNCTION IF EXISTS product_listings_tsv_update();
DROP FUNCTION IF EXISTS news_tsv_update();
