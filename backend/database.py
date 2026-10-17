import hashlib
import os
import re
import secrets
import sqlite3
from datetime import datetime
from pathlib import Path

# Detect Supabase / PostgreSQL connection URL from environment variables
DATABASE_URL = (
    os.environ.get("DATABASE_URL")
    or os.environ.get("SUPABASE_DB_URL")
    or os.environ.get("POSTGRES_URL")
    or ""
).strip()

IS_POSTGRES = DATABASE_URL.startswith(("postgres://", "postgresql://"))

# On Vercel Serverless (without DATABASE_URL), project root is read-only; use /tmp/arcanjo.db
if os.environ.get("VERCEL") and not IS_POSTGRES:
    DB_PATH = Path("/tmp/arcanjo.db")
else:
    DB_PATH = Path(__file__).resolve().parent.parent / "arcanjo.db"

_DB_INITIALIZED = False


def hash_password(password: str, salt: str | None = None) -> str:
    if not salt:
        salt = secrets.token_hex(8)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"{salt}${dk.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash or "$" not in stored_hash:
        return False
    salt, _ = stored_hash.split("$", 1)
    return secrets.compare_digest(hash_password(password, salt), stored_hash)


def slugify_username(name: str) -> str:
    import unicodedata
    norm = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode("ascii").lower()
    parts = [p for p in norm.replace(".", " ").split() if p not in ("presb", "pr", "pastor", "dr", "dra")]
    if not parts:
        return "usuario"
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]}.{parts[-1]}"


class PostgresCompatCursor:
    """Wraps a psycopg2 RealDictCursor so SQLite-style '?' queries work transparently on Supabase PostgreSQL."""

    def __init__(self, raw_cursor):
        self._cur = raw_cursor

    @staticmethod
    def _translate_sql(sql: str) -> str:
        # Convert SQLite '?' placeholders to PostgreSQL '%s'
        out = sql.replace("?", "%s")
        # Convert SQLite scalar MAX/MIN(a, b) to PostgreSQL GREATEST/LEAST(a, b)
        out = re.sub(r"\bMAX\s*\(([^,]+),([^)]+)\)", r"GREATEST(\1,\2)", out)
        out = re.sub(r"\bMIN\s*\(([^,]+),([^)]+)\)", r"LEAST(\1,\2)", out)
        # Convert SQLite 'rowid' to PostgreSQL 'ctid'
        out = re.sub(r"\browid\b", "ctid", out)
        return out

    def execute(self, sql: str, params=None):
        pg_sql = self._translate_sql(sql)
        if params is None:
            return self._cur.execute(pg_sql)
        return self._cur.execute(pg_sql, params)

    def executemany(self, sql: str, seq_of_params):
        pg_sql = self._translate_sql(sql)
        return self._cur.executemany(pg_sql, seq_of_params)

    def executescript(self, script: str):
        statements = [s.strip() for s in script.split(";") if s.strip()]
        for stmt in statements:
            self._cur.execute(stmt)

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()


class PostgresCompatConnection:
    """Wraps a psycopg2 connection to match sqlite3.Connection interface."""

    def __init__(self, raw_conn, cursor_factory):
        self._conn = raw_conn
        self._cursor_factory = cursor_factory

    def cursor(self):
        return PostgresCompatCursor(self._conn.cursor(cursor_factory=self._cursor_factory))

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()


def _open_raw_conn():
    if IS_POSTGRES:
        import psycopg2
        import psycopg2.extras

        dsn = DATABASE_URL
        if dsn.startswith("postgres://"):
            dsn = "postgresql://" + dsn[len("postgres://"):]
        raw_conn = psycopg2.connect(dsn)
        return PostgresCompatConnection(raw_conn, psycopg2.extras.RealDictCursor)

    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def get_conn():
    global _DB_INITIALIZED
    if not _DB_INITIALIZED:
        init_db()
    return _open_raw_conn()


def rows_to_dicts(rows):
    return [dict(r) for r in rows]


def now_br() -> str:
    return datetime.now().strftime("%d/%m/%Y %H:%M")


SCHEMA_SQL = """
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
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
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
    latitude REAL,
    longitude REAL,
    distance_meters REAL,
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
"""


