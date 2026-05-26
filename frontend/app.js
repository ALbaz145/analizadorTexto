// CONFIGURACIÓN DEL ENDPOINT (Ajustar si cambian el puerto del backend)
// =========================================================================
const API_URL = "http://localhost:8000";

// SELECTORES DEL DOM
const textInput = document.getElementById("text-input");
const btnAnalizar = document.getElementById("btn-analizar");
const statusCard = document.getElementById("status-card");
const statusText = document.getElementById("status-text");
const spinner = document.getElementById("spinner");
const resultsBox = document.getElementById("results-box");
const resultsContent = document.getElementById("results-content");
const historyList = document.getElementById("history-list");
const workersList = document.getElementById("workers-list");

// 1. ENVÍO DE TAREAS (Uso de Fetch API)
// =========================================================================
btnAnalizar.addEventListener("click", async () => {
    const texto = textInput.value.trim();
    if (!texto) {
        alert("Por favor, ingresa un texto para analizar.");
        return;
    }

    try {
        btnAnalizar.disabled = true;
        mostrarEstadoUI("pendiente");

        // Llamada exacta a POST /task de tu main.py
        const response = await fetch(`${API_URL}/task`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: texto })
        });

        if (!response.ok) throw new Error("Error en el servidor");

        const task = await response.json(); // Devuelve {"task_id": "...", "status": "pendiente"}
        
        // Guardar en Storage (Requisito de la rubrica)
        guardarEnStorage(task.task_id, texto.substring(0, 40) + "...");

        // Conectar de inmediato al SSE usando el endpoint correcto /status/{id}
        conectarAStatusSSE(task.task_id);

    } catch (error) {
        console.error(error);
        mostrarEstadoUI("error");
        btnAnalizar.disabled = false;
    }
});

// 2. ESCUCHAR ESTADOS EN TIEMPO REAL (Server-Sent Events - SSE)
// =========================================================================
function conectarAStatusSSE(taskId) {
    // Apunta de forma exacta adel ndpoint GET /status/{task_id} de main.py
    const eventSource = new EventSource(`${API_URL}/status/${taskId}`);

    eventSource.onmessage = (event) => {
        const taskData = JSON.parse(event.data);
        const status = taskData.status; // "pendiente", "en proceso", "completada", "error"

        console.log(`SSE Update [${taskId}]: ${status}`);
        mostrarEstadoUI(status, taskData);

        // Si llegó a un estado final, liberamos la conexión
        if (status === "completada" || status === "error") {
            eventSource.close();
            btnAnalizar.disabled = false;
        }
    };

    eventSource.onerror = (err) => {
        console.error("Fallo en la conexión SSE:", err);
        eventSource.close();
        mostrarEstadoUI("error");
        btnAnalizar.disabled = false;
    };
}

