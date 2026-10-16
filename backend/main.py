import math
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.database import (
    get_conn,
    hash_password,
    init_db,
    now_br,
    rows_to_dicts,
    slugify_username,
    verify_password,
)

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(
    title="ARCANJO INTELLIGENCE — API de Segurança Patrimonial",
    description="Backend Full-Stack para Controle de Rondas, Postos QR/GPS, Checklists por Turno, Patrimônio, Equipe, Escala Mensal e Autenticação.",
    version="2.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return round(r * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))), 1)


def short_time() -> str:
    return f"Hoje, {datetime.now().strftime('%H:%M')}"


def format_date_label(date_iso: str) -> str:
    try:
        dt = datetime.strptime(date_iso, "%Y-%m-%d")
        weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
        return f"{weekdays[dt.weekday()]}, {dt.strftime('%d/%m/%Y')}"
    except Exception:
        return date_iso


class StartPatrolPayload(BaseModel):
    title: str
    shift_name: str
    agent_name: str
    agent_role: str = "Equipe de Segurança"
    notes: str = ""


class ScanCheckpointPayload(BaseModel):
    checkpoint_id: Optional[str] = None
    qr_token: Optional[str] = None
    session_id: Optional[str] = None
    agent_name: str = "Samuel R."
    verification_method: str = "QR_CODE + GPS"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    status: str = "OK"
    notes: str = ""
    create_occurrence: bool = True
    occurrence_severity: str = "Atenção"


class CreateCheckpointPayload(BaseModel):
    code: str
    name: str
    area_name: str
    instructions: str
    critical_items: str
    latitude: float = -23.550550
    longitude: float = -46.633250


class ToggleChecklistPayload(BaseModel):
    user_name: str = "Gestor de Segurança"


class CreateChecklistPayload(BaseModel):
    title: str
    area: str
    phase: str = "Abertura / Pré-Culto"
    responsible: str
    critical: bool = True


class CreateOccurrencePayload(BaseModel):
    type: str
    severity: str
    title: str
    area: str
    occurred_at: Optional[str] = None
    description: str
    response: str
    damage: str = "Sem dano identificado"
    external_action: str = "Não aplicável"
    lesson: str = ""
    reported_by: str = "Gestor de Segurança"
    checkpoint_id: Optional[str] = None


class UpdateOccurrencePayload(BaseModel):
    status: Optional[str] = None
    lesson: Optional[str] = None
    response: Optional[str] = None


class VerifyAssetPayload(BaseModel):
    status: str = "Conferido"
    condition_note: Optional[str] = None
    verified_by: str = "Gestor de Segurança"


class CreateAssetPayload(BaseModel):
    code: str
    name: str
    category: str
    area_name: str
    custodian: str
    condition_note: str
    requires_lock: bool = True


class TeamMemberPayload(BaseModel):
    name: str
    role: str
    post_area: str = ""
    shift: str = ""
    phone_short: str
    email: str = ""
    notes: str = ""
    active: bool = True
    username: str = ""
    password: str = ""


class LoginPayload(BaseModel):
    identifier: str
    password: str


class ChangePasswordPayload(BaseModel):
    member_id: str
    current_password: Optional[str] = None
    new_password: str


class ToggleActivePayload(BaseModel):
    active: Optional[bool] = None


class CreateSchedulePayload(BaseModel):
    date_iso: str
    event_name: str
    shift_time: str
    post_name: str
    member_id: str
    status: str = "Escalado"
    notes: str = ""


class UpdateSchedulePayload(BaseModel):
    status: Optional[str] = None
    member_id: Optional[str] = None
    post_name: Optional[str] = None
    notes: Optional[str] = None


# ==================== AUTENTICAÇÃO (LOGIN & SENHA) ====================
@app.post("/api/auth/login")
def login_user(payload: LoginPayload):
    identifier = (payload.identifier or "").strip().lower()
    password = (payload.password or "").strip()
    if not identifier or not password:
        raise HTTPException(status_code=400, detail="Informe seu usuário/e-mail e sua senha.")

    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM team_members")
    members = rows_to_dicts(cur.fetchall())
    conn.close()

    matched = None
    id_prefix = identifier.split("@")[0]
    for m in members:
        email_l = (m.get("email") or "").strip().lower()
        uname_l = (m.get("username") or "").strip().lower()
        name_l = (m.get("name") or "").strip().lower()
        phone_digits = "".join(ch for ch in (m.get("phone_short") or "") if ch.isdigit())
        id_digits = "".join(ch for ch in identifier if ch.isdigit())

        if (
            identifier == email_l
            or identifier == uname_l
            or identifier == name_l
            or (email_l and id_prefix == email_l.split("@")[0])
            or (uname_l and id_prefix == uname_l.split(".")[0])
            or (len(id_digits) >= 8 and id_digits in phone_digits)
        ):
            matched = m
            break

    # Aliases de conveniência ("admin", "gestor", "pastor")
    if not matched and id_prefix in ("admin", "gestor", "arcanjo"):
        matched = next((m for m in members if m.get("role") == "Gestor de Segurança" and m.get("active")), None)
    if not matched and id_prefix == "pastor":
        matched = next((m for m in members if m.get("role") == "Pastor" and m.get("active")), None)

    if not matched:
        raise HTTPException(
            status_code=401,
            detail="Usuário ou e-mail não encontrado no cadastro da Equipe.",
        )

    if not bool(matched.get("active", 1)):
        raise HTTPException(
            status_code=403,
            detail=f"Acesso bloqueado: O perfil de {matched['name']} está desativado pelo Gestor de Segurança.",
        )

    stored_hash = matched.get("password_hash") or ""
    if not verify_password(password, stored_hash):
        raise HTTPException(status_code=401, detail="Senha incorreta. Verifique suas credenciais ou solicite redefinição ao Gestor.")

    token = f"arc-sess-{matched['id']}-{int(time.time())}"
    return {
        "ok": True,
        "token": token,
        "user": {
            "id": matched["id"],
            "name": matched["name"],
            "role": matched["role"],
            "email": matched.get("email") or "",
            "username": matched.get("username") or slugify_username(matched["name"]),
            "phone_short": matched.get("phone_short") or "",
            "active": bool(matched.get("active", 1)),
        },
    }


@app.post("/api/auth/change-password")
def change_user_password(payload: ChangePasswordPayload):
    new_pwd = (payload.new_password or "").strip()
    if len(new_pwd) < 4:
        raise HTTPException(status_code=400, detail="A nova senha deve ter pelo menos 4 caracteres.")

    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM team_members WHERE id = ?", (payload.member_id,))
    member = cur.fetchone()
    if not member:
        conn.close()
        raise HTTPException(status_code=404, detail="Perfil não encontrado.")

    if payload.current_password:
        if not verify_password(payload.current_password.strip(), member["password_hash"] or ""):
            conn.close()
            raise HTTPException(status_code=401, detail="A senha atual informada está incorreta.")

    new_hash = hash_password(new_pwd)
    cur.execute("UPDATE team_members SET password_hash = ? WHERE id = ?", (new_hash, payload.member_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/state")
def get_full_state():
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT * FROM areas ORDER BY id")
    areas = rows_to_dicts(cur.fetchall())

    cur.execute("SELECT * FROM checkpoints ORDER BY order_num ASC")
    checkpoints = rows_to_dicts(cur.fetchall())

    cur.execute("SELECT * FROM patrol_sessions ORDER BY started_at DESC")
    patrol_sessions = rows_to_dicts(cur.fetchall())

    cur.execute("SELECT * FROM checkpoint_logs ORDER BY rowid DESC LIMIT 40")
    checkpoint_logs = rows_to_dicts(cur.fetchall())

    cur.execute("SELECT * FROM checklists ORDER BY rowid ASC")
    checklists_raw = rows_to_dicts(cur.fetchall())
    for item in checklists_raw:
        item["critical"] = bool(item["critical"])
        item["complete"] = bool(item["complete"])

    cur.execute("SELECT * FROM assets ORDER BY code ASC")
    assets = rows_to_dicts(cur.fetchall())
    for a in assets:
        a["requires_lock"] = bool(a["requires_lock"])

    cur.execute("SELECT * FROM occurrences ORDER BY rowid DESC")
    occurrences = rows_to_dicts(cur.fetchall())

    cur.execute("SELECT * FROM team_members ORDER BY active DESC, name ASC")
    team_members = rows_to_dicts(cur.fetchall())
    for m in team_members:
        m["active"] = bool(m.get("active", 1))
        m["has_password"] = bool(m.get("password_hash"))
        m["username"] = m.get("username") or slugify_username(m["name"])
        m.pop("password_hash", None)


    cur.execute("SELECT * FROM monthly_schedules ORDER BY date_iso ASC, shift_time ASC, post_name ASC")
    monthly_schedules = rows_to_dicts(cur.fetchall())

    cur.execute("SELECT * FROM trainings ORDER BY id ASC")
    trainings = rows_to_dicts(cur.fetchall())

    conn.close()
    return {
        "areas": areas,
        "checkpoints": checkpoints,
        "patrol_sessions": patrol_sessions,
        "checkpoint_logs": checkpoint_logs,
        "checklists": checklists_raw,
        "assets": assets,
        "occurrences": occurrences,
        "team_members": team_members,
        "monthly_schedules": monthly_schedules,
        "trainings": trainings,
        "server_time": now_br(),
    }


@app.post("/api/patrols/start")
def start_patrol(payload: StartPatrolPayload):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) as c FROM checkpoints")
    total_cp = cur.fetchone()["c"]

    session_id = f"patrol-{int(time.time())}"
    now = now_br()
    cur.execute(
        """
        INSERT INTO patrol_sessions (
            id, title, shift_name, agent_name, agent_role, started_at,
            finished_at, status, total_checkpoints, visited_checkpoints, anomalies_count, notes
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'Em andamento', ?, 0, 0, ?)
        """,
        (
            session_id,
            payload.title.strip(),
            payload.shift_name.strip(),
            payload.agent_name.strip(),
            payload.agent_role.strip(),
            now,
            total_cp,
            payload.notes.strip(),
        ),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "session_id": session_id}


@app.post("/api/patrols/{session_id}/finish")
def finish_patrol(session_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM patrol_sessions WHERE id = ?", (session_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Sessão de ronda não encontrada.")

    cur.execute(
        "UPDATE patrol_sessions SET status = 'Concluída', finished_at = ? WHERE id = ?",
        (now_br(), session_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/checkpoints/scan")
def scan_checkpoint(payload: ScanCheckpointPayload):
    conn = get_conn()
    cur = conn.cursor()

    cp = None
    if payload.checkpoint_id:
        cur.execute("SELECT * FROM checkpoints WHERE id = ?", (payload.checkpoint_id,))
        cp = cur.fetchone()
    if not cp and payload.qr_token:
        token = payload.qr_token.strip()
        cur.execute(
            "SELECT * FROM checkpoints WHERE UPPER(qr_token) = UPPER(?) OR UPPER(code) = UPPER(?)",
            (token, token),
        )
        cp = cur.fetchone()

    if not cp:
        conn.close()
        raise HTTPException(status_code=404, detail="Posto / QR Code não reconhecido no sistema.")

    cp_dict = dict(cp)

    session_id = payload.session_id
    if not session_id:
        cur.execute("SELECT id FROM patrol_sessions WHERE status = 'Em andamento' ORDER BY rowid DESC LIMIT 1")
        active = cur.fetchone()
        session_id = active["id"] if active else "patrol-avulsa"

    lat = payload.latitude if payload.latitude is not None else cp_dict["latitude"]
    lng = payload.longitude if payload.longitude is not None else cp_dict["longitude"]
    dist = haversine_meters(lat, lng, cp_dict["latitude"], cp_dict["longitude"])

    now = now_br()
    short = short_time()
    status = "ANOMALIA" if payload.status.upper() == "ANOMALIA" else "OK"

    occ_id = None
    if status == "ANOMALIA" and payload.create_occurrence:
        occ_id = f"oc-{int(time.time())}"
        occ_title = f"Anomalia em ronda no {cp_dict['code']} ({cp_dict['name']})"
        occ_desc = payload.notes.strip() or f"Anomalia reportada durante verificação presencial do {cp_dict['code']}."
        cur.execute(
            """
            INSERT INTO occurrences (
                id, type, title, area, occurred_at, time_label, severity, status,
                description, response, damage, external_action, lesson, reported_by, checkpoint_id
            ) VALUES (?, 'Incidente', ?, ?, ?, ?, ?, 'Em acompanhamento', ?, ?, 'Em avaliação', 'Não aplicável', ?, ?, ?)
            """,
            (
                occ_id,
                occ_title,
                cp_dict["area_name"],
                now,
                short,
                payload.occurrence_severity,
                occ_desc,
                "Posto sinalizado pelo agente em ronda; aguardando validação do Gestor.",
                "Verificar causa raiz no fechamento do turno.",
                payload.agent_name,
                cp_dict["id"],
            ),
        )

    log_id = f"log-{int(time.time() * 1000)}"
    cur.execute(
        """
        INSERT INTO checkpoint_logs (
            id, session_id, checkpoint_id, checkpoint_code, checkpoint_name,
            area_name, agent_name, scanned_at, verification_method,
            latitude, longitude, distance_meters, status, notes, occurrence_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            log_id,
            session_id,
            cp_dict["id"],
            cp_dict["code"],
            cp_dict["name"],
            cp_dict["area_name"],
            payload.agent_name,
            now,
            payload.verification_method,
            lat,
            lng,
            dist,
            status,
            payload.notes.strip() or ("Verificação sem alterações." if status == "OK" else "Anomalia registrada em campo."),
            occ_id,
        ),
    )

    cur.execute(
        """
        UPDATE checkpoints
        SET last_checked_at = ?, last_checked_by = ?, last_status = ?
        WHERE id = ?
        """,
        (short, payload.agent_name, status, cp_dict["id"]),
    )

    cur.execute("SELECT * FROM patrol_sessions WHERE id = ?", (session_id,))
    sess = cur.fetchone()
    if sess:
        cur.execute(
            "SELECT COUNT(DISTINCT checkpoint_id) as visited FROM checkpoint_logs WHERE session_id = ?",
            (session_id,),
        )
        visited = cur.fetchone()["visited"]
        anom_inc = 1 if status == "ANOMALIA" else 0
        new_status = "Concluída" if visited >= sess["total_checkpoints"] and status == "OK" else sess["status"]
        finished_at = now if new_status == "Concluída" and not sess["finished_at"] else sess["finished_at"]
        cur.execute(
            """
            UPDATE patrol_sessions
            SET visited_checkpoints = ?, anomalies_count = anomalies_count + ?, status = ?, finished_at = ?
            WHERE id = ?
            """,
            (visited, anom_inc, new_status, finished_at, session_id),
        )

    if status == "ANOMALIA":
        cur.execute(
            """
            UPDATE areas
            SET status = 'Atenção', detail = ?, tone = 'amber', coverage = MAX(60, coverage - 10), updated_at = ?
            WHERE id = ?
            """,
            (f"Anomalia reportada ({short}) por {payload.agent_name}", now, cp_dict["area_id"]),
        )
    else:
        cur.execute(
            """
            UPDATE areas
            SET status = 'Controlado', detail = ?, tone = 'green', coverage = MIN(100, coverage + 6), updated_at = ?
            WHERE id = ?
            """,
            (f"Verificado ({short}) por {payload.agent_name}", now, cp_dict["area_id"]),
        )

    conn.commit()
    conn.close()
    return {
        "ok": True,
        "log_id": log_id,
        "checkpoint": cp_dict["name"],
        "distance_meters": dist,
        "occurrence_id": occ_id,
    }


@app.post("/api/checkpoints")
def create_checkpoint(payload: CreateCheckpointPayload):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) as c FROM checkpoints")
    count = cur.fetchone()["c"] + 1
    cp_id = f"cp-{int(time.time())}"
    code = payload.code.strip().upper()
    qr_token = f"ARC-QR-{code}-{int(time.time()) % 10000}"

    cur.execute("SELECT id FROM areas WHERE name = ? LIMIT 1", (payload.area_name,))
    area_row = cur.fetchone()
    area_id = area_row["id"] if area_row else "area-nave"

    cur.execute(
        """
        INSERT INTO checkpoints (
            id, code, name, area_id, area_name, qr_token, latitude, longitude,
            radius_meters, instructions, critical_items, order_num, last_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 45, ?, ?, ?, 'PENDENTE')
        """,
        (
            cp_id,
            code,
            payload.name.strip(),
            area_id,
            payload.area_name.strip(),
            qr_token,
            payload.latitude,
            payload.longitude,
            payload.instructions.strip(),
            payload.critical_items.strip(),
            count,
        ),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "id": cp_id, "qr_token": qr_token}


@app.post("/api/checklists/{item_id}/toggle")
def toggle_checklist(item_id: str, payload: ToggleChecklistPayload):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM checklists WHERE id = ?", (item_id,))
    item = cur.fetchone()
    if not item:
        conn.close()
        raise HTTPException(status_code=404, detail="Item de checklist não encontrado.")

    new_complete = 0 if item["complete"] else 1
    completed_by = payload.user_name if new_complete else None
    completed_at = datetime.now().strftime("%H:%M") if new_complete else None

    cur.execute(
        "UPDATE checklists SET complete = ?, completed_by = ?, completed_at = ? WHERE id = ?",
        (new_complete, completed_by, completed_at, item_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "complete": bool(new_complete)}


@app.post("/api/checklists")
def create_checklist_item(payload: CreateChecklistPayload):
    conn = get_conn()
    cur = conn.cursor()
    ck_id = f"ck-{int(time.time())}"
    cur.execute(
        """
        INSERT INTO checklists (
            id, title, area, phase, responsible, critical, complete, shift_label
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 'Culto Noturno')
        """,
        (
            ck_id,
            payload.title.strip(),
            payload.area.strip(),
            payload.phase.strip(),
            payload.responsible.strip(),
            1 if payload.critical else 0,
        ),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "id": ck_id}


@app.post("/api/checklists/reset-shift")
def reset_shift_checklists():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("UPDATE checklists SET complete = 0, completed_by = NULL, completed_at = NULL")
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/occurrences")
def create_occurrence(payload: CreateOccurrencePayload):
    conn = get_conn()
    cur = conn.cursor()
    occ_id = f"oc-{int(time.time())}"
    now = payload.occurred_at or now_br()
    short = short_time()
    status = "Resolvido" if payload.severity == "Controlado" else "Em acompanhamento"

    cur.execute(
        """
        INSERT INTO occurrences (
            id, type, title, area, occurred_at, time_label, severity, status,
            description, response, damage, external_action, lesson, reported_by, checkpoint_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            occ_id,
            payload.type,
            payload.title.strip(),
            payload.area.strip(),
            now,
            short,
            payload.severity,
            status,
            payload.description.strip(),
            payload.response.strip(),
            payload.damage.strip() or "Sem dano identificado",
            payload.external_action.strip() or "Não aplicável",
            payload.lesson.strip(),
            payload.reported_by,
            payload.checkpoint_id,
        ),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "id": occ_id}


@app.patch("/api/occurrences/{occ_id}/status")
def update_occurrence_status(occ_id: str, payload: UpdateOccurrencePayload):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM occurrences WHERE id = ?", (occ_id,))
    occ = cur.fetchone()
    if not occ:
        conn.close()
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada.")

    new_status = payload.status if payload.status is not None else occ["status"]
    new_lesson = payload.lesson if payload.lesson is not None else occ["lesson"]
    new_response = payload.response if payload.response is not None else occ["response"]

    cur.execute(
        "UPDATE occurrences SET status = ?, lesson = ?, response = ? WHERE id = ?",
        (new_status, new_lesson, new_response, occ_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/assets/{asset_id}/verify")
def verify_asset(asset_id: str, payload: VerifyAssetPayload):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM assets WHERE id = ?", (asset_id,))
    asset = cur.fetchone()
    if not asset:
        conn.close()
        raise HTTPException(status_code=404, detail="Ativo patrimonial não encontrado.")

    note = payload.condition_note if payload.condition_note is not None else asset["condition_note"]
    cur.execute(
        """
        UPDATE assets
        SET status = ?, condition_note = ?, last_verified_at = ?, last_verified_by = ?
        WHERE id = ?
        """,
        (payload.status, note, short_time(), payload.verified_by, asset_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/assets")
def create_asset(payload: CreateAssetPayload):
    conn = get_conn()
    cur = conn.cursor()
    ast_id = f"ast-{int(time.time())}"
    cur.execute(
        """
        INSERT INTO assets (
            id, code, name, category, area_name, custodian, status,
            condition_note, last_verified_at, last_verified_by, requires_lock
        ) VALUES (?, ?, ?, ?, ?, ?, 'Conferido', ?, ?, 'Gestor de Segurança', ?)
        """,
        (
            ast_id,
            payload.code.strip().upper(),
            payload.name.strip(),
            payload.category.strip(),
            payload.area_name.strip(),
            payload.custodian.strip(),
            payload.condition_note.strip(),
            short_time(),
            1 if payload.requires_lock else 0,
        ),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "id": ast_id}


# ==================== EQUIPE (CRUD DE PERFIS & ATIVAÇÃO) ====================
@app.post("/api/team")
def create_team_member(payload: TeamMemberPayload):
    conn = get_conn()
    cur = conn.cursor()
    tm_id = f"tm-{int(time.time() * 1000) % 1000000}"
    status = "Em Posto" if payload.active else "Inativo"
    checkin_at = datetime.now().strftime("%H:%M") if payload.active else None

    uname = payload.username.strip().lower() or slugify_username(payload.name.strip())
    raw_pwd = payload.password.strip() or "123456"
    pwd_hash = hash_password(raw_pwd)

    cur.execute(
        """
        INSERT INTO team_members (
            id, name, role, post_area, shift, status, phone_short, checkin_at,
            active, email, notes, username, password_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            tm_id,
            payload.name.strip(),
            payload.role.strip(),
            payload.post_area.strip(),
            payload.shift.strip(),
            status,
            payload.phone_short.strip(),
            checkin_at,
            1 if payload.active else 0,
            payload.email.strip(),
            payload.notes.strip(),
            uname,
            pwd_hash,
        ),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "id": tm_id, "username": uname}


@app.put("/api/team/{member_id}")
def update_team_member(member_id: str, payload: TeamMemberPayload):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM team_members WHERE id = ?", (member_id,))
    member = cur.fetchone()
    if not member:
        conn.close()
        raise HTTPException(status_code=404, detail="Perfil não encontrado.")

    new_active = 1 if payload.active else 0
    new_status = member["status"]
    if not new_active:
        new_status = "Inativo"
    elif new_status == "Inativo":
        new_status = "Pendente"

    uname = payload.username.strip().lower() or (member["username"] or slugify_username(payload.name.strip()))
    pwd_hash = member["password_hash"] or hash_password("123456")
    if payload.password.strip():
        pwd_hash = hash_password(payload.password.strip())

    cur.execute(
        """
        UPDATE team_members
        SET name = ?, role = ?, post_area = ?, shift = ?, phone_short = ?,
            email = ?, notes = ?, active = ?, status = ?, username = ?, password_hash = ?
        WHERE id = ?
        """,
        (
            payload.name.strip(),
            payload.role.strip(),
            payload.post_area.strip(),
            payload.shift.strip(),
            payload.phone_short.strip(),
            payload.email.strip(),
            payload.notes.strip(),
            new_active,
            new_status,
            uname,
            pwd_hash,
            member_id,
        ),
    )

    # Sync member name/role in monthly schedules as well
    cur.execute(
        "UPDATE monthly_schedules SET member_name = ?, member_role = ? WHERE member_id = ?",
        (payload.name.strip(), payload.role.strip(), member_id),
    )

    conn.commit()
    conn.close()
    return {"ok": True}


@app.patch("/api/team/{member_id}/active")
def toggle_team_member_active(member_id: str, payload: ToggleActivePayload):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM team_members WHERE id = ?", (member_id,))
    member = cur.fetchone()
    if not member:
        conn.close()
        raise HTTPException(status_code=404, detail="Perfil não encontrado.")

    current_active = bool(member["active"])
    new_active = (not current_active) if payload.active is None else payload.active
    new_status = "Pendente" if new_active else "Inativo"
    checkin_at = member["checkin_at"] if new_active else None

    cur.execute(
        "UPDATE team_members SET active = ?, status = ?, checkin_at = ? WHERE id = ?",
        (1 if new_active else 0, new_status, checkin_at, member_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "active": new_active, "status": new_status}


@app.delete("/api/team/{member_id}")
def delete_team_member(member_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM team_members WHERE id = ?", (member_id,))
    member = cur.fetchone()
    if not member:
        conn.close()
        raise HTTPException(status_code=404, detail="Perfil não encontrado.")

    cur.execute("DELETE FROM monthly_schedules WHERE member_id = ?", (member_id,))
    cur.execute("DELETE FROM team_members WHERE id = ?", (member_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/team/{member_id}/checkin")
def toggle_team_checkin(member_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM team_members WHERE id = ?", (member_id,))
    member = cur.fetchone()
    if not member:
        conn.close()
        raise HTTPException(status_code=404, detail="Membro da equipe não encontrado.")

    if not member["active"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Ative o perfil antes de confirmar presença em posto.")

    if member["status"] == "Em Posto":
        new_status = "Pendente"
        checkin_at = None
    else:
        new_status = "Em Posto"
        checkin_at = datetime.now().strftime("%H:%M")

    cur.execute(
        "UPDATE team_members SET status = ?, checkin_at = ? WHERE id = ?",
        (new_status, checkin_at, member_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "status": new_status, "checkin_at": checkin_at}


# ==================== ESCALA DO MÊS (MONTHLY SCHEDULES) ====================
@app.post("/api/schedules")
def create_monthly_schedule(payload: CreateSchedulePayload):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT * FROM team_members WHERE id = ?", (payload.member_id,))
    member = cur.fetchone()
    if not member:
        conn.close()
        raise HTTPException(status_code=404, detail="Membro selecionado não encontrado no cadastro da Equipe.")
    if not member["active"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Este perfil está desativado e não pode ser escalado.")

    sc_id = f"sc-{int(time.time() * 1000) % 1000000}"
    date_label = format_date_label(payload.date_iso.strip())

    cur.execute(
        """
        INSERT INTO monthly_schedules (
            id, date_iso, date_label, event_name, shift_time, post_name,
            member_id, member_name, member_role, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            sc_id,
            payload.date_iso.strip(),
            date_label,
            payload.event_name.strip(),
            payload.shift_time.strip(),
            payload.post_name.strip(),
            member["id"],
            member["name"],
            member["role"],
            payload.status.strip(),
            payload.notes.strip(),
        ),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "id": sc_id}


@app.patch("/api/schedules/{schedule_id}/status")
def update_monthly_schedule(schedule_id: str, payload: UpdateSchedulePayload):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM monthly_schedules WHERE id = ?", (schedule_id,))
    sc = cur.fetchone()
    if not sc:
        conn.close()
        raise HTTPException(status_code=404, detail="Registro de escala não encontrado.")

    new_status = payload.status if payload.status is not None else sc["status"]
    new_post = payload.post_name if payload.post_name is not None else sc["post_name"]
    new_notes = payload.notes if payload.notes is not None else sc["notes"]
    member_id = sc["member_id"]
    member_name = sc["member_name"]
    member_role = sc["member_role"]

    if payload.member_id and payload.member_id != sc["member_id"]:
        cur.execute("SELECT * FROM team_members WHERE id = ?", (payload.member_id,))
        m = cur.fetchone()
        if not m:
            conn.close()
            raise HTTPException(status_code=404, detail="Novo membro não encontrado.")
        member_id = m["id"]
        member_name = m["name"]
        member_role = m["role"]

    cur.execute(
        """
        UPDATE monthly_schedules
        SET status = ?, member_id = ?, member_name = ?, member_role = ?, post_name = ?, notes = ?
        WHERE id = ?
        """,
        (new_status, member_id, member_name, member_role, new_post, new_notes, schedule_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/schedules/{schedule_id}")
def delete_monthly_schedule(schedule_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM monthly_schedules WHERE id = ?", (schedule_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def serve_index():
    return FileResponse(str(STATIC_DIR / "index.html"))
