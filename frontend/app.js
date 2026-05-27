(() => {
  const API_BASE =
    window.APP_API_BASE ||
    document.querySelector('meta[name="api-base"]')?.content ||
    `http://${window.location.hostname}:8000`; 

  const POLL_WORKERS_MS = 5000;
  const POLL_TASKS_MS = 8000;

  const $ = (sel) => document.querySelector(sel);

  const els = {
    text: $('#text'),
    btnSend: $('#btnSend'),
    msg: $('#msg'),
    workers: $('#workers'),
    tasks: $('#tasks'),
    backendLabel: $('#backendUrl'),
  };

  const state = {
    tasksById: new Map(),
    taskOrder: [], // array de task_id
    sseByTaskId: new Map(),
    workers: [],
  };

  const escapeHtml = (s) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  const fmtDT = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // Formato simple
    return d.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  const normalizeTopWords = (val) => {
    if (!Array.isArray(val)) return [];
    return val
      .map((x) => {
        if (Array.isArray(x)) return { word: String(x[0] ?? ''), count: Number(x[1] ?? 0) };
        if (x && typeof x === 'object') return { word: String(x.word ?? x.palabra ?? ''), count: Number(x.count ?? x.conteo ?? 0) };
        return null;
      })
      .filter(Boolean)
      .filter((x) => x.word.trim().length > 0)
      .slice(0, 10);
  };

  const taskSortKey = (t) => {
    const u = t.updated_at ? Date.parse(t.updated_at) : NaN;
    const c = t.created_at ? Date.parse(t.created_at) : NaN;
    const uKey = Number.isNaN(u) ? 0 : u;
    const cKey = Number.isNaN(c) ? 0 : c;
    return [uKey, cKey, t.task_id];
  };

  const compareTasksDesc = (a, b) => {
    const [au, ac, aid] = taskSortKey(a);
    const [bu, bc, bid] = taskSortKey(b);
    if (au !== bu) return bu - au;
    if (ac !== bc) return bc - ac;
    return String(bid).localeCompare(String(aid));
  };

  const setMsg = (text, kind = 'info') => {
    if (!els.msg) return;
    els.msg.textContent = text || '';
    els.msg.dataset.kind = kind;
  };

  const injectStyleOverrides = () => {
    const css = `
      :root{
        --bg: #0b1020;
        --panel: #101a2e;
        --panel2: #0e162a;
        --text: #e9eefb;
        --muted: rgba(233,238,251,.70);
        --border: rgba(255,255,255,.08);
        --accent: #35b3ff;
        --ok: #25c26e;
        --warn: #f6c343;
        --bad: #ff5d6c;
        --shadow: 0 18px 48px rgba(0,0,0,.35);
        --radius: 16px;
      }

      body{
        margin:0;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        color: var(--text);
        background: var(--bg);
      }

      /* más “analizador”: iluminación sutil, sin gradiente fuerte */
      body::before{
        content:"";
        position:fixed;
        inset:0;
        pointer-events:none;
        background:
          radial-gradient(1000px 600px at 20% 0%, rgba(53,179,255,.10), transparent 60%),
          radial-gradient(900px 600px at 90% 20%, rgba(34,211,238,.07), transparent 55%);
        opacity:.9;
      }

      .container{
        width: min(1280px, 95%);
        margin: 0 auto;
        padding: 28px 0 40px 0;
        position: relative;
      }

      .header{
        margin-bottom: 18px;
      }
      .header h1{
        font-size: clamp(26px, 3.2vw, 40px);
        margin: 0 0 8px 0;
        letter-spacing: .2px;
      }
      .header p{
        margin: 0 0 8px 0;
        color: var(--muted);
        line-height: 1.5;
      }
      .header .hint{
        font-size: 13px;
        color: rgba(233,238,251,.55);
      }

      .panel{
        background: rgba(16,26,46,.92);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: 18px;
        margin-bottom: 18px;
        backdrop-filter: blur(10px);
      }

      textarea{
        width: 100%;
        min-height: 110px;
        resize: vertical;
        padding: 12px 12px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(14,22,42,.85);
        color: var(--text);
        outline: none;
        line-height: 1.5;
      }
      textarea::placeholder{ color: rgba(233,238,251,.45); }

      .row{
        display:flex;
        align-items:center;
        gap: 12px;
        margin-top: 12px;
        flex-wrap: wrap;
      }

      button{
        appearance:none;
        border: 0;
        cursor:pointer;
        background: linear-gradient(180deg, rgba(53,179,255,1), rgba(53,179,255,.85));
        color: #07101f;
        font-weight: 700;
        padding: 10px 16px;
        border-radius: 12px;
        box-shadow: 0 10px 24px rgba(53,179,255,.18);
      }
      button:disabled{
        opacity:.55;
        cursor:not-allowed;
      }

      .muted{ color: var(--muted); }

      .grid{
        display:grid;
        grid-template-columns: 320px 1fr;
        gap: 18px;
      }
      @media (max-width: 980px){
        .grid{ grid-template-columns: 1fr; }
      }

      .list{
        display:flex;
        flex-direction:column;
        gap: 12px;
      }

      .card{
        border: 1px solid rgba(255,255,255,.08);
        background: rgba(14,22,42,.82);
        border-radius: 14px;
        padding: 14px;
      }

      .worker-title{
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:10px;
        margin-bottom: 6px;
      }
      .badge{
        display:inline-flex;
        align-items:center;
        gap:8px;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(255,255,255,.06);
        color: rgba(233,238,251,.85);
      }
      .dot{
        width: 9px; height: 9px; border-radius: 99px;
        background: rgba(233,238,251,.45);
      }
      .dot.ok{ background: var(--ok); }
      .dot.warn{ background: var(--warn); }
      .dot.bad{ background: var(--bad); }

      .task-header{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      .task-id{
        font-weight: 700;
        letter-spacing: .2px;
        word-break: break-all;
      }

      .pill{
        font-size: 12px;
        font-weight: 700;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.12);
        background: rgba(255,255,255,.06);
      }
      .pill.ok{ border-color: rgba(37,194,110,.35); background: rgba(37,194,110,.10); }
      .pill.warn{ border-color: rgba(246,195,67,.35); background: rgba(246,195,67,.10); }
      .pill.bad{ border-color: rgba(255,93,108,.35); background: rgba(255,93,108,.10); }

      .metrics{
        display:grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin: 10px 0 12px 0;
      }
      @media (max-width: 560px){
        .metrics{ grid-template-columns: 1fr; }
      }
      .metric{
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(255,255,255,.05);
        border: 1px solid rgba(255,255,255,.08);
      }
      .metric .k{ font-size: 12px; color: rgba(233,238,251,.65); }
      .metric .v{ font-size: 18px; font-weight: 800; margin-top: 3px; }

      .chips{
        display:flex;
        flex-wrap:wrap;
        gap: 8px;
        margin-top: 8px;
      }
      .chip{
        font-size: 12px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(255,255,255,.06);
      }

      .toggle{
        margin-top: 10px;
        color: var(--accent);
        font-weight: 700;
        cursor:pointer;
        user-select:none;
        display:inline-flex;
        gap:8px;
        align-items:center;
      }
      .json{
        margin-top: 10px;
        display:none;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(0,0,0,.25);
        overflow:auto;
        max-height: 320px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.45;
      }
      .json.open{ display:block; }
    `;

    const style = document.createElement('style');
    style.id = 'app-style-overrides';
    style.textContent = css;
    document.head.appendChild(style);
  };

  const apiGet = async (path) => {
    const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} en GET ${path}`);
    return res.json();
  };

  const apiPost = async (path, body) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} en POST ${path}${txt ? `: ${txt}` : ''}`);
    }
    return res.json();
  };

  const statusPill = (status) => {
    const s = String(status || '').toLowerCase();
    if (s.includes('complet') || s.includes('done') || s.includes('ok')) return { cls: 'ok', label: 'Completada' };
    if (s.includes('pend') || s.includes('run') || s.includes('proces')) return { cls: 'warn', label: 'Procesando' };
    if (s.includes('fail') || s.includes('error')) return { cls: 'bad', label: 'Error' };
    return { cls: 'warn', label: status || 'Pendiente' };
  };

  const renderWorkers = () => {
    if (!els.workers) return;
    if (!Array.isArray(state.workers) || state.workers.length === 0) {
      els.workers.innerHTML = `<div class="muted">Sin workers registrados.</div>`;
      return;
    }

    const html = state.workers
      .slice()
      .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
      .map((w) => {
        const st = String(w.status || 'unknown').toLowerCase();
        const dotCls =
          st.includes('idle') ? 'ok' : st.includes('busy') || st.includes('work') ? 'warn' : 'bad';

        return `
          <div class="card">
            <div class="worker-title">
              <div style="font-weight:800">${escapeHtml(w.id || 'worker')}</div>
              <span class="badge"><span class="dot ${dotCls}"></span>${escapeHtml(w.status || 'unknown')}</span>
            </div>
            <div class="muted" style="font-size:12px">last_seen: ${escapeHtml(w.last_seen || '—')}</div>
          </div>
        `;
      })
      .join('');

    els.workers.innerHTML = html;
  };

  const renderTaskCard = (t) => {
    const pill = statusPill(t.status);
    const topWords = normalizeTopWords(t.result?.top_words || t.top_words);
    const wordCount = t.result?.word_count ?? t.word_count ?? 0;
    const charCount = t.result?.char_count ?? t.char_count ?? 0;
    const sentCount = t.result?.sentence_count ?? t.sentence_count ?? 0;

    const sentiment = t.result?.sentiment ?? t.sentiment;
    const summary = t.result?.summary ?? t.summary;

    const workerId = t.worker_id || t.worker || '—';

    const created = fmtDT(t.created_at);
    const updated = fmtDT(t.updated_at);

    const summaryText = summary ? escapeHtml(summary) : '<span class="muted">Sin resumen.</span>';

    const topWordsHtml =
      topWords.length === 0
        ? `<div class="muted" style="font-size:13px">Sin palabras destacadas.</div>`
        : `<div class="chips">${topWords
            .map((x) => `<span class="chip">${escapeHtml(x.word)} · ${escapeHtml(x.count)}</span>`)
            .join('')}</div>`;

    const sentimentHtml =
      sentiment == null || sentiment === ''
        ? `<span class="muted">—</span>`
        : `<span class="chip">${escapeHtml(sentiment)}</span>`;

    const json = escapeHtml(JSON.stringify(t, null, 2));

    return `
      <div class="card" id="task-${escapeHtml(t.task_id)}">
        <div class="task-header">
          <div>
            <div class="task-id">${escapeHtml(t.task_id)}</div>
            <div class="muted" style="font-size:12px;margin-top:4px">
              Worker: <b>${escapeHtml(workerId)}</b> · Creada: ${escapeHtml(created)} · Actualizada: ${escapeHtml(updated)}
            </div>
          </div>
          <span class="pill ${pill.cls}">${escapeHtml(pill.label)}</span>
        </div>

        <div class="metrics">
          <div class="metric"><div class="k">Palabras</div><div class="v">${escapeHtml(wordCount)}</div></div>
          <div class="metric"><div class="k">Caracteres</div><div class="v">${escapeHtml(charCount)}</div></div>
          <div class="metric"><div class="k">Oraciones</div><div class="v">${escapeHtml(sentCount)}</div></div>
        </div>

        <div style="margin-top:10px">
          <div class="k" style="font-size:12px;color:rgba(233,238,251,.65);font-weight:700;letter-spacing:.08em">SENTIMIENTO</div>
          <div style="margin-top:8px">${sentimentHtml}</div>
        </div>

        <div style="margin-top:12px">
          <div class="k" style="font-size:12px;color:rgba(233,238,251,.65);font-weight:700;letter-spacing:.08em">RESUMEN</div>
          <div style="margin-top:8px; line-height:1.55">${summaryText}</div>
        </div>

        <div style="margin-top:12px">
          <div class="k" style="font-size:12px;color:rgba(233,238,251,.65);font-weight:700;letter-spacing:.08em">TOP PALABRAS</div>
          ${topWordsHtml}
        </div>

        <div class="toggle" data-toggle-json="${escapeHtml(t.task_id)}">▶ Ver JSON completo</div>
        <pre class="json" data-json="${escapeHtml(t.task_id)}">${json}</pre>
      </div>
    `;
  };

  const renderTasks = () => {
    if (!els.tasks) return;

    const tasks = state.taskOrder
      .map((id) => state.tasksById.get(id))
      .filter(Boolean);

    if (tasks.length === 0) {
      els.tasks.innerHTML = `<div class="muted">Aún no hay tareas.</div>`;
      return;
    }

    els.tasks.innerHTML = tasks.map(renderTaskCard).join('');

    els.tasks.querySelectorAll('[data-toggle-json]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const taskId = btn.getAttribute('data-toggle-json');
        const pre = els.tasks.querySelector(`[data-json="${CSS.escape(taskId)}"]`);
        if (!pre) return;
        const isOpen = pre.classList.toggle('open');
        btn.textContent = isOpen ? '▼ Ocultar JSON' : '▶ Ver JSON completo';
      });
    });
  };

  const upsertTasks = (taskList) => {
    let changed = false;

    for (const t of taskList) {
      if (!t || !t.task_id) continue;
      const prev = state.tasksById.get(t.task_id);
      state.tasksById.set(t.task_id, { ...(prev || {}), ...t });
      changed = true;
    }

    if (!changed) return;

    const all = Array.from(state.tasksById.values()).sort(compareTasksDesc);
    state.taskOrder = all.map((t) => t.task_id);
    renderTasks();
  };

  const attachSSE = (taskId) => {
    if (!taskId) return;
    if (state.sseByTaskId.has(taskId)) return;

    const es = new EventSource(`${API_BASE}/status/${taskId}`);
    state.sseByTaskId.set(taskId, es);

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data && data.task_id) {
          upsertTasks([data]);
        }

        const st = String(data?.status || '').toLowerCase();
        if (st.includes('complet') || st.includes('fail') || st.includes('error')) {
          es.close();
          state.sseByTaskId.delete(taskId);
        }
      } catch {
      }
    };

    es.onerror = () => {
      es.close();
      state.sseByTaskId.delete(taskId);
    };
  };

  const refreshWorkers = async () => {
    try {
      const data = await apiGet('/workers');
      state.workers = Array.isArray(data) ? data : [];
      renderWorkers();
    } catch (e) {
    }
  };

  const refreshTasks = async () => {
    try {
      const data = await apiGet('/tasks');
      if (Array.isArray(data)) upsertTasks(data);
      for (const t of state.taskOrder.slice(0, 10)) {
        const obj = state.tasksById.get(t);
        const st = String(obj?.status || '').toLowerCase();
        if (st.includes('pend') || st.includes('proces') || st.includes('run')) {
          attachSSE(obj.task_id);
        }
      }
    } catch (e) {
    }
  };

  const createTask = async () => {
    const text = els.text?.value ?? '';
    const trimmed = text.trim();
    if (!trimmed) {
      setMsg('Se requiere texto para analizar.', 'warn');
      return;
    }

    try {
      setMsg('Enviando tarea…', 'info');
      if (els.btnSend) els.btnSend.disabled = true;

      const res = await apiPost('/task', { text: trimmed });

      const taskId = res?.task_id;
      if (!taskId) throw new Error('Respuesta inválida: falta task_id');

      const nowIso = new Date().toISOString();
      upsertTasks([
        {
          task_id: taskId,
          status: res.status || 'pendiente',
          created_at: nowIso,
          updated_at: nowIso,
          worker_id: res.worker_id || res.worker || '',
          result: null,
        },
      ]);

      attachSSE(taskId);

      setMsg(`Tarea creada: ${taskId}`, 'ok');

    } catch (e) {
      setMsg(`Error al crear tarea: ${e.message}`, 'bad');
    } finally {
      if (els.btnSend) els.btnSend.disabled = false;
    }
  };

  const boot = async () => {
    injectStyleOverrides();

    if (els.backendLabel) els.backendLabel.textContent = `Backend: ${API_BASE}`;

    if (els.btnSend) {
      els.btnSend.addEventListener('click', (ev) => {
        ev.preventDefault();
        createTask();
      });
    }

    await Promise.allSettled([refreshWorkers(), refreshTasks()]);

    setInterval(refreshWorkers, POLL_WORKERS_MS);
    setInterval(refreshTasks, POLL_TASKS_MS);
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
