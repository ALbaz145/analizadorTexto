const API_BASE = "http://localhost:18000";
const $ = (id) => document.getElementById(id);

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function upsertTask(task) {
  const box = $("tasks");
  const id = task.task_id;
  let card = box.querySelector(`[data-task-id="${id}"]`);
  if (!card) {
    card = document.createElement("div");
    card.className = "item";
    card.dataset.taskId = id;
    box.prepend(card);
  }
  card.innerHTML = `
    <div class="title">${id}</div>
    <div class="muted">Estado: ${task.status}${task.worker_id ? ` · Worker: ${task.worker_id}` : ""}</div>
    ${task.result ? `<pre class="pre">${JSON.stringify(task.result, null, 2)}</pre>` : ""}
    ${task.error ? `<div class="error">${task.error}</div>` : ""}
  `;
}

function watchTask(taskId) {
  const es = new EventSource(`${API_BASE}/status/${taskId}`);
  es.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    upsertTask(data);
    if (data.status === "completada" || data.status === "error") es.close();
  };
  es.onerror = () => es.close();
}

async function refreshWorkers() {
  const workers = await fetchJSON(`${API_BASE}/workers`);
  const box = $("workers");
  box.innerHTML = "";
  if (!workers.length) {
    box.innerHTML = `<div class="item muted">Sin workers activos.</div>`;
    return;
  }
  workers.forEach(w => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="title">${w.worker_id}</div>
      <div class="muted">${w.status}${w.task_id ? ` · ${w.task_id}` : ""}</div>
      <div class="muted small">last_seen: ${w.last_seen}</div>
    `;
    box.appendChild(div);
  });
}

async function refreshTasks() {
  const tasks = await fetchJSON(`${API_BASE}/tasks`);
  $("tasks").innerHTML = "";
  tasks.forEach(upsertTask);
}

async function createTask(text) {
  const data = await fetchJSON(`${API_BASE}/task`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ text }),
  });
  return data.task_id;
}

async function main() {
  $("btnSend").addEventListener("click", async () => {
    $("msg").textContent = "";
    const text = $("text").value.trim();
    if (!text) {
      $("msg").textContent = "Se requiere texto.";
      return;
    }
    $("btnSend").disabled = true;
    try {
      const id = await createTask(text);
      $("msg").textContent = `Tarea creada: ${id}`;
      watchTask(id);
      await refreshTasks();
    } catch (e) {
      $("msg").textContent = `Error: ${e.message}`;
    } finally {
      $("btnSend").disabled = false;
    }
  });

  await refreshWorkers();
  await refreshTasks();
  setInterval(refreshWorkers, 2000);
}

main();