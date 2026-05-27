(() => {
  const API_BASE = "http://localhost:8000";

  const els = {
    text: document.getElementById("text"),
    btnSend: document.getElementById("btnSend"),
    msg: document.getElementById("msg"),
    workers: document.getElementById("workers"),
    tasks: document.getElementById("tasks"),
    clock: document.getElementById("clock"),
  };

  const state = {
    workers: [],
    tasks: new Map(),
    expanded: new Set(),
    sse: new Map(),
  };

  const fmtClock = () => {
    try {
      return new Intl.DateTimeFormat("es-MX", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date());
    } catch {
      return new Date().toLocaleTimeString();
    }
  };

  const updateClock = () => {
    if (!els.clock) return;
    els.clock.textContent = fmtClock();
  };

  const safeJson = async (res) => {
    const text = await res.text();
    try {
      return { ok: res.ok, status: res.status, data: JSON.parse(text) };
    } catch {
      return { ok: res.ok, status: res.status, data: text };
    }
  };

  const getBadgeClass = (status) => {
    const s = (status || "").toLowerCase();
    if (s.includes("complet")) return "badge badge--ok";
    if (s.includes("error") || s.includes("fail")) return "badge badge--bad";
    if (s.includes("pend") || s.includes("proc")) return "badge badge--warn";
    return "badge";
  };

  const parseDate = (v) => {
    const t = Date.parse(v || "");
    return Number.isFinite(t) ? t : 0;
  };

  const formatDate = (v) => {
    const t = parseDate(v);
    if (!t) return "-";
    try {
      return new Intl.DateTimeFormat("es-MX", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(t));
    } catch {
      return new Date(t).toLocaleString();
    }
  };

  const normalizeTask = (raw) => {
    if (!raw) return null;
    const id = raw.task_id || raw.id;
    if (!id) return null;

    const created_at = raw.created_at || raw.created || raw.createdAt || "";
    const updated_at = raw.updated_at || raw.updated || raw.updatedAt || "";
    const status = raw.status || "";
    const worker_id = raw.worker_id || raw.worker || raw.workerId || "";
    const text = raw.text || "";

    const result = raw.result || raw.analysis || raw.output || {};
    const word_count = result.word_count ?? raw.word_count ?? null;
    const char_count = result.char_count ?? raw.char_count ?? null;
    const sentence_count = result.sentence_count ?? raw.sentence_count ?? null;
    const top_words = result.top_words ?? raw.top_words ?? [];
    const detected_keywords = result.detected_keywords ?? raw.detected_keywords ?? [];
    const sentiment = result.sentiment ?? raw.sentiment ?? null;
    const summary = result.summary ?? raw.summary ?? null;

    return {
      id,
      created_at,
      updated_at,
      status,
      worker_id,
      text,
      metrics: {
        word_count,
        char_count,
        sentence_count,
      },
      top_words,
      detected_keywords,
      sentiment,
      summary,
      raw,
    };
  };

  const setMsg = (text) => {
    if (!els.msg) return;
    els.msg.textContent = text || "";
  };

  const renderWorkers = () => {
    if (!els.workers) return;
    if (!state.workers.length) {
      els.workers.innerHTML = `<div class="item"><div class="kv">Sin workers.</div></div>`;
      return;
    }

    els.workers.innerHTML = state.workers
      .map((w) => {
        const name = w.name || w.id || w.worker_id || "worker";
        const status = w.status || "idle";
        const last = w.last_seen ? formatDate(w.last_seen) : "-";
        return `
          <div class="item">
            <div class="row">
              <div style="font-weight:750">${escapeHtml(name)}</div>
              <span class="badge">${escapeHtml(status)}</span>
            </div>
            <div class="kv">last_seen: ${escapeHtml(last)}</div>
          </div>
        `;
      })
      .join("");
  };

  const renderTasks = () => {
    if (!els.tasks) return;

    const list = Array.from(state.tasks.values())
      .filter(Boolean)
      .sort((a, b) => {
        const ta = parseDate(a.created_at) || parseDate(a.updated_at);
        const tb = parseDate(b.created_at) || parseDate(b.updated_at);
        return tb - ta;
      });

    if (!list.length) {
      els.tasks.innerHTML = `<div class="item"><div class="kv">No hay tareas.</div></div>`;
      return;
    }

    els.tasks.innerHTML = list.map(renderTaskCard).join("");

    els.tasks.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.currentTarget.getAttribute("data-toggle");
        if (!id) return;
        if (state.expanded.has(id)) state.expanded.delete(id);
        else state.expanded.add(id);
        renderTasks();
      });
    });
  };

  const renderTaskCard = (t) => {
    const idShort = String(t.id).slice(0, 8);
    const badge = getBadgeClass(t.status);
    const created = formatDate(t.created_at);
    const updated = formatDate(t.updated_at);
    const worker = t.worker_id ? `Worker: ${t.worker_id}` : "Worker: -";
    const isOpen = state.expanded.has(t.id);

    const wc = t.metrics.word_count ?? "-";
    const cc = t.metrics.char_count ?? "-";
    const sc = t.metrics.sentence_count ?? "-";

    const sentiment = t.sentiment ? String(t.sentiment) : "-";
    const summary = t.summary ? String(t.summary) : (t.text ? String(t.text) : "-");

    const top = Array.isArray(t.top_words) ? t.top_words : [];
    const kw = Array.isArray(t.detected_keywords) ? t.detected_keywords : [];

    const chipsTop = top
      .slice(0, 8)
      .map((x) => {
        if (Array.isArray(x)) return `<span class="chip">${escapeHtml(String(x[0]))} · ${escapeHtml(String(x[1]))}</span>`;
        return `<span class="chip">${escapeHtml(String(x))}</span>`;
      })
      .join("");

    const chipsKw = kw
      .slice(0, 8)
      .map((x) => `<span class="chip">${escapeHtml(String(x))}</span>`)
      .join("");

    const detail = isOpen
      ? `<div class="pre">${escapeHtml(JSON.stringify(t.raw, null, 2))}</div>`
      : "";

    return `
      <div class="item">
        <div class="row">
          <div style="font-weight:750">Tarea ${escapeHtml(idShort)}</div>
          <span class="${badge}">${escapeHtml(t.status || "sin estado")}</span>
        </div>

        <div class="kv">${escapeHtml(worker)} · Creada: ${escapeHtml(created)} · Actualizada: ${escapeHtml(updated)}</div>

        <div class="metrics">
          <div class="metric">
            <div class="metric__label">Palabras</div>
            <div class="metric__value">${escapeHtml(String(wc))}</div>
          </div>
          <div class="metric">
            <div class="metric__label">Caracteres</div>
            <div class="metric__value">${escapeHtml(String(cc))}</div>
          </div>
          <div class="metric">
            <div class="metric__label">Oraciones</div>
            <div class="metric__value">${escapeHtml(String(sc))}</div>
          </div>
        </div>

        <div class="kv" style="margin-top:10px"><span style="font-weight:650">Sentimiento:</span> ${escapeHtml(sentiment)}</div>
        <div class="kv" style="margin-top:8px"><span style="font-weight:650">Resumen</span><br>${escapeHtml(summary)}</div>

        ${chipsTop ? `<div class="kv" style="margin-top:10px"><span style="font-weight:650">Top palabras</span></div><div class="chips">${chipsTop}</div>` : ""}
        ${chipsKw ? `<div class="kv" style="margin-top:10px"><span style="font-weight:650">Keywords detectadas</span></div><div class="chips">${chipsKw}</div>` : ""}

        <button class="toggle" type="button" data-toggle="${escapeHtml(t.id)}">Detalle</button>
        ${detail}
      </div>
    `;
  };

  const escapeHtml = (s) => {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  };

  const refreshWorkers = async () => {
    const res = await fetch(`${API_BASE}/workers`);
    const j = await safeJson(res);
    if (!j.ok) return;
    state.workers = Array.isArray(j.data) ? j.data : (j.data?.workers || []);
    renderWorkers();
  };

  const refreshTasks = async () => {
    const res = await fetch(`${API_BASE}/tasks`);
    const j = await safeJson(res);
    if (!j.ok) return;
    const list = Array.isArray(j.data) ? j.data : (j.data?.tasks || []);
    if (!Array.isArray(list)) return;

    list.forEach((raw) => {
      const t = normalizeTask(raw);
      if (!t) return;
      const prev = state.tasks.get(t.id);
      if (!prev) state.tasks.set(t.id, t);
      else state.tasks.set(t.id, { ...prev, ...t, raw: t.raw });
    });

    renderTasks();
  };

  const startSse = (taskId) => {
    if (!taskId) return;
    if (state.sse.has(taskId)) return;

    const url = `${API_BASE}/status/${encodeURIComponent(taskId)}`;
    const es = new EventSource(url);
    state.sse.set(taskId, es);

    es.onmessage = (evt) => {
      try {
        const raw = JSON.parse(evt.data);
        const t = normalizeTask(raw);
        if (!t) return;

        const prev = state.tasks.get(t.id);
        if (!prev) state.tasks.set(t.id, t);
        else state.tasks.set(t.id, { ...prev, ...t, raw: t.raw });

        renderTasks();

        const s = (t.status || "").toLowerCase();
        if (s.includes("complet") || s.includes("error") || s.includes("fail")) {
          es.close();
          state.sse.delete(taskId);
        }
      } catch {
        return;
      }
    };

    es.onerror = () => {
      es.close();
      state.sse.delete(taskId);
    };
  };

  const createTask = async () => {
    const text = (els.text?.value || "").trim();
    if (!text) {
      setMsg("Se requiere texto para analizar.");
      return;
    }

    els.btnSend.disabled = true;
    setMsg("Enviando tarea...");

    const res = await fetch(`${API_BASE}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    const j = await safeJson(res);
    if (!j.ok) {
      setMsg(`Error al crear tarea (HTTP ${j.status}).`);
      els.btnSend.disabled = false;
      return;
    }

    const taskId = j.data?.task_id || j.data?.id;
    if (!taskId) {
      setMsg("Tarea creada, pero no se recibió task_id.");
      els.btnSend.disabled = false;
      return;
    }

    setMsg(`Tarea creada: ${taskId}`);
    startSse(taskId);
    await refreshTasks();

    els.btnSend.disabled = false;
  };

  const init = async () => {
    updateClock();
    setInterval(updateClock, 1000);

    if (els.btnSend) {
      els.btnSend.addEventListener("click", createTask);
    }

    await refreshWorkers();
    await refreshTasks();

    setInterval(refreshWorkers, 5000);
    setInterval(refreshTasks, 5000);
  };

  init();
})();