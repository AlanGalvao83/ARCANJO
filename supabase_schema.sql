-- ============================================================================
-- ARCANJO INTELLIGENCE — Schema PostgreSQL para Supabase
-- Você pode colar e executar este script no SQL Editor do Supabase,
-- ou simplesmente configurar DATABASE_URL na Vercel (o backend cria e popula
-- automaticamente todas as tabelas no primeiro acesso).
-- ============================================================================

CREATE TABLE IF NOT EXISTS areas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    zone_type TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT NOT NULL,
    coverage INTEGER NOT NULL DEFAULT 80,
    tone TEXT NOT NULL DEFAULT 'blue',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    area_id TEXT NOT NULL,
    area_name TEXT NOT NULL,
    qr_token TEXT NOT NULL UNIQUE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    radius_meters INTEGER NOT NULL DEFAULT 50,
    instructions TEXT NOT NULL,
    critical_items TEXT NOT NULL,
    order_num INTEGER NOT NULL DEFAULT 1,
    last_checked_at TEXT,
    last_checked_by TEXT,
    last_status TEXT DEFAULT 'PENDENTE'
);

CREATE TABLE IF NOT EXISTS patrol_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    shift_name TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    agent_role TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'Em andamento',
    total_checkpoints INTEGER NOT NULL DEFAULT 6,
    visited_checkpoints INTEGER NOT NULL DEFAULT 0,
    anomalies_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS checkpoint_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    checkpoint_code TEXT NOT NULL,
    checkpoint_name TEXT NOT NULL,
    area_name TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    scanned_at TEXT NOT NULL,
    verification_method TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    distance_meters DOUBLE PRECISION,
    status TEXT NOT NULL,
    notes TEXT DEFAULT '',
    occurrence_id TEXT
);

CREATE TABLE IF NOT EXISTS checklists (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    area TEXT NOT NULL,
    phase TEXT NOT NULL DEFAULT 'Abertura / Pré-Culto',
    responsible TEXT NOT NULL,
    critical INTEGER NOT NULL DEFAULT 0,
    complete INTEGER NOT NULL DEFAULT 0,
    completed_by TEXT,
    completed_at TEXT,
    shift_label TEXT DEFAULT 'Culto Noturno'
);

CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    area_name TEXT NOT NULL,
    custodian TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Protegido',
    condition_note TEXT NOT NULL,
    last_verified_at TEXT NOT NULL,
    last_verified_by TEXT NOT NULL,
    requires_lock INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS occurrences (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    area TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    time_label TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL,
    description TEXT NOT NULL,
    response TEXT NOT NULL,
    damage TEXT NOT NULL,
    external_action TEXT NOT NULL,
    lesson TEXT NOT NULL,
    reported_by TEXT DEFAULT 'Gestor de Segurança',
    checkpoint_id TEXT
);

CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    post_area TEXT NOT NULL,
    shift TEXT NOT NULL,
    status TEXT NOT NULL,
    phone_short TEXT NOT NULL,
    checkin_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    email TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    username TEXT DEFAULT '',
    password_hash TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS monthly_schedules (
    id TEXT PRIMARY KEY,
    date_iso TEXT NOT NULL,
    date_label TEXT NOT NULL,
    event_name TEXT NOT NULL,
    shift_time TEXT NOT NULL,
    post_name TEXT NOT NULL,
    member_id TEXT NOT NULL,
    member_name TEXT NOT NULL,
    member_role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Escalado',
    notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS trainings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date_label TEXT NOT NULL,
    participants TEXT NOT NULL,
    status TEXT NOT NULL
);
