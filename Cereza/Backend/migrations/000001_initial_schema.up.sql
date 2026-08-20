-- =============================================================================
-- CaféVision — Migration 000001: Initial schema
-- PostgreSQL 15 + TimescaleDB extension
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "timescaledb";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- fuzzy search
CREATE EXTENSION IF NOT EXISTS "btree_gin"; -- GIN sobre tipos básicos
CREATE EXTENSION IF NOT EXISTS "unaccent";  -- búsqueda sin acentos

-- =============================================================================
-- USUARIOS Y ROLES
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'producer', 'buyer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT UNIQUE,
    email_lower     TEXT GENERATED ALWAYS AS (lower(email::text)) STORED,
    password_hash   TEXT NOT NULL,
    role            user_role NOT NULL DEFAULT 'producer',
    verified        BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    device_fingerprint TEXT,
    failed_login_attempts SMALLINT NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login      TIMESTAMPTZ
);

-- Email se compara case-insensitive: usamos citext si está disponible,
-- si no, una tabla previa lo manejaría. Aseguramos CITEXT:
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE INDEX IF NOT EXISTS idx_users_role          ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_at    ON users(created_at);

-- =============================================================================
-- PERFILES POR ROL
-- =============================================================================

CREATE TABLE IF NOT EXISTS producer_profiles (
    user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    nombre            TEXT NOT NULL,
    telefono          TEXT,
    departamento      TEXT,
    municipio         TEXT,
    vereda            TEXT,
    lat               DECIMAL(10, 8),
    lng               DECIMAL(11, 8),
    altitud_msnm      INTEGER CHECK (altitud_msnm BETWEEN 0 AND 5000),
    area_hectareas    DECIMAL(8, 2) CHECK (area_hectareas >= 0),
    variedad_cafe     TEXT[],
    programa_cafetero TEXT,
    certificaciones   TEXT[],
    anos_experiencia  INTEGER CHECK (anos_experiencia >= 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_producer_departamento ON producer_profiles(departamento);
CREATE INDEX IF NOT EXISTS idx_producer_variedad     ON producer_profiles USING GIN (variedad_cafe);

CREATE TABLE IF NOT EXISTS buyer_profiles (
    user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    nombre_empresa    TEXT NOT NULL,
    nit               TEXT UNIQUE,
    tipo_comprador    TEXT,   -- 'cooperativa', 'exportadora', 'tostador', 'consumidor_final'
    capacidad_compra_mensual_kg DECIMAL(12, 2) CHECK (capacidad_compra_mensual_kg >= 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- FINCAS Y PRODUCCIÓN
-- =============================================================================

CREATE TABLE IF NOT EXISTS farms (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producer_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nombre_finca             TEXT NOT NULL,
    geometria_poligono       JSONB,            -- GeoJSON
    tipo_suelo               TEXT,
    ph_suelo                 DECIMAL(4, 2) CHECK (ph_suelo BETWEEN 3 AND 10),
    altitud_msnm             INTEGER CHECK (altitud_msnm BETWEEN 0 AND 5000),
    microclima               TEXT,
    fecha_ultimo_analisis_suelo DATE,
    is_active                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_farms_producer ON farms(producer_id);

DO $$ BEGIN
    CREATE TYPE farm_document_type AS ENUM ('analisis_suelo', 'diagnostico_planta', 'certificacion', 'otro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS farm_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id         UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    tipo            farm_document_type NOT NULL,
    nombre_archivo  TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    contenido_hash  TEXT NOT NULL,             -- SHA256 hex
    tamano_bytes    BIGINT NOT NULL CHECK (tamano_bytes > 0),
    storage_ref     TEXT NOT NULL,             -- ref a MinIO
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (farm_id, contenido_hash)
);

CREATE INDEX IF NOT EXISTS idx_farm_documents_farm ON farm_documents(farm_id);

DO $$ BEGIN
    CREATE TYPE harvest_period AS ENUM ('primera', 'mitaca', 'traviesa');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS harvests (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id              UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    fecha_inicio         DATE NOT NULL,
    fecha_fin            DATE,
    periodo              harvest_period,
    cereza_kg            DECIMAL(12, 2) CHECK (cereza_kg >= 0),
    pergamino_seco_kg    DECIMAL(12, 2) CHECK (pergamino_seco_kg >= 0),
    precio_bulto_cop     DECIMAL(14, 2) CHECK (precio_bulto_cop >= 0),
    observaciones        TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);

CREATE INDEX IF NOT EXISTS idx_harvests_farm_fecha ON harvests(farm_id, fecha_inicio DESC);

-- =============================================================================
-- ANÁLISIS DE IMÁGENES — Hypertable TimescaleDB
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE analysis_status AS ENUM ('queued', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS image_analyses (
    id                      UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL,
    farm_id                 UUID,
    captured_at             TIMESTAMPTZ NOT NULL,
    image_hash              TEXT NOT NULL,                      -- SHA256
    image_storage_ref       TEXT NOT NULL,
    thumbnail_storage_ref   TEXT,
    image_width             SMALLINT,
    image_height            SMALLINT,
    file_size_bytes         INTEGER,
    capture_conditions      JSONB,    -- {luz, distancia_cm, angulo, temperatura, humedad}
    grain_type              TEXT NOT NULL DEFAULT 'pergamino',  -- cereza|pergamino|trilla
    sample_weight_g         DECIMAL(8, 2),
    processing_status       analysis_status NOT NULL DEFAULT 'queued',
    processing_time_ms      INTEGER,
    algorithm_version       TEXT,
    total_grains_detected   SMALLINT,
    quality_distribution    JSONB,                              -- {"supremo":45,"excelso":30,...}
    defect_distribution     JSONB,
    overall_score           DECIMAL(5, 2) CHECK (overall_score IS NULL OR (overall_score BETWEEN 0 AND 100)),
    moisture_estimated      DECIMAL(4, 2),
    color_profile           JSONB,
    ai_interpretation       TEXT,
    ai_recommendations      JSONB,
    confidence_score        DECIMAL(4, 3) CHECK (confidence_score IS NULL OR (confidence_score BETWEEN 0 AND 1)),
    error_message           TEXT,
    deleted_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, captured_at)
);

-- Convertir en hypertable TimescaleDB (partición por captured_at cada 7 días)
SELECT create_hypertable(
    'image_analyses',
    'captured_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_analyses_user_time   ON image_analyses(user_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_farm_time   ON image_analyses(farm_id, captured_at DESC) WHERE farm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analyses_status      ON image_analyses(processing_status) WHERE processing_status IN ('queued','processing');
CREATE INDEX IF NOT EXISTS idx_analyses_score       ON image_analyses(overall_score) WHERE overall_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analyses_hash        ON image_analyses(image_hash);
CREATE INDEX IF NOT EXISTS idx_analyses_quality_gin ON image_analyses USING GIN (quality_distribution);
CREATE INDEX IF NOT EXISTS idx_analyses_defects_gin ON image_analyses USING GIN (defect_distribution);

-- Compresión y retención (TimescaleDB)
ALTER TABLE image_analyses SET (
    timescaledb.compress,
    timescaledb.compress_orderby = 'captured_at DESC',
    timescaledb.compress_segmentby = 'user_id'
);

-- Habilitar política de compresión solo si TimescaleDB lo soporta (>= 2.x)
DO $$
BEGIN
    PERFORM add_compression_policy('image_analyses', INTERVAL '14 days', if_not_exists => TRUE);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'compression policy skipped: %', SQLERRM;
END $$;

-- =============================================================================
-- DETECCIONES DE GRANOS INDIVIDUALES (alta cardinalidad)
-- =============================================================================

CREATE TABLE IF NOT EXISTS grain_detections (
    id              BIGSERIAL PRIMARY KEY,
    analysis_id     UUID NOT NULL,
    captured_at     TIMESTAMPTZ NOT NULL,   -- denormalizado para join eficiente
    grain_index     SMALLINT NOT NULL,
    bbox_x          SMALLINT NOT NULL,
    bbox_y          SMALLINT NOT NULL,
    bbox_w          SMALLINT NOT NULL,
    bbox_h          SMALLINT NOT NULL,
    classification  TEXT NOT NULL,           -- supremo|excelso|pasilla|caracol|...
    defects         TEXT[],
    confidence      DECIMAL(4, 3) CHECK (confidence BETWEEN 0 AND 1),
    color_lab       JSONB                    -- {L, a, b}
);

CREATE INDEX IF NOT EXISTS idx_grain_detections_analysis ON grain_detections(analysis_id);

-- =============================================================================
-- COLA DE TRABAJOS (DB-backed — FinalStore pattern)
-- =============================================================================

CREATE TABLE IF NOT EXISTS analysis_queue (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id         UUID NOT NULL,
    captured_at         TIMESTAMPTZ NOT NULL,
    user_id             UUID NOT NULL,
    farm_id             UUID,
    storage_ref         TEXT NOT NULL,
    metadata            JSONB NOT NULL DEFAULT '{}',
    status              analysis_status NOT NULL DEFAULT 'queued',
    attempts            SMALLINT NOT NULL DEFAULT 0,
    max_attempts        SMALLINT NOT NULL DEFAULT 3,
    error_message       TEXT,
    next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_queue_pending
    ON analysis_queue(next_attempt_at)
    WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS email_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_email        TEXT NOT NULL,
    template        TEXT NOT NULL,             -- 'welcome'|'verify_email'|'reset_password'|...
    data            JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
    attempts        SMALLINT NOT NULL DEFAULT 0,
    max_attempts    SMALLINT NOT NULL DEFAULT 5,
    error_message   TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_queue_pending
    ON email_queue(next_attempt_at)
    WHERE status = 'queued';

-- =============================================================================
-- MARKETPLACE
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE listing_process AS ENUM ('lavado', 'natural', 'honey', 'anaerobic');
    CREATE TYPE listing_status  AS ENUM ('pending_review', 'active', 'paused', 'sold', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS product_listings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producer_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farm_id             UUID REFERENCES farms(id) ON DELETE SET NULL,
    titulo              TEXT NOT NULL CHECK (length(titulo) BETWEEN 5 AND 200),
    descripcion         TEXT,
    variedad            TEXT NOT NULL,
    proceso             listing_process NOT NULL,
    puntuacion_taza     DECIMAL(4, 2) CHECK (puntuacion_taza IS NULL OR puntuacion_taza BETWEEN 0 AND 100),
    cantidad_kg         DECIMAL(10, 2) NOT NULL CHECK (cantidad_kg > 0),
    precio_kg_cop       DECIMAL(12, 2) NOT NULL CHECK (precio_kg_cop > 0),
    analysis_id         UUID,                  -- análisis que respalda calidad
    analysis_captured_at TIMESTAMPTZ,          -- denormalizado para join con hypertable
    quality_score       DECIMAL(5, 2),         -- copiado del análisis al aprobar (read-only)
    status              listing_status NOT NULL DEFAULT 'pending_review',
    rejection_reason    TEXT,
    fecha_cosecha       DATE,
    disponible_desde    DATE,
    disponible_hasta    DATE,
    fotos               TEXT[],
    search_tsv          tsvector,
    views_count         INTEGER NOT NULL DEFAULT 0,
    contacts_count      INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listings_status      ON product_listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_producer    ON product_listings(producer_id);
CREATE INDEX IF NOT EXISTS idx_listings_variedad    ON product_listings(variedad);
CREATE INDEX IF NOT EXISTS idx_listings_search_gin  ON product_listings USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_listings_trgm_titulo ON product_listings USING GIN (titulo gin_trgm_ops);

-- Trigger para mantener search_tsv actualizado
CREATE OR REPLACE FUNCTION product_listings_tsv_update() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv :=
        setweight(to_tsvector('spanish', unaccent(coalesce(NEW.titulo,''))), 'A') ||
        setweight(to_tsvector('spanish', unaccent(coalesce(NEW.variedad,''))), 'B') ||
        setweight(to_tsvector('spanish', unaccent(coalesce(NEW.descripcion,''))), 'C');
    NEW.updated_at := NOW();
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listings_tsv ON product_listings;
CREATE TRIGGER trg_listings_tsv
    BEFORE INSERT OR UPDATE OF titulo, variedad, descripcion ON product_listings
    FOR EACH ROW EXECUTE FUNCTION product_listings_tsv_update();

DO $$ BEGIN
    CREATE TYPE order_status AS ENUM ('pending', 'accepted', 'rejected', 'in_transit', 'delivered', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    listing_id      UUID NOT NULL REFERENCES product_listings(id) ON DELETE RESTRICT,
    cantidad_kg     DECIMAL(10, 2) NOT NULL CHECK (cantidad_kg > 0),
    precio_total    DECIMAL(14, 2) NOT NULL CHECK (precio_total > 0),
    status          order_status NOT NULL DEFAULT 'pending',
    notas_negociacion TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer   ON orders(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_listing ON orders(listing_id);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);

CREATE TABLE IF NOT EXISTS order_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    mensaje     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_messages_order ON order_messages(order_id, created_at);

-- =============================================================================
-- NOTICIAS Y CONSEJOS AGRONÓMICOS
-- =============================================================================

CREATE TABLE IF NOT EXISTS news_articles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo          TEXT NOT NULL,
    resumen         TEXT,
    contenido_html  TEXT,
    fuente          TEXT NOT NULL,
    url_original    TEXT UNIQUE,
    imagen_portada  TEXT,
    categorias      TEXT[],
    tags            TEXT[],
    publicado_at    TIMESTAMPTZ,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    is_published    BOOLEAN NOT NULL DEFAULT FALSE,
    views           INTEGER NOT NULL DEFAULT 0,
    search_tsv      tsvector,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_published   ON news_articles(publicado_at DESC) WHERE is_published = TRUE;
CREATE INDEX IF NOT EXISTS idx_news_search_gin  ON news_articles USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_news_categorias  ON news_articles USING GIN (categorias);

CREATE OR REPLACE FUNCTION news_tsv_update() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv :=
        setweight(to_tsvector('spanish', unaccent(coalesce(NEW.titulo,''))), 'A') ||
        setweight(to_tsvector('spanish', unaccent(coalesce(NEW.resumen,''))), 'B');
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_news_tsv ON news_articles;
CREATE TRIGGER trg_news_tsv
    BEFORE INSERT OR UPDATE OF titulo, resumen ON news_articles
    FOR EACH ROW EXECUTE FUNCTION news_tsv_update();

DO $$ BEGIN
    CREATE TYPE tip_difficulty AS ENUM ('basico', 'intermedio', 'avanzado');
    CREATE TYPE tip_category   AS ENUM ('fertilizacion', 'plagas', 'cosecha', 'beneficio', 'calidad', 'clima', 'comercializacion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS agronomic_tips (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo              TEXT NOT NULL,
    contenido           TEXT NOT NULL,
    nivel_dificultad    tip_difficulty NOT NULL DEFAULT 'basico',
    categoria           tip_category NOT NULL,
    fuente_cientifica   TEXT NOT NULL,         -- DOI, URL paper, FNC, Cenicafé, CIAT
    aplicable_variedades TEXT[],
    aplicable_altitudes_min INTEGER,
    aplicable_altitudes_max INTEGER,
    validado_por        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tips_categoria  ON agronomic_tips(categoria);
CREATE INDEX IF NOT EXISTS idx_tips_variedades ON agronomic_tips USING GIN (aplicable_variedades);

-- =============================================================================
-- SESIONES Y AUDITORÍA
-- =============================================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT UNIQUE NOT NULL,    -- SHA256 hex del token raw
    parent_token_hash TEXT,                  -- para rotation chain (theft detection)
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at      TIMESTAMPTZ,
    revoked_reason  TEXT,
    device_info     JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active ON refresh_tokens(user_id, expires_at)
    WHERE revoked = FALSE;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_user ON password_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,                -- 'login', 'login_failed', 'analysis_submit', ...
    entity_type TEXT,
    entity_id   TEXT,
    ip_address  INET,
    user_agent  TEXT,
    success     BOOLEAN NOT NULL DEFAULT TRUE,
    diff        JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_log(action, created_at DESC);
