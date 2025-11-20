BEGIN;

-- =========================
-- Tabel: machines
-- =========================
CREATE TABLE IF NOT EXISTS machines (
  id                     VARCHAR(50) PRIMARY KEY,
  product_id             TEXT NOT NULL UNIQUE,
  type                   TEXT,
  last_reading_at        TIMESTAMPTZ,
  current_risk_level     TEXT CHECK (current_risk_level IN ('low','medium','high')),
  current_risk_score     DOUBLE PRECISION,
  predicted_failure_type TEXT
);
CREATE INDEX IF NOT EXISTS idx_machines_risk
  ON machines (current_risk_score DESC NULLS LAST);

-- =========================
-- Tabel: sensor_readings
-- =========================
CREATE TABLE IF NOT EXISTS sensor_readings (
  id                     VARCHAR(50) PRIMARY KEY,
  machine_id             VARCHAR(50) NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  ts                     TIMESTAMPTZ NOT NULL,
  air_temp_k             DOUBLE PRECISION,
  process_temp_k         DOUBLE PRECISION,
  rotational_speed_rpm   INTEGER,
  torque_nm              DOUBLE PRECISION,
  tool_wear_min          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_readings_machine_ts
  ON sensor_readings (machine_id, ts DESC);

-- =========================
-- Tabel: predictions
-- =========================
CREATE TABLE IF NOT EXISTS predictions (
  id                       VARCHAR(50) PRIMARY KEY,
  machine_id               VARCHAR(50) NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  ts                       TIMESTAMPTZ NOT NULL,
  risk_score               DOUBLE PRECISION,
  risk_level               TEXT CHECK (risk_level IN ('low','medium','high')),
  predicted_failure_type   TEXT,
  top_factors              JSONB
);
CREATE INDEX IF NOT EXISTS idx_preds_machine_ts
  ON predictions (machine_id, ts DESC);

-- =========================
-- Tabel: anomalies
-- =========================
CREATE TABLE IF NOT EXISTS anomalies (
  id                       VARCHAR(50) PRIMARY KEY,
  machine_id               VARCHAR(50) NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  detected_at              TIMESTAMPTZ NOT NULL,
  risk_score               DOUBLE PRECISION,
  risk_level               TEXT CHECK (risk_level IN ('low','medium','high')),
  predicted_failure_type   TEXT,
  reason                   TEXT
);
CREATE INDEX IF NOT EXISTS idx_anom_machine_ts
  ON anomalies (machine_id, detected_at DESC);

-- =========================
-- Tabel: tickets
-- =========================
CREATE TABLE IF NOT EXISTS tickets (
  id            VARCHAR(50) PRIMARY KEY,
  machine_id    VARCHAR(50) NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL CHECK (status IN ('open','in_progress','done')) DEFAULT 'open',
  priority      TEXT NOT NULL CHECK (priority IN ('low','medium','high')) DEFAULT 'medium',
  title         TEXT NOT NULL,
  description   TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_machine_ts
  ON tickets (machine_id, created_at DESC);

-- =========================
-- Tabel: recommendations
-- =========================
CREATE TABLE IF NOT EXISTS recommendations (
  id            VARCHAR(50) PRIMARY KEY,
  machine_id    VARCHAR(50) NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action_text   TEXT NOT NULL,
  reason        TEXT,
  horizon_days  INTEGER,
  source        TEXT NOT NULL CHECK (source IN ('agent','model','manual')),
);
CREATE INDEX IF NOT EXISTS idx_reco_machine_ts
  ON recommendations (machine_id, created_at DESC);

COMMIT;

-- Catatan:
-- - ID boleh berformat UUID/ULID string; panjang 50 aman.
-- - Pastikan aplikasi selalu mengisi kolom id secara unik.
-- - Index btree default cocok untuk VARCHAR(50).