def init_db():
    global _DB_INITIALIZED
    _DB_INITIALIZED = True
    conn = _open_raw_conn()
    cur = conn.cursor()

    cur.executescript(SCHEMA_SQL)

    # Safe schema migrations if upgrading existing SQLite or Postgres table
    if not IS_POSTGRES:
        cur.execute("PRAGMA table_info(team_members)")
        existing_cols = {row["name"] for row in cur.fetchall()}
        if "active" not in existing_cols:
            cur.execute("ALTER TABLE team_members ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
        if "email" not in existing_cols:
            cur.execute("ALTER TABLE team_members ADD COLUMN email TEXT DEFAULT ''")
        if "notes" not in existing_cols:
            cur.execute("ALTER TABLE team_members ADD COLUMN notes TEXT DEFAULT ''")
        if "username" not in existing_cols:
            cur.execute("ALTER TABLE team_members ADD COLUMN username TEXT DEFAULT ''")
        if "password_hash" not in existing_cols:
            cur.execute("ALTER TABLE team_members ADD COLUMN password_hash TEXT DEFAULT ''")

    # Seed initial data if empty
    cur.execute("SELECT COUNT(*) as c FROM areas")
    if cur.fetchone()["c"] == 0:
        seed_initial_data(cur)

    # Backfill username, email and default password_hash ('123456') for any existing team_members
    default_hash = hash_password("123456")
    cur.execute("SELECT id, name, email, username, password_hash FROM team_members")
    for row in cur.fetchall():
        uname = (row["username"] or "").strip()
        if not uname:
            uname = slugify_username(row["name"])
        email_val = (row["email"] or "").strip()
        if not email_val:
            email_val = f"{uname}@templo.org"
        phash = (row["password_hash"] or "").strip()
        if not phash:
            phash = default_hash
        if (
            uname != (row["username"] or "")
            or email_val != (row["email"] or "")
            or phash != (row["password_hash"] or "")
        ):
            cur.execute(
                "UPDATE team_members SET username = ?, email = ?, password_hash = ? WHERE id = ?",
                (uname, email_val, phash, row["id"]),
            )

    # Seed monthly schedules if empty
    cur.execute("SELECT COUNT(*) as c FROM monthly_schedules")
    if cur.fetchone()["c"] == 0:
        seed_monthly_schedules(cur)

    conn.commit()
    conn.close()


def seed_monthly_schedules(cur):
    schedules = [
        # Sexta-feira 16/10/2026 (Hoje)
        ("sc-101", "2026-10-16", "Sex, 16/10/2026", "Culto de Sexta & Vigília", "18:00 - 21:00", "Posto 01 · Estacionamento & Perímetro", "tm-01", "Samuel Rodrigues", "Equipe de Segurança", "Em Posto", "Rádio Canal 1 · Ronda externa ativa"),
        ("sc-102", "2026-10-16", "Sex, 16/10/2026", "Culto de Sexta & Vigília", "18:00 - 21:00", "Posto 02 · Saídas & Corredor Lateral", "tm-02", "Débora Martins", "Equipe de Segurança", "Em Posto", "Inspeção de barras antipânico"),
        ("sc-103", "2026-10-16", "Sex, 16/10/2026", "Culto de Sexta & Vigília", "18:00 - 21:00", "Posto 03 · Recepção & Acesso Infantil", "tm-03", "Carlos Andrade", "Obreiros", "Em Posto", "Conferência de pulseiras/QR"),
        ("sc-104", "2026-10-16", "Sex, 16/10/2026", "Culto de Sexta & Vigília", "18:00 - 21:00", "Posto 04 · Nave & Primeiros Socorros", "tm-04", "Joana Pereira", "Equipe de Segurança", "Em Posto", "Kit DEA conferido"),
        ("sc-105", "2026-10-16", "Sex, 16/10/2026", "Culto de Sexta & Vigília", "18:00 - 21:00", "Posto 05 · Cabine de Som & Patrimônio", "tm-05", "Lucas Tavares", "Obreiros", "Em Posto", "Custódia de equipamentos de áudio/vídeo"),
        ("sc-106", "2026-10-16", "Sex, 16/10/2026", "Culto de Sexta & Vigília", "18:00 - 21:00", "Posto 06 · Coordenação & Tesouraria", "tm-06", "Presb. Marcos Viana", "Gestor de Segurança", "Em Posto", "Dupla custódia e chave mestra"),

        # Domingo Manhã 18/10/2026
        ("sc-107", "2026-10-18", "Dom, 18/10/2026", "Escola Bíblica & Culto Matutino", "08:30 - 11:30", "Posto 01 · Estacionamento & Perímetro", "tm-02", "Débora Martins", "Equipe de Segurança", "Confirmado", "Abertura do portão às 08h15"),
        ("sc-108", "2026-10-18", "Dom, 18/10/2026", "Escola Bíblica & Culto Matutino", "08:30 - 11:30", "Posto 03 · Recepção & Acesso Infantil", "tm-03", "Carlos Andrade", "Obreiros", "Confirmado", "Fluxo intenso de crianças na EBD"),
        ("sc-109", "2026-10-18", "Dom, 18/10/2026", "Escola Bíblica & Culto Matutino", "08:30 - 11:30", "Posto 04 · Nave & Primeiros Socorros", "tm-07", "Rafael Costa", "Obreiros", "Escalado", "Corredor central"),

        # Domingo Noite 18/10/2026
        ("sc-110", "2026-10-18", "Dom, 18/10/2026", "Culto da Família (Domingo Noite)", "18:00 - 21:00", "Posto 01 · Estacionamento & Perímetro", "tm-01", "Samuel Rodrigues", "Equipe de Segurança", "Confirmado", "Ronda preventiva a cada 30 min"),
        ("sc-111", "2026-10-18", "Dom, 18/10/2026", "Culto da Família (Domingo Noite)", "18:00 - 21:00", "Posto 02 · Saídas & Corredor Lateral", "tm-04", "Joana Pereira", "Equipe de Segurança", "Confirmado", "Apoio saúde + saídas"),
        ("sc-112", "2026-10-18", "Dom, 18/10/2026", "Culto da Família (Domingo Noite)", "18:00 - 21:00", "Posto 05 · Cabine de Som & Patrimônio", "tm-05", "Lucas Tavares", "Obreiros", "Confirmado", "Fechamento patrimonial pós-culto"),
        ("sc-113", "2026-10-18", "Dom, 18/10/2026", "Culto da Família (Domingo Noite)", "18:00 - 21:00", "Posto 06 · Coordenação & Tesouraria", "tm-06", "Presb. Marcos Viana", "Gestor de Segurança", "Confirmado", "Supervisão geral do turno"),

        # Quarta-feira 21/10/2026
        ("sc-114", "2026-10-21", "Qua, 21/10/2026", "Culto de Ensino & Oração", "19:00 - 21:30", "Posto 01 · Estacionamento & Perímetro", "tm-01", "Samuel Rodrigues", "Equipe de Segurança", "Escalado", "Perímetro externo"),
        ("sc-115", "2026-10-21", "Qua, 21/10/2026", "Culto de Ensino & Oração", "19:00 - 21:30", "Posto 04 · Nave & Primeiros Socorros", "tm-07", "Rafael Costa", "Obreiros", "Escalado", "Recepção e nave"),

        # Domingo 25/10/2026
        ("sc-116", "2026-10-25", "Dom, 25/10/2026", "Culto de Santa Ceia (Domingo Noite)", "18:00 - 21:15", "Posto 06 · Coordenação & Tesouraria", "tm-06", "Presb. Marcos Viana", "Gestor de Segurança", "Escalado", "Efetivo completo convocado"),
        ("sc-117", "2026-10-25", "Dom, 25/10/2026", "Culto de Santa Ceia (Domingo Noite)", "18:00 - 21:15", "Púlpito & Decisão de Continuidade", "tm-08", "Pr. Roberto Almeida", "Pastor", "Confirmado", "Liderança pastoral"),
    ]
    cur.executemany(
        """
        INSERT INTO monthly_schedules (
            id, date_iso, date_label, event_name, shift_time, post_name,
            member_id, member_name, member_role, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        schedules,
    )


def seed_initial_data(cur):
    now = now_br()

    areas = [
        ("area-estac", "Estacionamento", "Perímetro Externo", "Atenção", "Iluminação em validação · Ronda ativa", 72, "amber", now),
        ("area-infantil", "Recepção Infantil", "Proteção Restrita", "Controlado", "Fluxo revisado · Controle por pulseira/QR", 94, "green", now),
        ("area-nave", "Nave Principal", "Circulação Pública", "Controlado", "2 obreiros em posição · Saídas livres", 88, "blue", now),
        ("area-corredor", "Corredor Lateral & Saídas", "Rota de Evacuação", "Em ronda", "Nova checagem programada às 18h20", 80, "blue", now),
        ("area-som", "Cabine de Som & Mídia", "Patrimônio Alto Valor", "Controlado", "Equipamentos conferidos · Acesso restrito", 96, "green", now),
        ("area-tesouraria", "Tesouraria & Secretaria", "Segurança Patrimonial", "Controlado", "Fechadura biométrica e cofre conferidos", 92, "green", now),
    ]
    cur.executemany(
        "INSERT INTO areas (id, name, zone_type, status, detail, coverage, tone, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        areas,
    )

    checkpoints = [
        (
            "cp-01",
            "POSTO-01",
            "Portão Principal & Guarita do Estacionamento",
            "area-estac",
            "Estacionamento",
            "ARC-QR-POSTO-01-ESTAC",
            -23.550520,
            -46.633308,
            60,
            "Verificar refletores LED, portão de veículos, cone de canalização e visibilidade da câmera externa 01.",
            "Iluminação ligada;Portão desobstruído;Câmera externa operacional",
            1,
            "Hoje, 18:02",
            "Samuel R.",
            "ANOMALIA",
        ),
        (
            "cp-02",
            "POSTO-02",
            "Corredor Lateral & Barras Antipânico",
            "area-corredor",
            "Corredor Lateral & Saídas",
            "ARC-QR-POSTO-02-SAIDAS",
            -23.550610,
            -46.633420,
            45,
            "Inspecionar portas de emergência, travas antipânico, extintores ABC e ausência de caixas ou obstáculos.",
            "Portas destrancadas;Rota 100% livre;Extintor no prazo e lacrado",
            2,
            "Hoje, 17:42",
            "Débora M.",
            "OK",
        ),
        (
            "cp-03",
            "POSTO-03",
            "Recepção & Controle do Ministério Infantil",
            "area-infantil",
            "Recepção Infantil",
            "ARC-QR-POSTO-03-INFANTIL",
            -23.550480,
            -46.633190,
            40,
            "Validar portinhola travada, etiquetadora de check-in vinculada ao responsável e rádio comunicador no canal 2.",
            "Controle de acesso ativo;Rádio testado;2 monitores presentes",
            3,
            "Hoje, 18:08",
            "Carlos A.",
            "OK",
        ),
        (
            "cp-04",
            "POSTO-04",
            "Nave Principal, Altar e Galeria Técnica",
            "area-nave",
            "Nave Principal",
            "ARC-QR-POSTO-04-NAVE",
            -23.550550,
            -46.633250,
            50,
            "Confirmar posicionamento dos obreiros nos corredores, iluminação de emergência e kit de primeiros socorros.",
            "Luzes de emergência OK;Obreiros posicionados;Corredores livres",
            4,
            None,
            None,
            "PENDENTE",
        ),
        (
            "cp-05",
            "POSTO-05",
            "Cabine de Som, Vídeo & Instrumentos",
            "area-som",
            "Cabine de Som & Mídia",
            "ARC-QR-POSTO-05-MIDIA",
            -23.550590,
            -46.633150,
            35,
            "Conferir mesa digital, notebooks de projeção, câmeras PTZ, microfones sem fio e quadro elétrico dedicado.",
            "Patrimônio conferido;Sem cabos expostos;Chave com técnico líder",
            5,
            "Hoje, 17:55",
            "Lucas T.",
            "OK",
        ),
        (
            "cp-06",
            "POSTO-06",
            "Tesouraria, Secretaria & Quadro Geral de Energia",
            "area-tesouraria",
            "Tesouraria & Secretaria",
            "ARC-QR-POSTO-06-TESOURARIA",
            -23.550640,
            -46.633100,
            35,
            "Checar tranca da tesouraria, CFTV interno, nobreak central e protocolo de dupla custódia para dízimos/ofertas.",
            "Porta restrita trancada;CFTV gravando;Nobreak em 100%",
            6,
            None,
            None,
            "PENDENTE",
        ),
    ]
    cur.executemany(
        """
        INSERT INTO checkpoints (
            id, code, name, area_id, area_name, qr_token, latitude, longitude,
            radius_meters, instructions, critical_items, order_num,
            last_checked_at, last_checked_by, last_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        checkpoints,
    )

    sessions = [
        (
            "patrol-101",
            "Ronda Preventiva Pré-Culto",
            "Turno Noturno (18h00 - 21h00)",
            "Samuel R.",
            "Equipe de Segurança",
            "16/10/2026 17:40",
            None,
            "Em andamento",
            6,
            4,
            1,
            "Vistoria de abertura e validação de perímetro externo e áreas críticas.",
        ),
        (
            "patrol-100",
            "Ronda de Abertura Patrimonial",
            "Turno Vespertino (16h00 - 18h00)",
            "Débora M.",
            "Equipe de Segurança",
            "16/10/2026 16:00",
            "16/10/2026 16:42",
            "Concluída",
            6,
            6,
            0,
            "Todas as portas, quadros elétricos e salas patrimoniais inspecionadas.",
        ),
    ]
    cur.executemany(
        """
        INSERT INTO patrol_sessions (
            id, title, shift_name, agent_name, agent_role, started_at, finished_at,
            status, total_checkpoints, visited_checkpoints, anomalies_count, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        sessions,
    )

    logs = [
        (
            "log-1",
            "patrol-101",
            "cp-02",
            "POSTO-02",
            "Corredor Lateral & Barras Antipânico",
            "Corredor Lateral & Saídas",
            "Débora M.",
            "16/10/2026 17:42",
            "QR_CODE + GPS",
            -23.550612,
            -46.633418,
            3.2,
            "OK",
            "Caixa removida anteriormente; rota 100% desobstruída e barras testadas.",
            None,
        ),
        (
            "log-2",
            "patrol-101",
            "cp-05",
            "POSTO-05",
            "Cabine de Som, Vídeo & Instrumentos",
            "Cabine de Som & Mídia",
            "Lucas T.",
            "16/10/2026 17:55",
            "QR_CODE + GPS",
            -23.550588,
            -46.633152,
            2.1,
            "OK",
            "Mesa digital, 6 microfones sem fio, 2 câmeras PTZ e projetores conferidos.",
            None,
        ),
        (
            "log-3",
            "patrol-101",
            "cp-01",
            "POSTO-01",
            "Portão Principal & Guarita do Estacionamento",
            "Estacionamento",
            "Samuel R.",
            "16/10/2026 18:02",
            "QR_CODE + GPS",
            -23.550525,
            -46.633312,
            4.8,
            "ANOMALIA",
            "Refletor norte piscando; área sinalizada com cones e ronda presencial reforçada.",
            "oc-1041",
        ),
        (
            "log-4",
            "patrol-101",
            "cp-03",
            "POSTO-03",
            "Recepção & Controle do Ministério Infantil",
            "Recepção Infantil",
            "Carlos A.",
            "16/10/2026 18:08",
            "QR_CODE + GPS",
            -23.550482,
            -46.633194,
            1.9,
            "OK",
            "Portinhola travada e sistema de etiquetas de reunificação testado.",
            None,
        ),
    ]
    cur.executemany(
        """
        INSERT INTO checkpoint_logs (
            id, session_id, checkpoint_id, checkpoint_code, checkpoint_name,
            area_name, agent_name, scanned_at, verification_method,
            latitude, longitude, distance_meters, status, notes, occurrence_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        logs,
    )

    checklists = [
        ("ck-1", "Saídas de emergência, barras antipânico e corredores sem obstrução", "Evacuação", "Abertura / Pré-Culto", "Infraestrutura", 1, 1, "Débora M.", "17:42", "Culto Noturno"),
        ("ck-2", "Iluminação do estacionamento, calçadas e acesso externo testada", "Estacionamento", "Abertura / Pré-Culto", "Equipe Externa", 1, 0, None, None, "Culto Noturno"),
        ("ck-3", "Rádios comunicadores (canais 1 e 2) e palavra-código testados", "Comunicação", "Abertura / Pré-Culto", "Gestor de Segurança", 1, 1, "Gestor de Segurança", "17:50", "Culto Noturno"),
        ("ck-4", "Kit de primeiros socorros, DEA e rota de ambulância conferidos", "Saúde", "Abertura / Pré-Culto", "Equipe de Apoio", 0, 1, "Joana P.", "17:55", "Culto Noturno"),
        ("ck-5", "Sistema de etiquetas e controle de entrada/retirada infantil ativo", "Proteção Infantil", "Abertura / Pré-Culto", "Ministério Infantil", 1, 1, "Carlos A.", "18:05", "Culto Noturno"),
        ("ck-6", "Critérios de interrupção, evacuação e abrigo revisados com liderança", "Plano de Emergência", "Abertura / Pré-Culto", "Liderança / Pastor", 1, 0, None, None, "Culto Noturno"),
        ("ck-7", "Posições de obreiros e equipe de segurança confirmadas nos postos", "Governança", "Abertura / Pré-Culto", "Gestor de Segurança", 0, 1, "Gestor de Segurança", "18:10", "Culto Noturno"),
        ("ck-8", "Portas de áreas restritas (Tesouraria, Almoxarifado, Nobreak) trancadas", "Controle de Acesso", "Abertura / Pré-Culto", "Ronda Patrimonial", 0, 1, "Samuel R.", "18:00", "Culto Noturno"),
        ("ck-9", "Ronda externa no estacionamento realizada durante o momento de louvor/palavra", "Estacionamento", "Durante o Culto", "Equipe Externa", 1, 0, None, None, "Culto Noturno"),
        ("ck-10", "Portinhola do espaço infantil monitorada e sem entrega sem pulseira/código", "Proteção Infantil", "Durante o Culto", "Ministério Infantil", 1, 1, "Carlos A.", "18:15", "Culto Noturno"),
        ("ck-11", "Dupla custódia posicionada para recolhimento e transporte de ofertas à Tesouraria", "Segurança Patrimonial", "Durante o Culto", "Tesouraria + Segurança", 1, 0, None, None, "Culto Noturno"),
        ("ck-12", "Cabine de som, projetores, instrumentos e microfones guardados e trancados", "Segurança Patrimonial", "Fechamento Patrimonial", "Mídia + Segurança", 1, 0, None, None, "Culto Noturno"),
        ("ck-13", "Cofre da tesouraria lacrado e porta com tranca biométrica verificada", "Segurança Patrimonial", "Fechamento Patrimonial", "Tesouraria", 1, 0, None, None, "Culto Noturno"),
        ("ck-14", "Vistoria final de banheiros, salas de apoio e galerias antes do fechamento", "Controle de Acesso", "Fechamento Patrimonial", "Ronda Patrimonial", 1, 0, None, None, "Culto Noturno"),
        ("ck-15", "Quadro de climatização desligado, alarme perimetral ativado e CFTV noturno OK", "Infraestrutura", "Fechamento Patrimonial", "Gestor de Segurança", 1, 0, None, None, "Culto Noturno"),
    ]
    cur.executemany(
        """
        INSERT INTO checklists (
            id, title, area, phase, responsible, critical, complete,
            completed_by, completed_at, shift_label
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        checklists,
    )

    assets = [
        ("ast-01", "PAT-SOM-001", "Console Digital Behringer Wing + Stagebox + 6 Mics Sem Fio", "Áudio, Vídeo & Mídia", "Cabine de Som & Mídia", "Lucas T. (Líder de Áudio)", "Conferido", "Case trancado após uso; todos os 6 transmissores na base.", "Hoje, 17:55", "Lucas T.", 1),
        ("ast-02", "PAT-VID-002", "Kit 2 Câmeras PTZ + Switcher de Transmissão + 2 MacBooks", "Áudio, Vídeo & Mídia", "Cabine de Som & Mídia", "Lucas T. (Líder de Áudio)", "Conferido", "Cabos de segurança (Kensington) fixados na bancada.", "Hoje, 17:55", "Lucas T.", 1),
        ("ast-03", "PAT-TES-001", "Cofre Inteligente & Malotes de Coleta Numerados", "Tesouraria & Coletas", "Tesouraria & Secretaria", "Presb. Marcos V.", "Protegido", "Acesso restrito em dupla custódia; câmera interna ativa.", "Hoje, 17:48", "Samuel R.", 1),
        ("ast-04", "PAT-CHV-001", "Claviculário Mestre (18 Chaves Codificadas + Cartões RFID)", "Chaves & Controle de Acesso", "Tesouraria & Secretaria", "Gestor de Segurança", "Em Uso Controlado", "Chaves do Som e Infantil retiradas mediante assinatura no turno.", "Hoje, 17:30", "Gestor de Segurança", 1),
        ("ast-05", "PAT-EMG-001", "Desfibrilador (DEA) + Kit Trauma/Primeiros Socorros + Rádios UHF", "Segurança & Emergência", "Nave Principal", "Joana P. (Saúde/Apoio)", "Pronto para Uso", "Bateria do DEA 100%, lacre conferido, 8 rádios carregados.", "Hoje, 17:52", "Joana P.", 0),
        ("ast-06", "PAT-INF-001", "Nobreak Central 6kVA + Gravador NVR (16 Câmeras IP) + Alarme", "Infraestrutura & Energia", "Tesouraria & Secretaria", "Infraestrutura", "Atenção", "NVR gravando 16/16 câmeras; refletor externo norte em manutenção.", "Hoje, 18:02", "Samuel R.", 1),
    ]
    cur.executemany(
        """
        INSERT INTO assets (
            id, code, name, category, area_name, custodian, status,
            condition_note, last_verified_at, last_verified_by, requires_lock
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        assets,
    )

    occurrences = [
        (
            "oc-1042",
            "Quase-incidente",
            "Saída lateral com caixa próxima à rota",
            "Corredor lateral",
            "16/10/2026 17:42",
            "Hoje, 17:42",
            "Atenção",
            "Em acompanhamento",
            "Caixa de materiais foi encontrada próxima à rota de saída durante a vistoria pré-evento no Posto 02.",
            "Item removido imediatamente e responsável de infraestrutura avisado.",
            "Sem dano; barreira de evacuação temporariamente comprometida.",
            "Não aplicável",
            "Manter inspeção visual obrigatória via QR Code antes da abertura das portas.",
            "Débora M.",
            "cp-02",
        ),
        (
            "oc-1041",
            "Incidente",
            "Iluminação intermitente no estacionamento (Setor Norte)",
            "Estacionamento",
            "16/10/2026 16:10",
            "Hoje, 16:10",
            "Alto",
            "Encaminhado",
            "Dois pontos de luz apresentaram instabilidade durante a inspeção de chegada no Posto 01.",
            "Área sinalizada e manutenção acionada; ronda reforçada até correção.",
            "Exposição operacional aumentada em dois pontos do estacionamento.",
            "Prestador de manutenção elétrica",
            "Verificar iluminação antes dos horários de maior fluxo noturno.",
            "Samuel R.",
            "cp-01",
        ),
        (
            "oc-1040",
            "Incidente",
            "Criança separada do responsável na recepção",
            "Recepção infantil",
            "11/10/2026 10:21",
            "Domingo, 10:21",
            "Atenção",
            "Resolvido",
            "Criança foi localizada na recepção sem o responsável imediato durante mudança de sala.",
            "Equipe infantil aplicou protocolo de acolhimento e reunificação por código de pulseira.",
            "Sem dano identificado; situação tratada conforme protocolo.",
            "Não aplicável",
            "Reforçar conferência de entrega e retirada exclusivamente por responsável autorizado.",
            "Carlos A.",
            "cp-03",
        ),
        (
            "oc-1039",
            "Emergência",
            "Mal-estar de participante durante o culto",
            "Nave principal",
            "10/10/2026 20:08",
            "Sábado, 20:08",
            "Controlado",
            "Resolvido",
            "Participante relatou tontura e foi acompanhado para espaço reservado e ventilado.",
            "Primeiros socorros dentro da capacitação e contato com familiar presente.",
            "Sem dano informado; atividade retomada com acompanhamento.",
            "Serviço médico não acionado",
            "Confirmar kit e rota de acesso livre para viatura no briefing pré-culto.",
            "Joana P.",
            "cp-04",
        ),
    ]
    cur.executemany(
        """
        INSERT INTO occurrences (
            id, type, title, area, occurred_at, time_label, severity, status,
            description, response, damage, external_action, lesson, reported_by, checkpoint_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        occurrences,
    )

    team_members = [
        ("tm-01", "Samuel Rodrigues", "Equipe de Segurança", "Posto 01 · Estacionamento & Perímetro", "18:00 - 21:00", "Em Posto", "Rádio Canal 1 · (11) 99812-0101", "17:35", 1, "samuel@templo.org", "Líder de ronda externa e perímetro."),
        ("tm-02", "Débora Martins", "Equipe de Segurança", "Posto 02 · Saídas & Corredor Lateral", "18:00 - 21:00", "Em Posto", "Rádio Canal 1 · (11) 99812-0102", "17:38", 1, "debora@templo.org", "Especialista em rotas de evacuação e prevenção."),
        ("tm-03", "Carlos Andrade", "Obreiros", "Posto 03 · Recepção & Acesso Infantil", "18:00 - 21:00", "Em Posto", "Rádio Canal 2 · (11) 99812-0103", "17:45", 1, "carlos@templo.org", "Responsável pelo controle de acesso infantil."),
        ("tm-04", "Joana Pereira", "Equipe de Segurança", "Posto 04 · Nave & Primeiros Socorros", "18:00 - 21:00", "Em Posto", "Rádio Canal 1 · (11) 99812-0104", "17:48", 1, "joana@templo.org", "Enfermeira voluntária · Brigadista e DEA."),
        ("tm-05", "Lucas Tavares", "Obreiros", "Posto 05 · Cabine de Som & Patrimônio", "18:00 - 21:00", "Em Posto", "Rádio Canal 2 · (11) 99812-0105", "17:50", 1, "lucas@templo.org", "Responsável técnico pelo patrimônio de áudio e vídeo."),
        ("tm-06", "Presb. Marcos Viana", "Gestor de Segurança", "Posto 06 · Coordenação & Tesouraria", "18:00 - 21:00", "Em Posto", "Rádio Canal 1/2 · (11) 99812-0106", "17:30", 1, "marcos@templo.org", "Gestor geral de segurança patrimonial e dupla custódia."),
        ("tm-07", "Rafael Costa", "Obreiros", "Nave Principal · Corredor Central", "18:00 - 21:00", "Pendente", "Rádio Canal 2 · (11) 99812-0107", None, 1, "rafael@templo.org", "Acolhimento e orientação de fluxo na nave."),
        ("tm-08", "Pr. Roberto Almeida", "Pastor", "Púlpito & Decisão de Continuidade", "18:30 - 21:00", "Em Posto", "Canal Direto · (11) 99812-0108", "18:00", 1, "pastor@templo.org", "Liderança espiritual e comunicação institucional."),
        ("tm-650021", "Cosme Alan Martins Galvão", "Gestor de Segurança", "Posto 06 · Coordenação & Tesouraria", "18:00 - 21:00", "Em Posto", "61984400540", "18:00", 1, "camgalvao83@gmail.com", "Gestor de Segurança Patrimonial."),
    ]
    cur.executemany(
        """
        INSERT INTO team_members (
            id, name, role, post_area, shift, status, phone_short, checkin_at, active, email, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        team_members,
    )

    trainings = [
        ("tr-1", "Briefing Operacional Pré-Culto (Comunicação e Postos)", "Hoje, 18:15", "Equipe de Segurança + Obreiros", "Programado"),
        ("tr-2", "Simulado Prático de Evacuação e Desobstrução de Saídas", "23 out. · 09:00", "Liderança + Equipe de Campo", "Agendado"),
        ("tr-3", "Protocolo de Proteção Infantil e Reunificação Segura", "30 out. · 19:30", "Ministério Infantil + Recepção", "Agendado"),
        ("tr-4", "Prevenção Patrimonial: Fechamento de Salas e Custódia de Coletas", "06 nov. · 19:30", "Tesouraria + Mídia + Segurança", "Planejado"),
    ]
    cur.executemany(
        "INSERT INTO trainings (id, title, date_label, participants, status) VALUES (?, ?, ?, ?, ?)",
        trainings,
    )