// 3. ACTUALIZACIÓN DEL DOM DINÁMICO (MAPEADO DE WORKER)
// =========================================================================
function mostrarEstadoUI(status, data = null) {
    // Limpiar clases previas
    statusCard.classList.remove("status-hidden", "status-pendiente", "status-proceso", "status-completada", "status-error");
    statusText.classList.remove("pulse");
    spinner.classList.add("hidden");
    resultsBox.classList.add("hidden");

    // Asignar clase de color morado/azul correspondiente según el estado
    statusCard.classList.add(`status-${status}`);
    statusText.innerText = status.toUpperCase();

    if (status === "pendiente") {
        statusText.classList.add("pulse");
    } 
    else if (status === "en proceso") {
        statusText.classList.add("pulse");
        spinner.classList.remove("hidden");
    } 
    else if (status === "completada" && data && data.result) {
        resultsBox.classList.remove("hidden");
        
        const res = data.result; // El JSON interno que genera el Worker
        
        // CORRECCIÓN CLAVE: Nombres exactos de las propiedades 
        const conteoPalabras = res.word_count || 0;
        const totalCaracteres = res.char_count || 0;
        const totalOraciones = res.sentence_count || 0;
        
        // Extraer las palabras más frecuentes del array de ARRAYS DEL WORKER
        const palabrasFrecuentes = res.top_words && res.top_words.length > 0 
            ? res.top_words.map(item => `${item[0]} (${item[1]})`).join(", ") 
            : "Ninguna";
            
        //  CLASIFICACION POR TEMA Y MODO (AJUSTADO A LO QUE DEVUELVA EL ALGORITMO DE MI EQUIPO
        const temaTexto = res.detected_topic || res.topic || "Tecnología (Simulado)";
        const modoTexto = res.detected_mode || res.mode || "Indicativo (Simulado)";

        resultsContent.innerHTML = `
            <div class="result-item"><strong>📊 Conteo de palabras:</strong> ${conteoPalabras} palabras</div>
            <div class="result-item"><strong>🔤 Total de caracteres:</strong> ${totalCaracteres}</div>
            <div class="result-item"><strong>🧮 Total de oraciones:</strong> ${totalOraciones}</div>
            <div class="result-item"><strong>🔝 Palabras más frecuentes:</strong> ${palabrasFrecuentes}</div>
            <div class="result-item"><strong>🏷️ Clasificación por Tema:</strong> ${temaTexto}</div>
            <div class="result-item"><strong>🎭 Modo del Texto:</strong> ${modoTexto}</div>
            <div class="result-item"><small style="color:var(--text-muted)">Procesado con éxito por: ${data.worker_id || "worker_active"}</small></div>
        `;
    } 
    else if (status === "error") {
        resultsBox.classList.remove("hidden");
        resultsContent.innerHTML = `<div class="result-item" style="color:var(--status-error)">❌ Ocurrió un fallo en el procesamiento del Worker o la cola de Redis.</div>`;
    }
}


// 4. HISTORIAL LOCAL (Uso de Storage)
// =========================================================================
function guardarEnStorage(id, extracto) {
    let historial = JSON.parse(localStorage.getItem("analizador_historial")) || [];
    historial.unshift({ id, extracto, hora: new Date().toLocaleTimeString() });
    
    if (historial.length > 5) historial.pop(); // Mantener solo los últimos 5

    localStorage.setItem("analizador_historial", JSON.stringify(historial));
    renderizarHistorial();
}

function renderizarHistorial() {
    let historial = JSON.parse(localStorage.getItem("analizador_historial")) || [];
    historyList.innerHTML = "";
    
    if (historial.length === 0) {
        historyList.innerHTML = `<li>No hay análisis recientes.</li>`;
        return;
    }

    historial.forEach(item => {
        const li = document.createElement("li");
        li.innerHTML = `⏰ ${item.hora} - <strong>ID:</strong> ${item.id.substring(0,8)}...<br><span style="color:var(--text-muted)">${item.extracto}</span>`;
        historyList.appendChild(li);
    });
}

// 5. MONITOR DE WORKERS EN TIEMPO REAL (Puntos Extra)
// =========================================================================
async function actualizarMonitorWorkers() {
    try {
        // Llamada exacta al endpoint GET /workers DE MI main.py
        const response = await fetch(`${API_URL}/workers`);
        if (!response.ok) throw new Error();
        
        const workers = await response.json();
        workersList.innerHTML = "";

        if (workers.length === 0) {
            workersList.innerHTML = `<li>⚠️ No hay workers registrados en la cola de Redis.</li>`;
            return;
        }

        workers.forEach(w => {
            const li = document.createElement("li");
            // MUESTRA CADA DOCKER ACTIVO 
            li.innerHTML = `
                <span class="worker-badge worker-online"></span>
                <strong>ID:</strong> ${w.worker_id || "Docker Worker"} <br>
                <small style="color:var(--text-muted)">Estado: ${w.status || "idle"} | Última conexión: ${w.last_seen ? w.last_seen.substring(11,19) : 'En vivo'}</small>
            `;
            workersList.appendChild(li);
        });
    } catch (err) {
        workersList.innerHTML = `<li style="color:var(--status-error)">Error al conectar con monitor de workers.</li>`;
    }
}

// INICIO AUTOMATICO
document.addEventListener("DOMContentLoaded", () => {
    renderizarHistorial();
    actualizarMonitorWorkers();
    
    // Polling cada 5 segundos para actualizar el estado del Clúster de Docker Workers
    setInterval(actualizarMonitorWorkers, 5000);
});