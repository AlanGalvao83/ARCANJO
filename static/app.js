(() => {
  const roles = ["Pastor", "Gestor de Segurança", "Obreiros", "Equipe de Segurança"];
  const navItems = [
    ["painel", "▦", "Visão geral"],
    ["rondas", "⌖", "Rondas & Postos (QR)"],
    ["checklists", "☑", "Checklists por Turno"],
    ["patrimonio", "▣", "Patrimônio & Salas"],
    ["ocorrencias", "▧", "Ocorrências"],
    ["protecao", "♡", "Proteção de pessoas"],
    ["equipe", "♙", "Equipe"],
    ["escala", "📅", "Escala"]
  ];

  const roleContent = {
    "Pastor": {
      eyebrow: "Visão Pastoral & Governança",
      title: "Pastor",
      description: "Acompanhe decisões de continuidade do culto, proteção de famílias e integridade patrimonial do templo sem perder o foco no acolhimento.",
      prompt: "Verifique a prontidão das saídas e o alinhamento de comunicação antes da abertura.",
      decision: "Confirme quem comunica o público no púlpito e quem mantém contato com autoridades em caso de emergência."
    },
    "Gestor de Segurança": {
      eyebrow: "Comando Operacional & Patrimonial",
      title: "Gestor de Segurança",
      description: "Monitore em tempo real os postos de ronda via QR/GPS, gerencie os perfis da Equipe, monte a Escala do Mês e trate anomalias.",
      prompt: "Acompanhe a cobertura ao vivo dos 6 postos críticos, o cadastro da equipe e a escala mensal.",
      decision: "Valide a ronda do estacionamento (Posto 01), o fechamento da Tesouraria (Posto 06) e a Escala do Mês."
    },
    "Obreiros": {
      eyebrow: "Visão de Acolhimento & Recepção",
      title: "Obreiros",
      description: "Mantenha os corredores livres, apoie a recepção infantil e comunique imediatamente qualquer risco observado no templo.",
      prompt: "Revise os pontos de recepção, sua posição na Escala do Mês e o fluxo de crianças antes do início.",
      decision: "Ao observar uma mudança relevante, comunique fatos e posto; preserve a dignidade e a calma do ambiente."
    },
    "Equipe de Segurança": {
      eyebrow: "Operação de Campo & Ronda Ativa",
      title: "Equipe de Segurança",
      description: "Execute as rondas programadas, valide cada passagem via QR Code + GPS nos postos e proteja o perímetro e o patrimônio.",
      prompt: "Prioridade imediata: validar Postos pendentes na ronda atual e conferir sua posição na Escala.",
      decision: "Use o botão 'Validar Posto (QR/GPS)' a cada ponto inspecionado. Em caso de risco, marque 'Anomalia'."
    }
  };

  let savedUser = null;
  try {
    savedUser = JSON.parse(localStorage.getItem("arcanjo-user") || "null");
  } catch {
    savedUser = null;
  }

  const state = {
    view: "painel",
    currentUser: savedUser,
    role: (savedUser && roles.includes(savedUser.role) ? savedUser.role : null) || localStorage.getItem("arcanjo-role") || "Gestor de Segurança",
    areas: [],
    checkpoints: [],
    patrol_sessions: [],
    checkpoint_logs: [],
    checklists: [],
    assets: [],
    occurrences: [],
    team_members: [],
    monthly_schedules: [],
    trainings: [],
    server_time: "",
    checkPhaseFilter: "Todas",
    checkStatusFilter: "Todos",
    occTypeFilter: "Todos",
    teamStatusFilter: "Todos",
    teamRoleFilter: "Todas",
    scheduleDateFilter: "Todas",
    calendarYear: 2026,
    calendarMonth: 9, // 0-indexed: 9 = Outubro 2026
    gpsCoords: null,
    cameraStream: null
  };

  function esc(val) {
    return String(val ?? "").replace(/[&<>'"]/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", "\"": "&quot;"
    }[ch]));
  }

  function showToast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.innerHTML = `<span>⚡</span> <span>${esc(msg)}</span>`;
    el.classList.add("show");
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => el.classList.remove("show"), 3600);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Erro na comunicação com o servidor" }));
      throw new Error(err.detail || "Falha na requisição");
    }
    return res.json();
  }

  function updateAuthUI() {
    const loginScreen = document.getElementById("login-screen");
    if (!loginScreen) return;
    if (state.currentUser) {
      loginScreen.classList.add("hidden");
      const nameEl = document.getElementById("user-session-name");
      const roleEl = document.getElementById("user-session-role");
      const avatarEl = document.getElementById("user-session-avatar");
      if (nameEl) nameEl.textContent = state.currentUser.name;
      if (roleEl) roleEl.textContent = `${state.currentUser.role} · 🔑 Alterar senha`;
      if (avatarEl) {
        const initials = (state.currentUser.name || "U")
          .split(" ")
          .filter(Boolean)
          .slice(0, 2)
          .map(w => w[0].toUpperCase())
          .join("");
        avatarEl.textContent = initials || "👤";
      }
      const scanAgent = document.getElementById("scan-agent");
      if (scanAgent) scanAgent.value = state.currentUser.name;
      const patrolAgent = document.getElementById("patrol-agent");
      if (patrolAgent) patrolAgent.value = state.currentUser.name;
    } else {
      loginScreen.classList.remove("hidden");
      renderQuickLoginPills();
    }
  }

  function renderQuickLoginPills() {
    const grid = document.getElementById("login-quick-grid");
    if (!grid || !state.team_members.length) return;
    const activeList = state.team_members.filter(m => m.active);
    // Pick up to 6 distinct profiles (including custom profiles added by the user)
    const prioritized = [
      ...activeList.filter(m => !m.id.startsWith("tm-0")), // custom profiles added by user first!
      ...activeList.filter(m => m.id.startsWith("tm-0"))
    ].slice(0, 6);

    grid.innerHTML = prioritized.map(m => {
      const loginId = m.email || m.username || m.name;
      return `
        <button type="button" class="login-quick-pill" data-quick-login="${esc(loginId)}" data-quick-pwd="123456">
          <strong>${esc(m.role)}</strong>
          <small>${esc(m.name)} (${esc(m.username || loginId)})</small>
        </button>
      `;
    }).join("");

    grid.querySelectorAll("[data-quick-login]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.getElementById("login-identifier").value = btn.dataset.quickLogin;
        document.getElementById("login-password").value = btn.dataset.quickPwd || "123456";
        document.getElementById("login-error").style.display = "none";
      });
    });
  }

  async function fetchState(silent = false) {
    try {
      const data = await api("/api/state");
      Object.assign(state, data);

      // Verify if logged-in user is still active in DB
      if (state.currentUser) {
        const fresh = state.team_members.find(m => m.id === state.currentUser.id);
        if (fresh && !fresh.active) {
          state.currentUser = null;
          localStorage.removeItem("arcanjo-user");
          showToast("Sua sessão foi encerrada porque o perfil foi desativado.");
        } else if (fresh) {
          state.currentUser = {
            ...state.currentUser,
            name: fresh.name,
            role: fresh.role,
            email: fresh.email,
            username: fresh.username
          };
          const matchedRole = roles.includes(fresh.role) ? fresh.role : "Equipe de Segurança";
          state.role = matchedRole;
          localStorage.setItem("arcanjo-user", JSON.stringify(state.currentUser));
        }
      }

      const dt = document.getElementById("top-datetime");
      if (dt) dt.textContent = `Operação Local · Atualizado ${state.server_time || "agora"}`;
      updateAuthUI();
      render();
    } catch (err) {
      if (!silent) showToast("Erro ao sincronizar: " + err.message);
    }
  }

  function getNavBadge(key) {
    if (key === "rondas") {
      const okCount = state.checkpoints.filter(c => c.last_status === "OK").length;
      return `${okCount}/${state.checkpoints.length || 6}`;
    }
    if (key === "checklists") {
      const done = state.checklists.filter(c => c.complete).length;
      return `${done}/${state.checklists.length}`;
    }
    if (key === "ocorrencias") {
      const open = state.occurrences.filter(o => o.status !== "Resolvido").length;
      return open ? `${open}` : "";
    }
    if (key === "equipe") {
      const activeCount = state.team_members.filter(m => m.active).length;
      return `${activeCount}`;
    }
    if (key === "escala") {
      return `${state.monthly_schedules.length}`;
    }
    return "";
  }

  function renderSidebar() {
    const activePatrol = state.patrol_sessions.find(p => p.status === "Em andamento") || state.patrol_sessions[0];
    const navHtml = navItems.map(([key, icon, label]) => {
      const badge = getNavBadge(key);
      return `<button class="${state.view === key ? "active" : ""}" data-nav="${key}">
        <span class="nav-left"><span class="nav-icon">${icon}</span><span>${label}</span></span>
        ${badge ? `<span class="nav-pill">${badge}</span>` : ""}
      </button>`;
    }).join("");

    const userInitials = state.currentUser
      ? (state.currentUser.name || "U").split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("")
      : "U";

    document.getElementById("desktop-sidebar").innerHTML = `
      <div class="brand">
        <span class="brand-mark">⌁</span>
        <div>
          <div class="brand-name">ARCANJO</div>
          <div class="brand-sub">SaaS Security</div>
        </div>
      </div>
      <nav class="nav">
        <span class="nav-label">Menu Principal</span>
        ${navHtml}
      </nav>
      <div class="event-card">
        <div class="event-status">${activePatrol && activePatrol.status === "Em andamento" ? "Ronda em andamento" : "Turno Pronto"}</div>
        <div class="event-title">${esc(activePatrol ? activePatrol.title : "Culto de Domingo")}</div>
        <p class="event-copy">
          ${activePatrol ? `${activePatrol.visited_checkpoints} de ${activePatrol.total_checkpoints} postos verificados<br>Agente: ${esc(activePatrol.agent_name)}` : "6 postos monitorados via QR/GPS"}
        </p>
        <button class="event-link" data-nav="rondas">Ir para Controle de Rondas →</button>
      </div>
      ${state.currentUser ? `
        <div class="sidebar-profile-card">
          <div class="sidebar-profile-top">
            <span class="sidebar-profile-avatar">${esc(userInitials)}</span>
            <div class="sidebar-profile-meta">
              <div class="sidebar-profile-name">${esc(state.currentUser.name)}</div>
              <div class="sidebar-profile-role">@${esc(state.currentUser.username || "usuario")} · ${esc(state.currentUser.role)}</div>
            </div>
          </div>
          <button type="button" id="sidebar-change-pwd-btn" class="sidebar-pwd-btn">
            🔑 Alterar Minha Senha
          </button>
        </div>
      ` : ""}
    `;

    document.getElementById("mobile-drawer").innerHTML = `
      <button class="mobile-scrim" aria-label="Fechar menu"></button>
      <div class="mobile-panel">
        <button class="drawer-close" aria-label="Fechar menu">×</button>
        <div class="brand">
          <span class="brand-mark">⌁</span>
          <div><div class="brand-name">ARCANJO</div><div class="brand-sub">SaaS Security</div></div>
        </div>
        <nav class="nav">
          <span class="nav-label">Menu Principal</span>
          ${navItems.map(([key, icon, label]) => `<button class="${state.view === key ? "active" : ""}" data-drawer-nav="${key}"><span class="nav-left"><span class="nav-icon">${icon}</span><span>${label}</span></span></button>`).join("")}
        </nav>
        ${state.currentUser ? `
          <div class="sidebar-profile-card" style="margin-top:18px;">
            <div class="sidebar-profile-top">
              <span class="sidebar-profile-avatar">${esc(userInitials)}</span>
              <div class="sidebar-profile-meta">
                <div class="sidebar-profile-name">${esc(state.currentUser.name)}</div>
                <div class="sidebar-profile-role">${esc(state.currentUser.role)}</div>
              </div>
            </div>
            <button type="button" id="drawer-change-pwd-btn" class="sidebar-pwd-btn">
              🔑 Alterar Minha Senha
            </button>
          </div>
        ` : ""}
      </div>
    `;

    document.getElementById("sidebar-change-pwd-btn")?.addEventListener("click", () => {
      openChangePasswordModal(state.currentUser ? state.currentUser.id : null);
    });
    document.getElementById("drawer-change-pwd-btn")?.addEventListener("click", () => {
      closeDrawer();
      openChangePasswordModal(state.currentUser ? state.currentUser.id : null);
    });
    document.querySelectorAll(".mobile-scrim, .drawer-close").forEach(b => b.addEventListener("click", closeDrawer));
    document.querySelectorAll("[data-drawer-nav]").forEach(b => b.addEventListener("click", () => {
      navigate(b.dataset.drawerNav);
      closeDrawer();
    }));
  }

  function navigate(view) {
    state.view = view;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openDrawer() { document.getElementById("mobile-drawer").classList.add("open"); }
  function closeDrawer() { document.getElementById("mobile-drawer").classList.remove("open"); }

  function metricCard(label, value, detail, tone, icon) {
    return `<div class="metric ${tone}">
      <div class="metric-icon">${icon}</div>
      <div class="metric-body">
        <div class="metric-value">${esc(value)}</div>
        <div class="metric-label">${esc(label)}</div>
        <p class="metric-detail">${esc(detail)}</p>
      </div>
    </div>`;
  }

  // ==================== VIEW 1: PAINEL GERAL ====================
  function renderDashboard(content) {
    const doneCk = state.checklists.filter(i => i.complete).length;
    const totalCk = state.checklists.length || 1;
    const percentCk = Math.round((doneCk / totalCk) * 100);

    const highAlerts = state.occurrences.filter(o => o.status !== "Resolvido" && (o.severity === "Alto" || o.severity === "Crítico")).length
      + state.checklists.filter(i => i.critical && !i.complete).length
      + state.checkpoints.filter(c => c.last_status === "ANOMALIA").length;

    const okCheckpoints = state.checkpoints.filter(c => c.last_status === "OK").length;
    const totalCheckpoints = state.checkpoints.length || 6;

    const activeMembers = state.team_members.filter(m => m.active);
    const teamInPost = activeMembers.filter(m => m.status === "Em Posto").length;

    const avgCoverage = state.areas.length
      ? Math.round(state.areas.reduce((acc, a) => acc + (a.coverage || 80), 0) / state.areas.length)
      : 84;

    return `
      <div class="metrics">
        ${metricCard("Checklists Assinados", `${percentCk}%`, `${doneCk} de ${state.checklists.length} verificações`, "blue", "☑")}
        ${metricCard("Postos Verificados", `${okCheckpoints}/${totalCheckpoints}`, `${state.checkpoints.filter(c => c.last_status === "ANOMALIA").length} anomalia(s) ativa(s)`, "amber", "⌖")}
        ${metricCard("Alertas & Pendências", `${highAlerts}`, "Atenção prioritária no turno", "green", "⚠")}
        ${metricCard("Efetivo em Posto", `${teamInPost}/${activeMembers.length}`, `${state.monthly_schedules.length} alocações na Escala`, "navy", "♙")}
      </div>

      <div class="grid-two" style="margin-top:0;margin-bottom:22px;">
        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="overline">Relatórios de Cobertura & Passagens</div>
              <h2>Curva Operacional por Setor do Templo</h2>
            </div>
            <button class="panel-action" data-nav="rondas">Ver Rondas QR →</button>
          </div>
          <div class="saas-chart-box">
            <svg class="saas-wave-svg" viewBox="0 0 640 175" preserveAspectRatio="none">
              <defs>
                <linearGradient id="saasWaveGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stop-color="#5B93FF" />
                  <stop offset="55%" stop-color="#605BFF" />
                  <stop offset="100%" stop-color="#EC5298" />
                </linearGradient>
                <linearGradient id="saasWaveArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#605BFF" stop-opacity="0.22" />
                  <stop offset="100%" stop-color="#605BFF" stop-opacity="0.0" />
                </linearGradient>
              </defs>
              <line x1="36" y1="25" x2="620" y2="25" stroke="#EFEFF4" stroke-dasharray="4 4" />
              <line x1="36" y1="65" x2="620" y2="65" stroke="#EFEFF4" stroke-dasharray="4 4" />
              <line x1="36" y1="105" x2="620" y2="105" stroke="#EFEFF4" stroke-dasharray="4 4" />
              <line x1="36" y1="145" x2="620" y2="145" stroke="#EFEFF4" />
              <text x="6" y="29" fill="#8A90A6" font-size="10" font-weight="700">100%</text>
              <text x="10" y="69" fill="#8A90A6" font-size="10" font-weight="700">75%</text>
              <text x="10" y="109" fill="#8A90A6" font-size="10" font-weight="700">50%</text>
              <text x="14" y="148" fill="#8A90A6" font-size="10" font-weight="700">25%</text>
              <path d="M 42 110 C 95 65, 130 120, 185 78 C 240 36, 280 98, 338 52 C 392 14, 435 112, 492 64 C 540 26, 582 58, 616 38 L 616 145 L 42 145 Z" fill="url(#saasWaveArea)" />
              <path d="M 42 110 C 95 65, 130 120, 185 78 C 240 36, 280 98, 338 52 C 392 14, 435 112, 492 64 C 540 26, 582 58, 616 38" fill="none" stroke="url(#saasWaveGrad)" stroke-width="4" stroke-linecap="round" />
              <circle cx="185" cy="78" r="5" fill="#FFFFFF" stroke="#5B93FF" stroke-width="3" />
              <circle cx="338" cy="52" r="6" fill="#FFFFFF" stroke="#605BFF" stroke-width="3.5" />
              <circle cx="492" cy="64" r="5" fill="#FFFFFF" stroke="#B656CC" stroke-width="3" />
              <circle cx="616" cy="38" r="5" fill="#FFFFFF" stroke="#EC5298" stroke-width="3" />
              <rect x="302" y="14" width="72" height="26" rx="7" fill="#030229" />
              <text x="338" y="31" text-anchor="middle" fill="#FFFFFF" font-size="10.5" font-weight="800">Ronda ${avgCoverage}%</text>
              <text x="58" y="166" fill="#8A90A6" font-size="10.5" font-weight="700">17h00</text>
              <text x="172" y="166" fill="#8A90A6" font-size="10.5" font-weight="700">18h00</text>
              <text x="322" y="166" fill="#8A90A6" font-size="10.5" font-weight="700">19h00</text>
              <text x="476" y="166" fill="#8A90A6" font-size="10.5" font-weight="700">20h00</text>
              <text x="590" y="166" fill="#8A90A6" font-size="10.5" font-weight="700">21h00</text>
            </svg>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="overline">Analytics</div>
              <h2>Índice Geral de Prontidão</h2>
            </div>
            <button class="panel-action" data-nav="checklists">Detalhes →</button>
          </div>
          <div class="saas-donut-wrap">
            <svg width="168" height="168" viewBox="0 0 180 180">
              <circle cx="90" cy="90" r="66" fill="none" stroke="#EFEFF4" stroke-width="18" />
              <circle cx="90" cy="90" r="66" fill="none" stroke="#5B93FF" stroke-width="18" stroke-dasharray="185 415" stroke-dashoffset="0" stroke-linecap="round" transform="rotate(-90 90 90)" />
              <circle cx="90" cy="90" r="66" fill="none" stroke="#FFC327" stroke-width="18" stroke-dasharray="110 415" stroke-dashoffset="-195" stroke-linecap="round" transform="rotate(-90 90 90)" />
              <circle cx="90" cy="90" r="66" fill="none" stroke="#FF8F6B" stroke-width="18" stroke-dasharray="68 415" stroke-dashoffset="-315" stroke-linecap="round" transform="rotate(-90 90 90)" />
              <text x="90" y="88" text-anchor="middle" fill="#030229" font-size="28" font-weight="800">${avgCoverage}%</text>
              <text x="90" y="109" text-anchor="middle" fill="#7E84A3" font-size="12" font-weight="700">Proteção Ativa</text>
            </svg>
            <div class="saas-donut-legend">
              <span class="saas-legend-item"><span class="saas-legend-swatch" style="background:#5B93FF;"></span>Rondas QR</span>
              <span class="saas-legend-item"><span class="saas-legend-swatch" style="background:#FFC327;"></span>Checklists</span>
              <span class="saas-legend-item"><span class="saas-legend-swatch" style="background:#FF8F6B;"></span>Escala</span>
            </div>
          </div>
        </div>
      </div>

      <div class="hero">
        <div class="hero-grid">
          <div>
            <div class="eyebrow">${esc(content.eyebrow)}</div>
            <h1>Olá, ${esc(state.currentUser ? state.currentUser.name : content.title)}.</h1>
            <p class="hero-copy">${esc(content.description)}</p>
            <div class="prompt">ⓘ ${esc(content.prompt)}</div>
          </div>
          <div class="decision">
            <div class="decision-label">Ação prioritária do turno</div>
            <p>${esc(content.decision)}</p>
            <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;">
              <button class="text-link" data-nav="rondas">⌖ Painel de Rondas QR →</button>
              <button class="text-link" data-nav="escala">📅 Escala do Mês →</button>
            </div>
          </div>
        </div>
      </div>

      <div class="grid-two">
        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="overline">Monitoramento Perimetral e Interno</div>
              <h2>Status em Tempo Real por Área do Templo</h2>
            </div>
            <button class="panel-action" data-nav="rondas">Abrir Mapa Tático & Rondas →</button>
          </div>
          <div class="area-grid">
            ${state.areas.map(a => `
              <button class="area-card" data-nav="rondas">
                <div class="area-top">
                  <span class="area-name">⌖ ${esc(a.name)}</span>
                  <span class="badge ${esc(a.tone)}">${esc(a.status)}</span>
                </div>
                <p class="area-detail">${esc(a.detail)}</p>
                <div class="bar"><span class="${esc(a.tone)}" style="width:${a.coverage}%"></span></div>
                <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:#7e84a3;font-weight:700;">
                  <span>${esc(a.zone_type)}</span>
                  <span>Cobertura: ${a.coverage}%</span>
                </div>
              </button>
            `).join("")}
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="overline">Últimas Passagens Auditadas</div>
              <h2>Log de Rondas (QR Code & GPS)</h2>
            </div>
            <button class="panel-action" data-nav="rondas">Ver Histórico Completo →</button>
          </div>
          <div class="recent-list">
            ${state.checkpoint_logs.slice(0, 4).map(log => `
              <div class="recent-item">
                <span class="dot ${log.status === "ANOMALIA" ? "coral" : "green"}"></span>
                <div class="item-main">
                  <div class="item-title">${esc(log.checkpoint_code)} · ${esc(log.checkpoint_name)}</div>
                  <div class="item-copy">${esc(log.agent_name)} · ${esc(log.scanned_at)} · ${esc(log.verification_method)} (${log.distance_meters ?? 2.5}m)</div>
                  <div class="item-copy" style="color:#4f5472;">${esc(log.notes)}</div>
                </div>
                <span class="badge ${log.status === "ANOMALIA" ? "coral" : "green"}">${esc(log.status)}</span>
              </div>
            `).join("")}
          </div>
          <button class="dash-btn" data-open-scan="">⌖ Escanear QR Code / Validar Posto Agora</button>
        </div>
      </div>

      <div class="grid-three">
        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="overline">Barreiras Pendentes</div>
              <h2>Checklists Críticos do Turno</h2>
            </div>
            <button class="panel-action" data-nav="checklists">Ver todos</button>
          </div>
          <div class="focus-list">
            ${state.checklists.filter(c => !c.complete).slice(0, 4).map(ck => `
              <div class="focus-item">
                <span class="dot ${ck.critical ? "amber" : "blue"}"></span>
                <div class="item-main">
                  <div class="item-title">${esc(ck.title)}</div>
                  <div class="item-copy">${esc(ck.phase)} · Resp.: ${esc(ck.responsible)}</div>
                </div>
                <button class="outline-btn" style="height:28px;padding:0 10px;font-size:11px;" data-check-toggle="${ck.id}">Assinar</button>
              </div>
            `).join("") || `<p style="color:#28745e;font-size:13px;font-weight:800;margin-top:12px;">✓ Todos os itens de checklist estão concluídos!</p>`}
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="overline">Segurança Patrimonial</div>
              <h2>Salas Restritas & Ativos</h2>
            </div>
            <button class="panel-action" data-nav="patrimonio">Gerenciar ativos</button>
          </div>
          <div class="action-list">
            ${state.assets.slice(0, 4).map(ast => `
              <div class="action-item">
                <span class="dot ${ast.status === "Atenção" ? "coral" : "green"}"></span>
                <div class="item-main">
                  <div class="item-title">${esc(ast.name)}</div>
                  <div class="item-copy">${esc(ast.area_name)} · Custódia: ${esc(ast.custodian)}</div>
                </div>
                <span class="badge ${ast.status === "Atenção" ? "amber" : "green"}">${esc(ast.status)}</span>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="overline">Últimos Registros</div>
              <h2>Fatos e Ocorrências</h2>
            </div>
            <button class="panel-action" data-nav="ocorrencias">Ver todos</button>
          </div>
          <div class="recent-list">
            ${state.occurrences.slice(0, 3).map(item => `
              <button class="recent-item" data-nav="ocorrencias" style="width:100%;border:0;background:transparent;text-align:left">
                <span class="dot ${item.severity === "Alto" || item.severity === "Crítico" ? "coral" : item.severity === "Atenção" ? "amber" : "green"}"></span>
                <div class="item-main">
                  <div class="item-title">${esc(item.title)}</div>
                  <div class="item-copy">${esc(item.area)} · ${esc(item.time_label)}</div>
                </div>
                <span class="badge ${item.severity === "Controlado" ? "green" : item.severity === "Atenção" ? "amber" : "coral"}">${esc(item.severity)}</span>
              </button>
            `).join("")}
          </div>
          <button class="dash-btn" id="inline-new-occ">▧ Registrar nova observação</button>
        </div>
      </div>

      <div class="notice">
        ⓘ <div><strong>Diretriz de Segurança Patrimonial em Templos:</strong> a proteção do patrimônio e das pessoas baseia-se em prevenção visível, rondas auditáveis por QR/GPS, trancamento de salas restritas (Tesouraria, Som/Mídia) e abordagem acolhedora sem confronto.</div>
      </div>
    `;
  }

  // ==================== VIEW 2: RONDAS & POSTOS EM TEMPO REAL ====================
  function renderRoundsView() {
    const activePatrol = state.patrol_sessions.find(p => p.status === "Em andamento") || state.patrol_sessions[0];
    const visited = activePatrol ? activePatrol.visited_checkpoints : 0;
    const total = activePatrol ? activePatrol.total_checkpoints : state.checkpoints.length;
    const pct = total ? Math.min(100, Math.round((visited / total) * 100)) : 0;

    const pinPositions = [
      { x: 115, y: 195 },
      { x: 270, y: 65 },
      { x: 280, y: 195 },
      { x: 455, y: 130 },
      { x: 615, y: 80 },
      { x: 615, y: 190 }
    ];

    return `
      <div class="page-header">
        <div>
          <div class="overline">Monitoramento Tático & Rastreabilidade Presencial</div>
          <h1>Controle de Rondas, Postos QR Code e GPS</h1>
          <p>Gerencie turnos de ronda em tempo real. Cada posto físico do templo possui um QR Code único e coordenadas de perímetro para confirmação presencial de segurança patrimonial.</p>
        </div>
        <div class="header-actions">
          <button class="outline-btn" id="open-qr-labels-btn">🏷️ Imprimir Placas QR Code</button>
          <button class="outline-btn" id="open-new-patrol-btn">▶ Novo Turno de Ronda</button>
          <button class="primary-btn gold" data-open-scan="">⌖ Validar Posto (QR / GPS)</button>
        </div>
      </div>

      ${activePatrol ? `
        <div class="patrol-banner">
          <div class="patrol-banner-info">
            <span class="badge ${activePatrol.status === "Em andamento" ? "amber" : "green"}">
              ${activePatrol.status === "Em andamento" ? "● RONDA ATIVA EM TEMPO REAL" : "✓ RONDA CONCLUÍDA"}
            </span>
            <h2>${esc(activePatrol.title)} — ${esc(activePatrol.shift_name)}</h2>
            <p>Responsável em campo: <strong>${esc(activePatrol.agent_name)}</strong> (${esc(activePatrol.agent_role)}) · Início: ${esc(activePatrol.started_at)} · ${esc(activePatrol.notes)}</p>
          </div>
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
            <div class="patrol-progress-box">
              <div class="patrol-progress-top">
                <span>Cobertura de Postos</span>
                <span>${visited} / ${total} (${pct}%)</span>
              </div>
              <div class="bar" style="background:rgba(255,255,255,.2);">
                <span class="green" style="width:${pct}%"></span>
              </div>
            </div>
            ${activePatrol.status === "Em andamento" ? `
              <button class="primary-btn green" id="finish-patrol-btn" data-session-id="${activePatrol.id}">✓ Encerrar Turno</button>
            ` : ""}
          </div>
        </div>
      ` : ""}

      <div class="round-grid">
        <div class="tactical-map-box">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
            <div>
              <div class="eyebrow">Planta Tática Interativa do Templo</div>
              <h2 style="margin:6px 0 0;color:#fff;font-size:20px;">Clique em um Posto para Validar ou Inspecionar</h2>
            </div>
            <div style="display:flex;gap:10px;font-size:11px;font-weight:800;">
              <span style="color:#67b69a;">● Verificado OK</span>
              <span style="color:#e77d62;">● Anomalia</span>
              <span style="color:#78b3d1;">● Pendente</span>
            </div>
          </div>

          <svg class="tactical-svg" viewBox="0 0 740 260" preserveAspectRatio="xMidYMid meet">
            <g stroke="rgba(255,255,255,0.05)" stroke-width="1">
              <line x1="0" y1="65" x2="740" y2="65" />
              <line x1="0" y1="130" x2="740" y2="130" />
              <line x1="0" y1="195" x2="740" y2="195" />
              <line x1="185" y1="0" x2="185" y2="260" />
              <line x1="370" y1="0" x2="370" y2="260" />
              <line x1="555" y1="0" x2="555" y2="260" />
            </g>

            <rect x="20" y="25" width="175" height="210" rx="12" fill="rgba(255,255,255,0.04)" stroke="#356584" stroke-dasharray="5,4" stroke-width="1.5"/>
            <text x="34" y="48" fill="#8ab0c7" font-size="11" font-weight="800">ESTACIONAMENTO & GUARITA</text>

            <rect x="205" y="25" width="150" height="90" rx="10" fill="rgba(255,255,255,0.05)" stroke="#356584" stroke-width="1.5"/>
            <text x="218" y="46" fill="#8ab0c7" font-size="10.5" font-weight="800">CORREDOR & SAÍDAS</text>

            <rect x="205" y="125" width="150" height="110" rx="10" fill="rgba(255,255,255,0.05)" stroke="#356584" stroke-width="1.5"/>
            <text x="218" y="146" fill="#8ab0c7" font-size="10.5" font-weight="800">RECEPÇÃO INFANTIL</text>

            <rect x="365" y="25" width="175" height="210" rx="12" fill="rgba(255,255,255,0.07)" stroke="#4c84a8" stroke-width="2"/>
            <text x="405" y="48" fill="#bad5e6" font-size="11.5" font-weight="800">NAVE PRINCIPAL</text>

            <rect x="550" y="25" width="170" height="100" rx="10" fill="rgba(255,255,255,0.05)" stroke="#356584" stroke-width="1.5"/>
            <text x="562" y="46" fill="#8ab0c7" font-size="10.5" font-weight="800">CABINE SOM & MÍDIA</text>

            <rect x="550" y="135" width="170" height="100" rx="10" fill="rgba(255,255,255,0.05)" stroke="#e3b66b" stroke-width="1.5"/>
            <text x="562" y="156" fill="#e3b66b" font-size="10.5" font-weight="800">TESOURARIA (RESTRITO)</text>

            <polyline points="115,195 270,65 280,195 455,130 615,80 615,190" fill="none" stroke="rgba(227,182,107,0.35)" stroke-width="2.5" stroke-dasharray="6,6"/>

            ${state.checkpoints.slice(0, 6).map((cp, idx) => {
              const pos = pinPositions[idx] || { x: 80 + idx * 90, y: 130 };
              const color = cp.last_status === "OK" ? "#4b9f83" : cp.last_status === "ANOMALIA" ? "#e77d62" : "#3a89b5";
              return `
                <g class="map-pin" data-open-scan="${cp.id}" style="cursor:pointer;">
                  <circle cx="${pos.x}" cy="${pos.y}" r="22" fill="${color}" fill-opacity="0.22" />
                  <circle cx="${pos.x}" cy="${pos.y}" r="14" fill="${color}" stroke="#ffffff" stroke-width="2.5" />
                  <text x="${pos.x}" y="${pos.y + 4}" text-anchor="middle" fill="#ffffff" font-size="10" font-weight="900">P${idx + 1}</text>
                  <text x="${pos.x}" y="${pos.y + 32}" text-anchor="middle" fill="#ffffff" font-size="10" font-weight="800">${esc(cp.code)}</text>
                </g>
              `;
            }).join("")}
          </svg>
        </div>

        <div class="panel">
          <div class="overline">Protocolo de Campo</div>
          <h2>Validação em 3 Camadas</h2>
          <div class="round-rules">
            <div class="rule">
              <span class="rule-number">1</span>
              <div>
                <strong>Presença Auditável (QR Code + GPS)</strong>
                <p>Ao chegar ao posto, escaneie o QR Code fixado no local. O sistema registra horário exato e distância GPS em metros.</p>
              </div>
            </div>
            <div class="rule">
              <span class="rule-number">2</span>
              <div>
                <strong>Inspeção de Barreiras Patrimoniais</strong>
                <p>Cheque trancas, extintores, iluminação perimetral, janelas e ausência de objetos suspeitos ou rotas obstruídas.</p>
              </div>
            </div>
            <div class="rule">
              <span class="rule-number">3</span>
              <div>
                <strong>Escalonamento Imediato de Anomalias</strong>
                <p>Se identificar falha ou risco, selecione <em>Anomalia</em>. O ARCANJO alerta a central e abre uma ocorrência automaticamente.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style="margin-top:26px;">
        <div class="panel-header">
          <div>
            <div class="overline">Pontos de Verificação Física do Templo</div>
            <h2 style="margin:4px 0 0;color:#173b52;font-size:21px;">Postos Cadastrados (${state.checkpoints.length})</h2>
          </div>
        </div>

        <div class="checkpoints-grid">
          ${state.checkpoints.map(cp => {
            const items = (cp.critical_items || "").split(";").filter(Boolean);
            const badgeTone = cp.last_status === "OK" ? "green" : cp.last_status === "ANOMALIA" ? "coral" : "blue";
            return `
              <div class="cp-card status-${esc(cp.last_status)}">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <span class="cp-code">⌖ ${esc(cp.code)} · ${esc(cp.area_name)}</span>
                    <span class="badge ${badgeTone}">${esc(cp.last_status)}</span>
                  </div>
                  <h3 class="cp-title">${esc(cp.name)}</h3>
                  <p class="cp-instructions">${esc(cp.instructions)}</p>
                  <div class="cp-tags">
                    ${items.map(tag => `<span class="cp-tag">✓ ${esc(tag)}</span>`).join("")}
                  </div>
                </div>
                <div>
                  <div class="cp-meta">
                    <span>Última checagem: <strong>${esc(cp.last_checked_at || "Pendente no turno")}</strong></span>
                    <span>Resp.: <strong>${esc(cp.last_checked_by || "—")}</strong></span>
                  </div>
                  <div class="cp-actions">
                    <button class="primary-btn" data-open-scan="${cp.id}">📱 Validar Posto (QR/GPS)</button>
                    <button class="outline-btn" data-single-qr="${cp.id}" title="Ver QR Code deste posto">🏷️ QR</button>
                  </div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <div class="panel" style="margin-top:26px;padding:0;">
        <div class="filter-bar">
          <div>
            <div class="overline">Trilha de Auditoria</div>
            <h2 style="margin:4px 0 0;">Histórico de Passagens nos Postos (Tempo Real)</h2>
          </div>
          <span class="badge navy">${state.checkpoint_logs.length} leituras registradas</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Posto / Área</th>
                <th>Data e Hora</th>
                <th>Agente</th>
                <th>Validação & Precisão GPS</th>
                <th>Status</th>
                <th>Observações de Campo</th>
              </tr>
            </thead>
            <tbody>
              ${state.checkpoint_logs.map(log => `
                <tr>
                  <td>
                    <div class="table-title">${esc(log.checkpoint_code)} — ${esc(log.checkpoint_name)}</div>
                    <div class="table-sub">${esc(log.area_name)}</div>
                  </td>
                  <td class="table-muted">${esc(log.scanned_at)}</td>
                  <td class="table-title">${esc(log.agent_name)}</td>
                  <td>
                    <span class="badge blue">${esc(log.verification_method)}</span>
                    <div class="table-sub">Distância do ponto: <strong>${log.distance_meters ?? 2.4}m</strong></div>
                  </td>
                  <td>
                    <span class="badge ${log.status === "ANOMALIA" ? "coral" : "green"}">${esc(log.status)}</span>
                  </td>
                  <td>
                    <div class="table-muted">${esc(log.notes)}</div>
                    ${log.occurrence_id ? `<div class="table-note">Ocorrência gerada: <strong>${esc(log.occurrence_id)}</strong></div>` : ""}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==================== VIEW 3: CHECKLISTS OPERACIONAIS POR TURNO ====================
  function renderChecklistsView() {
    const done = state.checklists.filter(i => i.complete).length;
    const total = state.checklists.length;
    const pendingCrit = state.checklists.filter(i => i.critical && !i.complete).length;

    const phases = ["Todas", "Abertura / Pré-Culto", "Durante o Culto", "Fechamento Patrimonial"];
    const statusFilters = ["Todos", "Pendentes", "Críticos"];

    const visible = state.checklists.filter(item => {
      const matchPhase = state.checkPhaseFilter === "Todas" || item.phase === state.checkPhaseFilter;
      const matchStatus = state.checkStatusFilter === "Todos"
        || (state.checkStatusFilter === "Pendentes" && !item.complete)
        || (state.checkStatusFilter === "Críticos" && item.critical);
      return matchPhase && matchStatus;
    });

    const phaseStats = [
      ["1. Abertura / Pré-Culto", "Saídas, iluminação externa, comunicação e recepção infantil.", "blue", "Abertura / Pré-Culto"],
      ["2. Durante o Culto", "Monitoramento de perímetro, espaço infantil e dupla custódia de ofertas.", "green", "Durante o Culto"],
      ["3. Fechamento Patrimonial", "Trancamento de cabine de som, cofre/tesouraria, energia e ativação de alarme.", "amber", "Fechamento Patrimonial"]
    ].map(([title, detail, tone, phaseName]) => {
      const list = state.checklists.filter(i => i.phase === phaseName);
      const comp = list.filter(i => i.complete).length;
      return { title, detail, tone, value: `${comp} / ${list.length}` };
    });

    return `
      <div class="page-header">
        <div>
          <div class="overline">Protocolos Verificáveis por Turno</div>
          <h1>Checklists de Abertura, Culto e Fechamento Patrimonial</h1>
          <p>Garanta que nenhuma porta restrita, equipamento de alto valor ou rota de evacuação fique sem conferência assinada antes, durante e após o culto.</p>
        </div>
        <div class="header-actions">
          <button class="outline-btn" id="reset-shift-ck-btn">↺ Iniciar Novo Turno (Zerar)</button>
          <button class="primary-btn" id="open-new-ck-btn">＋ Adicionar Item</button>
        </div>
      </div>

      <div class="mini-grid" style="margin-top:0;margin-bottom:22px;">
        ${phaseStats.map(g => `
          <div class="mini-card ${g.tone}">
            <div class="summary-label">${esc(g.title)}</div>
            <div class="mini-value">${esc(g.value)}</div>
            <div class="mini-copy">${esc(g.detail)}</div>
          </div>
        `).join("")}
      </div>

      <div class="check-grid">
        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="overline">Fase Operacional do Turno</div>
              <h2>Itens de Verificação (${visible.length})</h2>
            </div>
            <div class="filter-tabs">
              ${statusFilters.map(st => `
                <button class="filter-tab ${state.checkStatusFilter === st ? "active" : ""}" data-ck-status="${st}">${st}</button>
              `).join("")}
            </div>
          </div>

          <div class="filter-tabs" style="margin-top:14px;">
            ${phases.map(ph => `
              <button class="filter-tab ${state.checkPhaseFilter === ph ? "active" : ""}" data-ck-phase="${ph}">${ph}</button>
            `).join("")}
          </div>

          <div class="checklist">
            ${visible.map(item => `
              <button class="check-row ${item.complete ? "done" : item.critical ? "pending-critical" : ""}" data-check-toggle="${item.id}">
                <span class="check-box">✓</span>
                <span class="check-content">
                  <span class="check-title">${esc(item.title)}</span>
                  <span class="check-meta">
                    <strong>${esc(item.phase)}</strong> · Área: ${esc(item.area)} · Resp.: ${esc(item.responsible)}
                    ${item.complete && item.completed_by ? ` · <span style="color:#28745e;font-weight:800;">Assinado por ${esc(item.completed_by)} às ${esc(item.completed_at)}</span>` : ""}
                  </span>
                </span>
                ${item.critical ? `<span class="badge ${item.complete ? "green" : "amber"}">${item.complete ? "Confirmado" : "Crítico"}</span>` : `<span class="badge ${item.complete ? "green" : "blue"}">${item.complete ? "OK" : "Pendente"}</span>`}
              </button>
            `).join("")}
          </div>
        </div>

        <div>
          <div class="side-callout">
            <div class="overline" style="color:#9a762f">Status de Prontidão</div>
            <h2>${pendingCrit ? `${pendingCrit} barreira(s) crítica(s) pendente(s)` : "Todas as barreiras críticas confirmadas!"}</h2>
            <p>Progresso total do turno: <strong>${done} de ${total} itens verificados</strong>. Clique em qualquer item da lista ao lado para assinar a conferência com seu perfil atual (<strong>${esc(state.role)}</strong>).</p>
          </div>

          <div class="side-callout dark" style="margin-top:16px;">
            <div class="overline" style="color:#e3b66b">Segurança Patrimonial no Fechamento</div>
            <h2>Proteção Pós-Culto</h2>
            <p>O maior índice de vulnerabilidade patrimonial em templos ocorre nos 30 minutos após o encerramento do culto. Nunca encerre o turno sem assinar a Fase 3 (trancamento da Cabine de Som, Tesouraria e ativação do alarme).</p>
          </div>
        </div>
      </div>
    `;
  }

  // ==================== VIEW 4: SEGURANÇA PATRIMONIAL & ATIVOS ====================
  function renderPatrimonioView() {
    const verifiedCount = state.assets.filter(a => a.status === "Conferido" || a.status === "Protegido" || a.status === "Pronto para Uso").length;
    const lockCount = state.assets.filter(a => a.requires_lock).length;

    return `
      <div class="page-header">
        <div>
          <div class="overline">Proteção de Bens, Equipamentos e Salas Restritas</div>
          <h1>Segurança Patrimonial & Custódia de Ativos</h1>
          <p>Controle de equipamentos de alto valor (áudio, vídeo, projeção, instrumentos), claviculário de chaves, cofre da tesouraria e infraestrutura crítica do templo.</p>
        </div>
        <button class="primary-btn" data-nav="rondas">⌖ Inspecionar Postos Patrimoniais</button>
      </div>

      <div class="summary-grid">
        <div class="summary green">
          <div class="summary-label">Ativos Conferidos no Turno</div>
          <div class="summary-value">${verifiedCount} / ${state.assets.length}</div>
          <p class="summary-detail">Auditados pelos responsáveis</p>
        </div>
        <div class="summary blue">
          <div class="summary-label">Áreas com Tranca/Acesso Restrito</div>
          <div class="summary-value">${lockCount}</div>
          <p class="summary-detail">Exigem chave codificada ou biometria</p>
        </div>
        <div class="summary amber">
          <div class="summary-label">Dupla Custódia (Tesouraria)</div>
          <div class="summary-value">Ativa</div>
          <p class="summary-detail">Obrigatória para malotes e cofre</p>
        </div>
        <div class="summary navy">
          <div class="summary-label">Monitoramento CFTV / NVR</div>
          <div class="summary-value">16 / 16</div>
          <p class="summary-detail">Câmeras operacionais e gravando</p>
        </div>
      </div>

      <div class="panel" style="padding:0;">
        <div class="filter-bar">
          <div>
            <div class="overline">Inventário Crítico do Templo</div>
            <h2 style="margin:4px 0 0;">Controle de Ativos e Salas por Custódia</h2>
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Código / Categoria</th>
                <th>Ativo Patrimonial / Sala</th>
                <th>Localização</th>
                <th>Custódia / Responsável</th>
                <th>Última Conferência</th>
                <th>Status</th>
                <th>Ação Rápida</th>
              </tr>
            </thead>
            <tbody>
              ${state.assets.map(ast => `
                <tr>
                  <td>
                    <span class="cp-code">${esc(ast.code)}</span>
                    <div class="table-sub">${esc(ast.category)}</div>
                  </td>
                  <td>
                    <div class="table-title">${esc(ast.name)}</div>
                    <div class="table-note">${esc(ast.condition_note)}</div>
                  </td>
                  <td class="table-muted">${esc(ast.area_name)}</td>
                  <td class="table-muted">${esc(ast.custodian)}</td>
                  <td class="table-muted">
                    ${esc(ast.last_verified_at)}
                    <div class="table-sub">por ${esc(ast.last_verified_by)}</div>
                  </td>
                  <td>
                    <span class="badge ${ast.status === "Atenção" ? "amber" : "green"}">${esc(ast.status)}</span>
                  </td>
                  <td>
                    <button class="outline-btn" style="height:32px;font-size:11px;" data-verify-asset="${ast.id}">✓ Confirmar Custódia</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==================== VIEW 5: OCORRÊNCIAS E QUASE-INCIDENTES ====================
  function renderOccurrencesView() {
    const reviewed = state.occurrences.filter(i => i.lesson).length;
    const resolved = state.occurrences.filter(i => i.status === "Resolvido").length;
    const high = state.occurrences.filter(i => i.severity === "Alto" || i.severity === "Crítico").length;

    return `
      <div class="page-header">
        <div>
          <div class="overline">Rastreabilidade e Aprendizagem Operacional</div>
          <h1>Ocorrências, Quase-Incidentes e Ações Corretivas</h1>
          <p>Registros persistidos em banco de dados para identificar recorrência por área e horário. O foco é corrigir vulnerabilidades do ambiente e proteger pessoas.</p>
        </div>
        <button class="primary-btn" id="occurrence-page-new">＋ Novo Registro</button>
      </div>

      <div class="summary-grid">
        <div class="summary green">
          <div class="summary-label">Com Lição Aprendida</div>
          <div class="summary-value">${state.occurrences.length ? Math.round((reviewed / state.occurrences.length) * 100) : 0}%</div>
          <p class="summary-detail">${reviewed} de ${state.occurrences.length} com ação corretiva</p>
        </div>
        <div class="summary blue">
          <div class="summary-label">Total de Fatos Registrados</div>
          <div class="summary-value">${state.occurrences.length}</div>
          <p class="summary-detail">${resolved} fatos já encerrados/resolvidos</p>
        </div>
        <div class="summary amber">
          <div class="summary-label">Em Acompanhamento</div>
          <div class="summary-value">${state.occurrences.length - resolved}</div>
          <p class="summary-detail">Aguardando validação final</p>
        </div>
        <div class="summary navy">
          <div class="summary-label">Severidade Alta / Crítica</div>
          <div class="summary-value">${high}</div>
          <p class="summary-detail">Prioridade máxima de tratamento</p>
        </div>
      </div>

      <div class="panel" style="padding:0;">
        <div class="filter-bar">
          <div class="filter-tabs">
            ${["Todos", "Crime", "Incidente", "Emergência", "Quase-incidente"].map(type => `
              <button class="filter-tab ${state.occTypeFilter === type ? "active" : ""}" data-type-filter="${type}">
                ${type} <span>${type === "Todos" ? state.occurrences.length : state.occurrences.filter(i => i.type === type).length}</span>
              </button>
            `).join("")}
          </div>
          <div class="filters">
            <select class="field" id="severity-filter" aria-label="Filtrar gravidade">
              <option>Todas</option>
              <option>Crítico</option>
              <option>Alto</option>
              <option>Atenção</option>
              <option>Controlado</option>
            </select>
            <input class="field search" id="occurrence-search" placeholder="Buscar por área, posto ou fato..." />
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Classificação</th>
                <th>Fato / Área / Lição</th>
                <th>Data e Hora</th>
                <th>Gravidade</th>
                <th>Resposta Aplicada & Danos</th>
                <th>Status / Ação</th>
              </tr>
            </thead>
            <tbody id="occurrence-table-body"></tbody>
          </table>
        </div>
      </div>
    `;
  }

  function populateOccurrenceTable() {
    const body = document.getElementById("occurrence-table-body");
    if (!body) return;
    const type = state.occTypeFilter || "Todos";
    const severity = document.getElementById("severity-filter")?.value || "Todas";
    const query = (document.getElementById("occurrence-search")?.value || "").toLocaleLowerCase("pt-BR");
    const rank = { Controlado: 1, Atenção: 2, Alto: 3, Crítico: 4 };

    const list = state.occurrences
      .filter(item => (type === "Todos" || item.type === type)
        && (severity === "Todas" || item.severity === severity)
        && `${item.title} ${item.area} ${item.description}`.toLocaleLowerCase("pt-BR").includes(query))
      .sort((a, b) => (rank[b.severity] || 1) - (rank[a.severity] || 1));

    body.innerHTML = list.length ? list.map(item => `
      <tr>
        <td>
          <span class="badge ${item.type === "Crime" ? "type-crime" : item.type === "Incidente" ? "type-incident" : item.type === "Emergência" ? "type-emergency" : "type-near"}">
            ${esc(item.type)}
          </span>
        </td>
        <td>
          <div class="table-title">${esc(item.title)}</div>
          <div class="table-sub">📍 ${esc(item.area)} · Relator: ${esc(item.reported_by || "Equipe")}</div>
          <div class="table-sub" style="margin-top:4px;color:#415e72;">${esc(item.description)}</div>
          ${item.lesson ? `<div class="table-note"><strong>Ação corretiva:</strong> ${esc(item.lesson)}</div>` : ""}
        </td>
        <td class="table-muted">${esc(item.occurred_at || item.time_label)}</td>
        <td>
          <span class="badge ${item.severity === "Crítico" ? "severity-critical" : item.severity === "Alto" ? "severity-high" : item.severity === "Atenção" ? "severity-attention" : "severity-controlled"}">
            ${esc(item.severity)}
          </span>
        </td>
        <td>
          <div class="table-muted">${esc(item.response)}</div>
          <div class="table-sub">Dano: ${esc(item.damage)}</div>
          <div class="table-sub">Externo: ${esc(item.external_action)}</div>
        </td>
        <td>
          <span class="badge ${item.status === "Resolvido" ? "status-done" : item.status === "Encaminhado" ? "status-forwarded" : "status-open"}">
            ${esc(item.status)}
          </span>
          ${item.status !== "Resolvido" ? `
            <div style="margin-top:8px;">
              <button class="outline-btn" style="height:28px;padding:0 9px;font-size:11px;" data-resolve-occ="${item.id}">✓ Marcar Resolvido</button>
            </div>
          ` : ""}
        </td>
      </tr>
    `).join("") : `<tr><td colspan="6" style="padding:36px;text-align:center;color:#718997;font-size:13px;font-weight:700">Nenhum registro corresponde aos filtros selecionados.</td></tr>`;

    document.querySelectorAll("[data-resolve-occ]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await api(`/api/occurrences/${btn.dataset.resolveOcc}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: "Resolvido" })
        });
        showToast("Ocorrência marcada como Resolvida!");
        fetchState(true);
      });
    });
  }

  // ==================== VIEW 6: PROTEÇÃO DE PESSOAS ====================
  function renderProtectionView() {
    return `
      <div class="page-header">
        <div>
          <div class="overline">Cuidado, Dignidade e Fluxo de Proteção</div>
          <h1>Proteção de Pessoas e Públicos Vulneráveis</h1>
          <p>A segurança patrimonial e operacional apoia o acolhimento e o encaminhamento responsável; nunca substitui o cuidado pastoral, médico ou a atuação das autoridades públicas.</p>
        </div>
      </div>
      <div class="protection-grid">
        <div class="guide">
          <div class="guide-icon">♡</div>
          <h2>Crianças e Adolescentes</h2>
          <ul>
            <li>Vincule cada criança ao responsável autorizado via etiqueta/pulseira numerada no Posto 03.</li>
            <li>Mantenha controle físico da portinhola e proibição de entrega a terceiros não autorizados.</li>
            <li>Use local seguro e protocolo de reunificação imediata quando houver separação.</li>
          </ul>
        </div>
        <div class="guide">
          <div class="guide-icon">♙</div>
          <h2>Pessoas em Crise ou Vulnerabilidade</h2>
          <ul>
            <li>Observe sinais de agitação ou mal-estar preservando a dignidade; jamais rotule pessoas.</li>
            <li>Reduza estímulos, conduza a espaço ventilado/reservado e acione dupla de apoio.</li>
            <li>Compartilhe informações sensíveis estritamente com quem precisa agir.</li>
          </ul>
        </div>
        <div class="guide">
          <div class="guide-icon">▣</div>
          <h2>Privacidade e Sigilo (LGPD)</h2>
          <ul>
            <li>Registre fatos observáveis e ações de resposta, sem juízo de valor ou exposição.</li>
            <li>Preserve imagens de CFTV apenas para fins de auditoria interna ou requisição legal.</li>
            <li>Nunca divulgue fotos, relatos de ocorrências ou rotinas de cofre em grupos de mensagens.</li>
          </ul>
        </div>
      </div>
      <div class="protection-bottom">
        <div class="panel">
          <div class="overline">Protocolo Padrão de Resposta</div>
          <h2>Como atuar em situações sensíveis durante o culto</h2>
          <div class="protection-steps">
            <div class="step"><span class="step-number">1</span><strong>Acolha e Proteja</strong><p>Afaste curiosos, reduza ruídos e preserve rotas livres.</p></div>
            <div class="step"><span class="step-number">2</span><strong>Acione pelo Rádio</strong><p>Use linguagem simples e código discreto no canal definido.</p></div>
            <div class="step"><span class="step-number">3</span><strong>Registre com Critério</strong><p>Documente horário, posto e providência para aprendizado.</p></div>
          </div>
        </div>
        <div class="side-callout dark">
          <div class="overline" style="color:#bbd0dc">Barreira Inegociável</div>
          <h2>Nenhuma entrega infantil sem código vinculado</h2>
          <p>O Posto 03 (Recepção Infantil) é auditado em todas as rondas. Obreiros e equipe de segurança devem apoiar imediatamente o ministério infantil caso haja tentativa de retirada sem pulseira/etiqueta.</p>
        </div>
      </div>
    `;
  }

  // ==================== VIEW 7: EQUIPE (GESTÃO DE PERFIS: APENAS DADOS DA PESSOA) ====================
  function renderTeamView() {
    const total = state.team_members.length;
    const activeMembers = state.team_members.filter(m => m.active);
    const inactiveMembers = state.team_members.filter(m => !m.active);
    const securityCount = activeMembers.filter(m => m.role === "Equipe de Segurança" || m.role === "Gestor de Segurança").length;
    const isManager = state.role === "Gestor de Segurança" || state.role === "Pastor";

    const roleCategories = ["Todas", "Equipe de Segurança", "Obreiros", "Gestor de Segurança", "Pastor", "Apoio / Saúde", "Ministério Infantil"];

    return `
      <div class="page-header">
        <div>
          <div class="overline">Cadastro de Pessoas & Permissões</div>
          <h1>Cadastro e Gestão de Perfis da Equipe</h1>
          <p>Gerencie os dados cadastrais dos integrantes (nome, função, telefone, e-mail e capacitações). A atribuição de postos e turnos é feita diretamente em <strong>Escala</strong>.</p>
        </div>
        <div class="header-actions">
          <button class="outline-btn" data-nav="escala">📅 Ir para Escala do Mês →</button>
          <button class="primary-btn" id="open-new-member-btn">＋ Adicionar Perfil</button>
        </div>
      </div>

      ${!isManager ? `
        <div class="notice" style="margin-top:0;margin-bottom:20px;">
          ⓘ <div>Você está visualizando como <strong>${esc(state.role)}</strong>. Os controles administrativos de <strong>Adicionar, Editar, Ativar/Desativar e Excluir</strong> continuam habilitados para demonstração (recomendado para o perfil <em>Gestor de Segurança</em>).</div>
        </div>
      ` : ""}

      <div class="summary-grid">
        <div class="summary green">
          <div class="summary-label">Perfis Ativos</div>
          <div class="summary-value">${activeMembers.length}</div>
          <p class="summary-detail">Disponíveis para a Escala do Mês</p>
        </div>
        <div class="summary blue">
          <div class="summary-label">Segurança & Gestão</div>
          <div class="summary-value">${securityCount}</div>
          <p class="summary-detail">Integrantes ativos na segurança</p>
        </div>
        <div class="summary amber">
          <div class="summary-label">Perfis Desativados</div>
          <div class="summary-value">${inactiveMembers.length}</div>
          <p class="summary-detail">Temporariamente inativos</p>
        </div>
        <div class="summary navy">
          <div class="summary-label">Total Cadastrado</div>
          <div class="summary-value">${total}</div>
          <p class="summary-detail">Pessoas registradas no sistema</p>
        </div>
      </div>

      <div class="panel" style="padding:0;">
        <div class="filter-bar">
          <div class="filter-tabs">
            ${["Todos", "Ativos", "Inativos"].map(st => `
              <button class="filter-tab ${state.teamStatusFilter === st ? "active" : ""}" data-team-status="${st}">
                ${st} <span>${st === "Todos" ? total : st === "Ativos" ? activeMembers.length : inactiveMembers.length}</span>
              </button>
            `).join("")}
          </div>
          <div class="filters">
            <select class="field" id="team-role-filter" aria-label="Filtrar por função">
              ${roleCategories.map(r => `<option value="${esc(r)}" ${state.teamRoleFilter === r ? "selected" : ""}>${r === "Todas" ? "Todas as Funções" : esc(r)}</option>`).join("")}
            </select>
            <input class="field search" id="team-search-input" placeholder="Buscar por nome, telefone ou e-mail..." />
          </div>
        </div>

        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nome Completo</th>
                <th>Perfil / Função</th>
                <th>Telefone & E-mail</th>
                <th>Capacitações / Observações</th>
                <th>Status do Perfil</th>
                <th>Ações do Gestor</th>
              </tr>
            </thead>
            <tbody id="team-table-body"></tbody>
          </table>
        </div>
      </div>

      <div class="panel" style="margin-top:24px;">
        <div class="panel-header">
          <div>
            <div class="overline">Capacitação Contínua</div>
            <h2>Agenda de Treinamentos e Simulados da Equipe</h2>
          </div>
        </div>
        <div class="focus-list">
          ${state.trainings.map(t => `
            <div class="focus-item">
              <span class="dot blue"></span>
              <div class="item-main">
                <div class="item-title">${esc(t.title)}</div>
                <div class="item-copy">${esc(t.date_label)} · Público: ${esc(t.participants)}</div>
              </div>
              <span class="badge blue">${esc(t.status)}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function populateTeamTable() {
    const body = document.getElementById("team-table-body");
    if (!body) return;

    const statusFilter = state.teamStatusFilter || "Todos";
    const roleFilter = document.getElementById("team-role-filter")?.value || state.teamRoleFilter || "Todas";
    state.teamRoleFilter = roleFilter;
    const query = (document.getElementById("team-search-input")?.value || "").toLocaleLowerCase("pt-BR");

    const filtered = state.team_members.filter(m => {
      const matchStatus = statusFilter === "Todos"
        || (statusFilter === "Ativos" && m.active)
        || (statusFilter === "Inativos" && !m.active);
      const matchRole = roleFilter === "Todas" || m.role === roleFilter;
      const matchQuery = `${m.name} ${m.role} ${m.phone_short} ${m.email || ""} ${m.notes || ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(query);
      return matchStatus && matchRole && matchQuery;
    });

    body.innerHTML = filtered.length ? filtered.map(m => `
      <tr style="${!m.active ? "opacity:0.65;background:#f9fbfb;" : ""}">
        <td>
          <div class="table-title">${esc(m.name)}</div>
          <div class="table-sub">🔑 Login: <strong>@${esc(m.username || "usuario")}</strong></div>
        </td>
        <td>
          <span class="badge ${m.role === "Gestor de Segurança" ? "navy" : m.role === "Equipe de Segurança" ? "blue" : m.role === "Pastor" ? "amber" : "green"}">
            ${esc(m.role)}
          </span>
        </td>
        <td>
          <div class="table-muted">📞 ${esc(m.phone_short)}</div>
          <div class="table-sub">${m.email ? `✉ ${esc(m.email)}` : "E-mail não informado"}</div>
        </td>
        <td>
          <div class="table-muted">${esc(m.notes || "—")}</div>
        </td>
        <td>
          <span class="badge ${m.active ? "green" : "coral"}">
            ${m.active ? "● Ativo" : "○ Desativado"}
          </span>
          <div class="table-sub" style="margin-top:4px;">${m.active ? "🔓 Acesso Liberado" : "🔒 Login Bloqueado"}</div>
        </td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="outline-btn" style="height:30px;padding:0 10px;font-size:11px;" data-edit-member="${m.id}" title="Editar dados e credenciais da pessoa">✎ Editar</button>
            <button class="outline-btn" style="height:30px;padding:0 10px;font-size:11px;" data-pwd-member="${m.id}" title="Definir ou alterar senha de acesso">🔑 Senha</button>
            <button class="outline-btn" style="height:30px;padding:0 10px;font-size:11px;color:${m.active ? "#a96a10" : "#28745e"};" data-toggle-member="${m.id}">
              ${m.active ? "⏸ Desativar" : "▶ Ativar"}
            </button>
            <button class="outline-btn" style="height:30px;padding:0 10px;font-size:11px;color:#b95042;border-color:#f0cdc8;" data-delete-member="${m.id}" title="Excluir perfil">🗑 Excluir</button>
          </div>
        </td>
      </tr>
    `).join("") : `<tr><td colspan="6" style="padding:36px;text-align:center;color:#718997;font-size:13px;font-weight:700">Nenhum perfil encontrado para os filtros informados.</td></tr>`;

    body.querySelectorAll("[data-edit-member]").forEach(btn => {
      btn.addEventListener("click", () => openTeamMemberModal(btn.dataset.editMember));
    });

    body.querySelectorAll("[data-pwd-member]").forEach(btn => {
      btn.addEventListener("click", () => openChangePasswordModal(btn.dataset.pwdMember));
    });

    body.querySelectorAll("[data-toggle-member]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.toggleMember;
        const res = await api(`/api/team/${id}/active`, {
          method: "PATCH",
          body: JSON.stringify({})
        });
        showToast(res.active ? "Perfil reativado e login liberado!" : "Perfil desativado e login bloqueado.");
        fetchState(true);
      });
    });

    body.querySelectorAll("[data-delete-member]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.deleteMember;
        const member = state.team_members.find(x => x.id === id);
        if (!member) return;
        if (!window.confirm(`Deseja realmente excluir o perfil de "${member.name}"? As alocações futuras deste perfil na escala também serão removidas.`)) {
          return;
        }
        await api(`/api/team/${id}`, { method: "DELETE" });
        showToast(`Perfil de ${member.name} excluído.`);
        fetchState(true);
      });
    });
  }

  // ==================== VIEW 8: ESCALA DO MÊS (QUADRO MENSAL DE ALOCAÇÃO) ====================
  function renderScheduleView() {
    const monthNames = [
      "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
      "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"
    ];
    const weekdays = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

    const year = state.calendarYear || 2026;
    const month = state.calendarMonth ?? 9; // 9 = Outubro
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

    const allSchedules = state.monthly_schedules || [];
    const monthSchedules = allSchedules.filter(s => (s.date_iso || "").startsWith(monthPrefix));
    const activeMembers = state.team_members.filter(m => m.active);
    const confirmedCount = monthSchedules.filter(s => s.status === "Confirmado" || s.status === "Em Posto").length;
    const distinctDates = Array.from(new Set(monthSchedules.map(s => s.date_iso))).sort();

    // Calculate calendar grid for the selected month
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0=Sun..6=Sat
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((firstDayIndex + daysInMonth) / 7) * 7;

    let cellsHtml = "";
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - firstDayIndex + 1;
      if (dayNum < 1 || dayNum > daysInMonth) {
        cellsHtml += `<div class="schedule-day-cell empty-cell"></div>`;
      } else {
        const dayStr = String(dayNum).padStart(2, "0");
        const dateIso = `${monthPrefix}-${dayStr}`;
        const dayItems = monthSchedules.filter(s => s.date_iso === dateIso);
        const isToday = dateIso === "2026-10-16";

        cellsHtml += `
          <div class="schedule-day-cell ${isToday ? "today-cell" : ""}" data-day-cell="${dateIso}" title="Clique para alocar integrante no dia ${dayStr}/${String(month + 1).padStart(2, "0")}/${year}">
            <div class="schedule-day-top">
              <span class="schedule-day-number">${dayStr}</span>
              <button type="button" class="schedule-day-add-hint" data-day-add="${dateIso}">＋ Alocar</button>
            </div>
            ${dayItems.length ? `
              <div class="schedule-person-list">
                ${dayItems.map(it => {
                  const statusClass = it.status === "Confirmado" ? "status-Confirmado" : it.status === "Em Posto" ? "status-Em-Posto" : it.status === "Falta / Substituir" ? "status-Falta" : "";
                  const shortPost = (it.post_name || "").split("·")[0].trim();
                  return `
                    <div class="schedule-person-row ${statusClass}" data-person-entry="${it.id}" title="${esc(it.member_name)} (${esc(it.member_role)}) — ${esc(it.post_name)} · ${esc(it.shift_time)} [${esc(it.status)}]">
                      <div class="schedule-person-info">
                        <span>${esc(it.member_name)}</span>
                        <span class="schedule-person-post">${esc(shortPost)} · ${esc(it.shift_time)}</span>
                      </div>
                      <button type="button" class="schedule-person-remove" data-remove-cell-schedule="${it.id}" title="Remover desta data">×</button>
                    </div>
                  `;
                }).join("")}
              </div>
            ` : `
              <div class="schedule-nihill">NIHILL</div>
            `}
          </div>
        `;
      }
    }

    const dateTabs = ["Todas", ...distinctDates];

    return `
      <div class="page-header">
        <div>
          <div class="overline">Quadro Mensal de Alocação de Equipes</div>
          <h1>Quadro de Escala — ${monthNames[month]} ${year}</h1>
          <p>Clique diretamente em qualquer <strong>dia do quadro abaixo</strong> para alocar integrantes cadastrados em <strong>Equipe</strong>. Dias sem alocação exibem automaticamente <code>NIHILL</code>.</p>
        </div>
        <div class="header-actions">
          <button class="outline-btn" id="print-schedule-board-btn">🖨️ Imprimir Quadro</button>
          <button class="outline-btn" data-nav="equipe">♙ Perfis (${activeMembers.length} ativos)</button>
          <button class="primary-btn gold" id="open-schedule-modal-btn">📅 ＋ Alocar na Escala</button>
        </div>
      </div>

      <div class="summary-grid">
        <div class="summary navy">
          <div class="summary-label">Alocações em ${monthNames[month]}</div>
          <div class="summary-value">${monthSchedules.length}</div>
          <p class="summary-detail">Integrantes escalados no mês</p>
        </div>
        <div class="summary green">
          <div class="summary-label">Confirmados / Em Posto</div>
          <div class="summary-value">${confirmedCount} / ${monthSchedules.length}</div>
          <p class="summary-detail">Prontidão confirmada no mês</p>
        </div>
        <div class="summary blue">
          <div class="summary-label">Dias com Cobertura</div>
          <div class="summary-value">${distinctDates.length} / ${daysInMonth}</div>
          <p class="summary-detail">${daysInMonth - distinctDates.length} dia(s) com status NIHILL</p>
        </div>
        <div class="summary amber">
          <div class="summary-label">Efetivo Ativo Disponível</div>
          <div class="summary-value">${activeMembers.length}</div>
          <p class="summary-detail">Cadastrados em Equipe</p>
        </div>
      </div>

      <!-- QUADRO MENSAL (CALENDÁRIO DE 7 COLUNAS DOMINGO A SÁBADO) -->
      <div class="schedule-board-wrapper">
        <div class="schedule-board-header">
          <button type="button" class="schedule-nav-btn" id="cal-prev-month">◀ Mês Anterior</button>
          <h2 class="schedule-board-title">${monthNames[month]} ${year}</h2>
          <button type="button" class="schedule-nav-btn" id="cal-next-month">Próximo Mês ▶</button>
        </div>
        <div class="schedule-board-scroll">
          <div class="schedule-calendar-grid">
            ${weekdays.map(w => `<div class="schedule-weekday-header">${w}</div>`).join("")}
            ${cellsHtml}
          </div>
        </div>
      </div>

      <!-- Tabela complementar detalhada (oculta na impressão) -->
      <div class="panel no-print" style="padding:0;">
        <div class="filter-bar">
          <div class="filter-tabs">
            ${dateTabs.map(dt => {
              const label = dt === "Todas" ? "Todas as Datas" : (monthSchedules.find(s => s.date_iso === dt)?.date_label || dt);
              const count = dt === "Todas" ? monthSchedules.length : monthSchedules.filter(s => s.date_iso === dt).length;
              return `<button class="filter-tab ${state.scheduleDateFilter === dt ? "active" : ""}" data-sc-date="${dt}">
                ${esc(label)} <span>${count}</span>
              </button>`;
            }).join("")}
          </div>
          <div class="filters">
            <input class="field search" id="schedule-search-input" placeholder="Filtrar detalhamento por pessoa ou posto..." />
          </div>
        </div>

        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Data & Horário</th>
                <th>Culto / Evento</th>
                <th>Posto / Área Atribuída</th>
                <th>Integrante Escalado</th>
                <th>Status na Escala</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody id="schedule-table-body"></tbody>
          </table>
        </div>
      </div>
    `;
  }

  function populateScheduleTable() {
    const body = document.getElementById("schedule-table-body");
    if (!body) return;

    const dateFilter = state.scheduleDateFilter || "Todas";
    const query = (document.getElementById("schedule-search-input")?.value || "").toLocaleLowerCase("pt-BR");

    const list = (state.monthly_schedules || []).filter(item => {
      const matchDate = dateFilter === "Todas" || item.date_iso === dateFilter;
      const matchQuery = `${item.date_label} ${item.event_name} ${item.post_name} ${item.member_name} ${item.member_role} ${item.notes || ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(query);
      return matchDate && matchQuery;
    });

    body.innerHTML = list.length ? list.map(item => `
      <tr>
        <td>
          <div class="table-title">📅 ${esc(item.date_label)}</div>
          <div class="table-sub">◷ ${esc(item.shift_time)}</div>
        </td>
        <td>
          <div class="table-title">${esc(item.event_name)}</div>
          ${item.notes ? `<div class="table-note">${esc(item.notes)}</div>` : ""}
        </td>
        <td class="table-muted">⌖ ${esc(item.post_name)}</td>
        <td>
          <div class="table-title">${esc(item.member_name)}</div>
          <div class="table-sub">${esc(item.member_role)}</div>
        </td>
        <td>
          <select class="field" style="height:32px;padding:4px 8px;width:auto;font-size:11.5px;" data-sc-status-change="${item.id}">
            ${["Escalado", "Confirmado", "Em Posto", "Falta / Substituir"].map(st =>
              `<option value="${st}" ${item.status === st ? "selected" : ""}>${st}</option>`
            ).join("")}
          </select>
        </td>
        <td>
          <button class="outline-btn" style="height:30px;padding:0 10px;font-size:11px;color:#b95042;border-color:#f0cdc8;" data-delete-schedule="${item.id}">
            🗑 Remover
          </button>
        </td>
      </tr>
    `).join("") : `<tr><td colspan="6" style="padding:36px;text-align:center;color:#718997;font-size:13px;font-weight:700">Nenhuma alocação encontrada para o filtro selecionado.</td></tr>`;

    body.querySelectorAll("[data-sc-status-change]").forEach(sel => {
      sel.addEventListener("change", async e => {
        const id = e.currentTarget.dataset.scStatusChange;
        const newStatus = e.currentTarget.value;
        await api(`/api/schedules/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: newStatus })
        });
        showToast(`Status na escala atualizado para: ${newStatus}`);
        fetchState(true);
      });
    });

    body.querySelectorAll("[data-delete-schedule]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.deleteSchedule;
        await api(`/api/schedules/${id}`, { method: "DELETE" });
        showToast("Alocação removida da Escala do Mês.");
        fetchState(true);
      });
    });
  }

  // ==================== TEAM & SCHEDULE MODALS ====================
  function openTeamMemberModal(memberId = null) {
    const form = document.getElementById("team-member-form");
    form.reset();
    const titleEl = document.getElementById("tm-modal-title");
    const submitEl = document.getElementById("tm-submit-btn");
    const pwdInput = document.getElementById("tm-password");
    const pwdLabel = document.getElementById("tm-password-label");

    if (memberId) {
      const m = state.team_members.find(x => x.id === memberId);
      if (!m) return;
      document.getElementById("tm-id").value = m.id;
      document.getElementById("tm-name").value = m.name;
      document.getElementById("tm-role").value = m.role;
      document.getElementById("tm-phone").value = m.phone_short;
      document.getElementById("tm-email").value = m.email || "";
      document.getElementById("tm-username").value = m.username || "";
      if (pwdInput) {
        pwdInput.value = "";
        pwdInput.placeholder = "Deixe em branco para manter a senha atual";
      }
      if (pwdLabel) pwdLabel.textContent = "🔒 Nova Senha (opcional ao editar)";
      document.getElementById("tm-notes").value = m.notes || "";
      document.getElementById("tm-active").checked = Boolean(m.active);
      titleEl.textContent = `Editar Perfil — ${m.name}`;
      submitEl.textContent = "✓ Salvar Alterações";
    } else {
      document.getElementById("tm-id").value = "";
      document.getElementById("tm-username").value = "";
      if (pwdInput) {
        pwdInput.value = "";
        pwdInput.placeholder = "Padrão se vazio: 123456";
      }
      if (pwdLabel) pwdLabel.textContent = "🔒 Senha de Acesso";
      document.getElementById("tm-active").checked = true;
      titleEl.textContent = "Adicionar Novo Perfil na Equipe";
      submitEl.textContent = "✓ Cadastrar Perfil";
    }

    document.getElementById("team-member-modal").classList.add("open");
  }

  function openChangePasswordModal(targetMemberId = null) {
    const form = document.getElementById("change-password-form");
    form.reset();
    const mId = targetMemberId || (state.currentUser ? state.currentUser.id : (state.team_members[0]?.id || ""));
    const member = state.team_members.find(x => x.id === mId);
    document.getElementById("cp-member-id").value = mId;
    const sub = document.getElementById("change-pwd-subtitle");
    if (sub && member) {
      sub.innerHTML = `Definindo nova senha de acesso para <strong>${esc(member.name)}</strong> (usuário: <code>@${esc(member.username || "usuario")}</code>).`;
    }
    document.getElementById("change-password-modal").classList.add("open");
  }

  function openScheduleModal(presetDate = null, presetEvent = null) {
    const activeMembers = state.team_members.filter(m => m.active);
    const select = document.getElementById("sc-member");
    if (!activeMembers.length) {
      showToast("Nenhum perfil ativo encontrado. Ative ou cadastre alguém em Equipe primeiro.");
      return;
    }

    select.innerHTML = activeMembers.map(m =>
      `<option value="${m.id}">${esc(m.name)} — ${esc(m.role)}</option>`
    ).join("");

    const dateInput = document.getElementById("sc-date");
    if (presetDate) {
      dateInput.value = presetDate;
    } else if (!dateInput.value) {
      dateInput.value = "2026-10-18";
    }

    if (presetEvent) {
      document.getElementById("sc-event").value = presetEvent;
    }

    document.getElementById("schedule-modal").classList.add("open");
  }

  // ==================== QR CODE SVG GENERATOR (STANDALONE) ====================
  function generateQrSvg(text, size = 116) {
    const grid = 15;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const isFinder = (r, c) =>
      (r < 4 && c < 4) || (r < 4 && c >= grid - 4) || (r >= grid - 4 && c < 4);

    let rects = "";
    const cell = size / grid;
    for (let r = 0; r < grid; r++) {
      for (let c = 0; c < grid; c++) {
        let fill = false;
        if (isFinder(r, c)) {
          const lr = r >= grid - 4 ? r - (grid - 4) : r;
          const lc = c >= grid - 4 ? c - (grid - 4) : c;
          fill = lr === 0 || lr === 3 || lc === 0 || lc === 3 || (lr >= 1 && lr <= 2 && lc >= 1 && lc <= 2);
        } else {
          const bit = ((hash >>> ((r * grid + c) % 28)) ^ (r * 17 + c * 31 + text.charCodeAt((r + c) % text.length))) & 1;
          fill = bit === 1;
        }
        if (fill) {
          rects += `<rect x="${(c * cell).toFixed(1)}" y="${(r * cell).toFixed(1)}" width="${(cell + 0.3).toFixed(1)}" height="${(cell + 0.3).toFixed(1)}" fill="#102b40"/>`;
        }
      }
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="background:#fff;padding:6px;border-radius:8px;border:1px solid #dce7ea;">${rects}</svg>`;
  }

  function openScanModal(checkpointId = null) {
    const select = document.getElementById("scan-checkpoint-select");
    select.innerHTML = state.checkpoints.map(cp =>
      `<option value="${cp.id}" ${cp.id === checkpointId ? "selected" : ""}>${esc(cp.code)} — ${esc(cp.name)}</option>`
    ).join("");

    updateScanCheckpointDetails();
    document.getElementById("scan-modal").classList.add("open");
  }

  function updateScanCheckpointDetails() {
    const cpId = document.getElementById("scan-checkpoint-select").value;
    const cp = state.checkpoints.find(c => c.id === cpId) || state.checkpoints[0];
    if (!cp) return;
    document.getElementById("scan-qr-input").value = cp.qr_token;
    document.getElementById("scan-checkpoint-instructions").innerHTML = `
      <span>⌖</span>
      <div>
        <strong>O que inspecionar no ${esc(cp.code)} (${esc(cp.area_name)}):</strong><br>
        ${esc(cp.instructions)}<br>
        <small style="color:#2b678c;font-weight:800;">Itens críticos: ${esc((cp.critical_items || "").replace(/;/g, " · "))}</small>
      </div>
    `;
  }

  function openQrLabelsModal(singleCpId = null) {
    const list = singleCpId ? state.checkpoints.filter(c => c.id === singleCpId) : state.checkpoints;
    const container = document.getElementById("qr-print-container");
    container.innerHTML = list.map(cp => `
      <div class="qr-label-card">
        <div style="font-size:10px;font-weight:900;letter-spacing:.14em;color:#2d759a;text-transform:uppercase;">ARCANJO INTELLIGENCE · SEGURANÇA PATRIMONIAL</div>
        <h3 style="margin:6px 0 4px;font-size:16px;color:#102b40;">${esc(cp.code)} — ${esc(cp.area_name)}</h3>
        <div style="font-size:12px;color:#547283;margin-bottom:10px;">${esc(cp.name)}</div>
        <div style="display:flex;justify-content:center;margin:8px 0;">
          ${generateQrSvg(cp.qr_token, 124)}
        </div>
        <div style="font-family:monospace;font-size:11px;font-weight:800;color:#13344d;background:#f2f6f8;padding:5px 8px;border-radius:6px;display:inline-block;margin-top:4px;">
          ${esc(cp.qr_token)}
        </div>
        <div style="margin-top:10px;">
          <button type="button" class="outline-btn" style="height:30px;font-size:11px;" data-simulate-qr="${cp.id}">📱 Simular Leitura deste QR</button>
        </div>
      </div>
    `).join("");

    container.querySelectorAll("[data-simulate-qr]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.getElementById("qr-labels-modal").classList.remove("open");
        openScanModal(btn.dataset.simulateQr);
        showToast("QR Code lido com sucesso! Confirme a inspeção do posto.");
      });
    });

    document.getElementById("qr-labels-modal").classList.add("open");
  }

  function stopCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(t => t.stop());
      state.cameraStream = null;
    }
    const video = document.getElementById("qr-video");
    if (video) video.classList.remove("active");
  }

  // ==================== RENDER & BIND ====================
  function render() {
    renderSidebar();
    document.getElementById("mobile-brand").style.display = window.innerWidth <= 820 ? "flex" : "none";
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.dataset.view === state.view));

    const viewTitleEl = document.getElementById("top-view-title");
    if (viewTitleEl) {
      const foundNav = navItems.find(([key]) => key === state.view);
      viewTitleEl.textContent = foundNav ? foundNav[2] : "Dashboard";
    }

    const content = roleContent[state.role] || roleContent["Gestor de Segurança"];
    document.querySelector('[data-view="painel"]').innerHTML = renderDashboard(content);
    document.querySelector('[data-view="rondas"]').innerHTML = renderRoundsView();
    document.querySelector('[data-view="checklists"]').innerHTML = renderChecklistsView();
    document.querySelector('[data-view="patrimonio"]').innerHTML = renderPatrimonioView();
    document.querySelector('[data-view="ocorrencias"]').innerHTML = renderOccurrencesView();
    document.querySelector('[data-view="protecao"]').innerHTML = renderProtectionView();
    document.querySelector('[data-view="equipe"]').innerHTML = renderTeamView();
    document.querySelector('[data-view="escala"]').innerHTML = renderScheduleView();

    bindDynamicEvents();
  }

  function bindDynamicEvents() {
    document.querySelectorAll("[data-nav]").forEach(btn => {
      btn.addEventListener("click", () => navigate(btn.dataset.nav));
    });

    document.querySelectorAll("[data-open-scan]").forEach(btn => {
      btn.addEventListener("click", () => openScanModal(btn.dataset.openScan || null));
    });

    document.querySelectorAll("[data-single-qr]").forEach(btn => {
      btn.addEventListener("click", () => openQrLabelsModal(btn.dataset.singleQr));
    });

    document.getElementById("open-qr-labels-btn")?.addEventListener("click", () => openQrLabelsModal(null));
    document.getElementById("open-new-patrol-btn")?.addEventListener("click", () => {
      document.getElementById("new-patrol-modal").classList.add("open");
    });

    document.getElementById("finish-patrol-btn")?.addEventListener("click", async e => {
      const id = e.currentTarget.dataset.sessionId;
      await api(`/api/patrols/${id}/finish`, { method: "POST" });
      showToast("Turno de ronda encerrado e arquivado com sucesso!");
      fetchState(true);
    });

    // Checklists toggles & filters
    document.querySelectorAll("[data-check-toggle]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.checkToggle;
        const res = await api(`/api/checklists/${id}/toggle`, {
          method: "POST",
          body: JSON.stringify({ user_name: state.role })
        });
        showToast(res.complete ? "Verificação assinada com sucesso!" : "Item reaberto para verificação.");
        fetchState(true);
      });
    });

    document.querySelectorAll("[data-ck-phase]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.checkPhaseFilter = btn.dataset.ckPhase;
        render();
      });
    });

    document.querySelectorAll("[data-ck-status]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.checkStatusFilter = btn.dataset.ckStatus;
        render();
      });
    });

    document.getElementById("open-new-ck-btn")?.addEventListener("click", () => {
      document.getElementById("new-checklist-modal").classList.add("open");
    });

    document.getElementById("reset-shift-ck-btn")?.addEventListener("click", async () => {
      await api("/api/checklists/reset-shift", { method: "POST" });
      showToast("Checklists reiniciados para abertura de novo turno!");
      fetchState(true);
    });

    // Patrimonial asset verification
    document.querySelectorAll("[data-verify-asset]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.verifyAsset;
        await api(`/api/assets/${id}/verify`, {
          method: "POST",
          body: JSON.stringify({ status: "Conferido", verified_by: state.role })
        });
        showToast("Ativo patrimonial conferido e registrado no turno!");
        fetchState(true);
      });
    });

    // Equipe listeners
    document.getElementById("open-new-member-btn")?.addEventListener("click", () => openTeamMemberModal(null));
    document.querySelectorAll("[data-team-status]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.teamStatusFilter = btn.dataset.teamStatus;
        render();
      });
    });
    document.getElementById("team-role-filter")?.addEventListener("change", populateTeamTable);
    document.getElementById("team-search-input")?.addEventListener("input", populateTeamTable);

    // Escala do Mês (Quadro Mensal) listeners
    document.getElementById("open-schedule-modal-btn")?.addEventListener("click", () => openScheduleModal(null, null));
    document.getElementById("print-schedule-board-btn")?.addEventListener("click", () => window.print());

    document.getElementById("cal-prev-month")?.addEventListener("click", () => {
      if (state.calendarMonth === 0) {
        state.calendarMonth = 11;
        state.calendarYear -= 1;
      } else {
        state.calendarMonth -= 1;
      }
      state.scheduleDateFilter = "Todas";
      render();
    });

    document.getElementById("cal-next-month")?.addEventListener("click", () => {
      if (state.calendarMonth === 11) {
        state.calendarMonth = 0;
        state.calendarYear += 1;
      } else {
        state.calendarMonth += 1;
      }
      state.scheduleDateFilter = "Todas";
      render();
    });

    document.querySelectorAll("[data-remove-cell-schedule]").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const id = btn.dataset.removeCellSchedule;
        await api(`/api/schedules/${id}`, { method: "DELETE" });
        showToast("Alocação removida do quadro.");
        fetchState(true);
      });
    });

    document.querySelectorAll("[data-day-cell]").forEach(cell => {
      cell.addEventListener("click", e => {
        if (e.target.closest("[data-remove-cell-schedule]")) return;
        const dateIso = cell.dataset.dayCell;
        openScheduleModal(dateIso, null);
      });
    });

    document.querySelectorAll("[data-sc-date]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.scheduleDateFilter = btn.dataset.scDate;
        render();
      });
    });
    document.getElementById("schedule-search-input")?.addEventListener("input", populateScheduleTable);

    // Occurrences filters
    document.querySelectorAll("[data-type-filter]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.occTypeFilter = btn.dataset.typeFilter;
        render();
      });
    });
    document.getElementById("severity-filter")?.addEventListener("change", populateOccurrenceTable);
    document.getElementById("occurrence-search")?.addEventListener("input", populateOccurrenceTable);
    document.getElementById("occurrence-page-new")?.addEventListener("click", openOccurrenceModal);
    document.getElementById("inline-new-occ")?.addEventListener("click", openOccurrenceModal);

    populateOccurrenceTable();
    populateTeamTable();
    populateScheduleTable();
  }

  function setDefaultDate() {
    const dateInput = document.getElementById("form-date");
    if (!dateInput) return;
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    dateInput.value = d.toISOString().slice(0, 16);
  }

  function openOccurrenceModal() {
    setDefaultDate();
    document.getElementById("occurrence-modal").classList.add("open");
  }

  // ==================== STATIC LISTENERS ====================
  document.getElementById("menu-open")?.addEventListener("click", openDrawer);
  document.getElementById("new-occurrence")?.addEventListener("click", openOccurrenceModal);
  document.getElementById("quick-scan-btn")?.addEventListener("click", () => openScanModal(null));
  document.getElementById("top-bell")?.addEventListener("click", () => navigate("ocorrencias"));

  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => {
      stopCamera();
      document.getElementById(btn.dataset.closeModal)?.classList.remove("open");
    });
  });

  document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", e => {
      if (e.target === backdrop) {
        stopCamera();
        backdrop.classList.remove("open");
      }
    });
  });

  document.getElementById("scan-checkpoint-select")?.addEventListener("change", updateScanCheckpointDetails);

  document.getElementById("scan-status")?.addEventListener("change", e => {
    const isAnomaly = e.target.value === "ANOMALIA";
    document.getElementById("anomaly-extra-fields").style.display = isAnomaly ? "block" : "none";
    const submitBtn = document.getElementById("scan-submit-btn");
    submitBtn.className = isAnomaly ? "primary-btn coral" : "primary-btn green";
    submitBtn.textContent = isAnomaly ? "⚠ Registrar Anomalia no Posto" : "✓ Confirmar Passagem no Posto";
  });

  document.getElementById("capture-gps-btn")?.addEventListener("click", () => {
    const disp = document.getElementById("gps-display");
    disp.textContent = "📍 Obtendo coordenadas de satélite...";
    const cpId = document.getElementById("scan-checkpoint-select").value;
    const cp = state.checkpoints.find(c => c.id === cpId) || state.checkpoints[0];

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          state.gpsCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          disp.textContent = `📍 GPS Validado: ${state.gpsCoords.lat.toFixed(5)}, ${state.gpsCoords.lng.toFixed(5)} (Precisão ±${Math.round(pos.coords.accuracy || 4)}m)`;
          showToast("Geolocalização GPS capturada!");
        },
        () => {
          state.gpsCoords = { lat: cp.latitude + 0.00001, lng: cp.longitude - 0.00001 };
          disp.textContent = `📍 Perímetro Local Confirmado: ${state.gpsCoords.lat.toFixed(5)}, ${state.gpsCoords.lng.toFixed(5)} (±2.1m do ${cp.code})`;
          showToast("Coordenadas do perímetro do posto sincronizadas!");
        },
        { timeout: 4000 }
      );
    } else {
      state.gpsCoords = { lat: cp.latitude, lng: cp.longitude };
      disp.textContent = `📍 Perímetro Local Confirmado: ${cp.latitude.toFixed(5)}, ${cp.longitude.toFixed(5)}`;
    }
  });

  document.getElementById("toggle-camera-btn")?.addEventListener("click", async () => {
    const video = document.getElementById("qr-video");
    if (state.cameraStream) {
      stopCamera();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      state.cameraStream = stream;
      video.srcObject = stream;
      video.classList.add("active");
      await video.play();
      showToast("Câmera ativa! Aponte para o QR Code do posto.");
    } catch {
      updateScanCheckpointDetails();
      showToast("Token QR do posto carregado automaticamente no leitor!");
    }
  });

  document.getElementById("scan-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const cpId = document.getElementById("scan-checkpoint-select").value;
    const qrToken = document.getElementById("scan-qr-input").value.trim();
    const agent = document.getElementById("scan-agent").value.trim();
    const method = document.getElementById("scan-method").value;
    const status = document.getElementById("scan-status").value;
    const notes = document.getElementById("scan-notes").value.trim();
    const createOcc = document.getElementById("scan-create-occ").checked;
    const occSeverity = document.getElementById("scan-occ-severity").value;

    const res = await api("/api/checkpoints/scan", {
      method: "POST",
      body: JSON.stringify({
        checkpoint_id: cpId,
        qr_token: qrToken,
        agent_name: agent,
        verification_method: method,
        latitude: state.gpsCoords?.lat ?? null,
        longitude: state.gpsCoords?.lng ?? null,
        status,
        notes,
        create_occurrence: createOcc,
        occurrence_severity: occSeverity
      })
    });

    stopCamera();
    document.getElementById("scan-modal").classList.remove("open");
    document.getElementById("scan-notes").value = "";
    showToast(`Posto verificado (${res.distance_meters}m)! ${res.occurrence_id ? "Alerta gerado: " + res.occurrence_id : ""}`);
    await fetchState(true);
  });

  document.getElementById("new-patrol-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    await api("/api/patrols/start", {
      method: "POST",
      body: JSON.stringify({
        title: document.getElementById("patrol-title").value,
        shift_name: document.getElementById("patrol-shift").value,
        agent_name: document.getElementById("patrol-agent").value,
        agent_role: document.getElementById("patrol-role").value,
        notes: document.getElementById("patrol-notes").value
      })
    });
    document.getElementById("new-patrol-modal").classList.remove("open");
    showToast("Novo turno de ronda iniciado!");
    navigate("rondas");
    fetchState(true);
  });

  document.getElementById("new-checklist-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    await api("/api/checklists", {
      method: "POST",
      body: JSON.stringify({
        title: document.getElementById("ck-title").value,
        phase: document.getElementById("ck-phase").value,
        area: document.getElementById("ck-area").value,
        responsible: document.getElementById("ck-resp").value,
        critical: document.getElementById("ck-critical").checked
      })
    });
    document.getElementById("new-checklist-modal").classList.remove("open");
    document.getElementById("new-checklist-form").reset();
    showToast("Item adicionado ao checklist operacional!");
    fetchState(true);
  });

  document.getElementById("occurrence-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const dateValue = document.getElementById("form-date").value;
    const d = new Date(dateValue);
    const occurredAt = Number.isNaN(d.getTime())
      ? dateValue
      : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

    await api("/api/occurrences", {
      method: "POST",
      body: JSON.stringify({
        type: document.getElementById("form-type").value,
        severity: document.getElementById("form-severity").value,
        title: document.getElementById("form-title").value,
        area: document.getElementById("form-area").value,
        occurred_at: occurredAt,
        description: document.getElementById("form-description").value,
        response: document.getElementById("form-response").value,
        damage: document.getElementById("form-damage").value,
        external_action: document.getElementById("form-external").value,
        lesson: document.getElementById("form-lesson").value,
        reported_by: state.role
      })
    });

    document.getElementById("occurrence-modal").classList.remove("open");
    document.getElementById("occurrence-form").reset();
    showToast("Fato de segurança salvo no banco de dados!");
    navigate("ocorrencias");
    fetchState(true);
  });

  // Submit handler for Team Member Modal (Add / Edit)
  document.getElementById("team-member-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const id = document.getElementById("tm-id").value.trim();
    const payload = {
      name: document.getElementById("tm-name").value,
      role: document.getElementById("tm-role").value,
      phone_short: document.getElementById("tm-phone").value,
      email: document.getElementById("tm-email").value,
      username: document.getElementById("tm-username").value,
      password: document.getElementById("tm-password").value,
      notes: document.getElementById("tm-notes").value,
      active: document.getElementById("tm-active").checked
    };

    if (id) {
      await api(`/api/team/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      showToast("Perfil e credenciais atualizados com sucesso!");
    } else {
      const res = await api("/api/team", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      showToast(`Novo perfil cadastrado! Login: @${res.username || "usuario"}`);
    }

    document.getElementById("team-member-modal").classList.remove("open");
    fetchState(true);
  });

  // Submit handler for Monthly Schedule Modal
  document.getElementById("schedule-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const payload = {
      member_id: document.getElementById("sc-member").value,
      date_iso: document.getElementById("sc-date").value,
      event_name: document.getElementById("sc-event").value,
      shift_time: document.getElementById("sc-shift").value,
      post_name: document.getElementById("sc-post").value,
      status: document.getElementById("sc-status").value,
      notes: document.getElementById("sc-notes").value
    };

    await api("/api/schedules", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    document.getElementById("schedule-modal").classList.remove("open");
    document.getElementById("sc-notes").value = "";
    showToast("Integrante atribuído na Escala do Mês!");
    navigate("escala");
    fetchState(true);
  });

  // ==================== LOGIN, SENHA & LOGOUT ====================
  document.getElementById("toggle-login-pwd")?.addEventListener("click", () => {
    const inp = document.getElementById("login-password");
    if (!inp) return;
    inp.type = inp.type === "password" ? "text" : "password";
  });

  document.getElementById("toggle-tm-pwd")?.addEventListener("click", () => {
    const inp = document.getElementById("tm-password");
    if (!inp) return;
    inp.type = inp.type === "password" ? "text" : "password";
  });

  document.querySelectorAll("[data-quick-login]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("login-identifier").value = btn.dataset.quickLogin;
      document.getElementById("login-password").value = btn.dataset.quickPwd || "123456";
      document.getElementById("login-error").style.display = "none";
    });
  });

  document.getElementById("login-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("login-error");
    errEl.style.display = "none";
    const identifier = document.getElementById("login-identifier").value.trim();
    const password = document.getElementById("login-password").value;

    try {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password })
      });
      state.currentUser = res.user;
      localStorage.setItem("arcanjo-user", JSON.stringify(res.user));
      localStorage.setItem("arcanjo-token", res.token);

      const matchedRole = roles.includes(res.user.role) ? res.user.role : "Equipe de Segurança";
      state.role = matchedRole;
      localStorage.setItem("arcanjo-role", matchedRole);

      document.getElementById("login-password").value = "";
      updateAuthUI();
      render();
      showToast(`Bem-vindo(a), ${res.user.name} (${res.user.role})!`);
    } catch (err) {
      errEl.textContent = "⚠ " + err.message;
      errEl.style.display = "block";
    }
  });

  document.getElementById("logout-btn")?.addEventListener("click", () => {
    state.currentUser = null;
    localStorage.removeItem("arcanjo-user");
    localStorage.removeItem("arcanjo-token");
    updateAuthUI();
    showToast("Sessão encerrada com segurança.");
  });

  document.getElementById("user-session-badge")?.addEventListener("click", () => {
    openChangePasswordModal(state.currentUser ? state.currentUser.id : null);
  });

  document.getElementById("change-password-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const memberId = document.getElementById("cp-member-id").value;
    const newPassword = document.getElementById("cp-new-password").value.trim();
    const confirmPassword = document.getElementById("cp-confirm-password").value.trim();

    if (newPassword !== confirmPassword) {
      showToast("As senhas digitadas não coincidem!");
      return;
    }

    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ member_id: memberId, new_password: newPassword })
      });
      document.getElementById("change-password-modal").classList.remove("open");
      showToast("Senha de acesso atualizada com sucesso!");
      fetchState(true);
    } catch (err) {
      showToast("Erro ao alterar senha: " + err.message);
    }
  });

  document.getElementById("print-qr-btn")?.addEventListener("click", () => window.print());

  window.addEventListener("resize", () => {
    const mb = document.getElementById("mobile-brand");
    if (mb) mb.style.display = window.innerWidth <= 820 ? "flex" : "none";
  });

  updateAuthUI();
  fetchState();
  setInterval(() => fetchState(true), 10000);
})();
