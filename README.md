# Analizador de Texto

Sistema distribuido de análisis de texto con arquitectura basada en colas, workers concurrentes y actualización en tiempo real mediante Server-Sent Events (SSE).

<img width="1261" height="901" alt="image" src="https://github.com/user-attachments/assets/951573d5-f270-4401-a7d3-5efad81c6c0a" />


---

## ¿Qué hace?

El usuario envía un fragmento de texto desde el frontend. La tarea se encola en Redis y es tomada por uno de los tres workers disponibles, que la procesa y guarda el resultado. El frontend se actualiza automáticamente via SSE sin necesidad de recargar la página.

El análisis incluye:

- Conteo de palabras, caracteres y oraciones
- Top 5 palabras más frecuentes (excluyendo stopwords en español)
- Detección de categorías temáticas (tecnología, deportes, ciencia, arte, negocios, educación)
- Análisis de sentimiento (positivo / negativo / neutral)
- Resumen automático (primera oración del texto)

---

**Flujo de una tarea:**

1. El frontend hace `POST /task` con el texto.
2. El backend guarda el estado inicial en Redis y encola la tarea (`lpush task_queue`).
3. Uno de los workers toma la tarea con `brpop` (bloqueante), la procesa y actualiza el estado en Redis.
4. El frontend recibe actualizaciones en tiempo real a través de SSE (`GET /status/:id`).

---

## Requisitos

- [Docker](https://docs.docker.com/get-docker/) y [Docker Compose](https://docs.docker.com/compose/)

---

## Inicio rápido

```bash
# Clonar el repositorio
git clone <url-del-repo>
cd <nombre-del-repo>

# Levantar todos los servicios
docker compose up --build

# En segundo plano
docker compose up --build -d
```

Abrir el navegador en **http://localhost:5173**

---

## Estructura del proyecto

```
.
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── main.py          # API FastAPI (endpoints + SSE)
│   └── requirements.txt
├── frontend/
│   ├── Dockerfile       # Nginx sirve los estáticos
│   ├── index.html
│   ├── app.js           # Lógica de UI + SSE client
│   └── style.css
└── worker/
    ├── Dockerfile
    └── worker.py        # Lógica de análisis de texto
```

---

## API

### `POST /task`
Crea una nueva tarea de análisis.

**Body:**
```json
{ "text": "Texto a analizar..." }
```

**Respuesta:**
```json
{ "task_id": "uuid", "status": "pendiente" }
```

### `GET /status/{task_id}`
Stream SSE con actualizaciones de estado de la tarea. Emite eventos hasta que el estado sea `completada` o `error`.

### `GET /tasks`
Lista todas las tareas almacenadas en Redis, ordenadas por fecha de creación (más reciente primero).

### `GET /workers`
Lista los workers activos con su estado actual y último heartbeat. Los workers se registran cada 3 segundos; si no hay actividad en 10 s, desaparecen del listado.

---

## Workers

Se levantan tres workers (`worker1`, `worker2`, `worker3`) que compiten por las tareas de la cola. Cada worker:

- Registra un **heartbeat** en Redis cada ciclo (`setex` con TTL de 10 s).
- Toma tareas con `brpop` (espera bloqueante de hasta 3 s).
- Actualiza el estado de la tarea: `pendiente` → `en proceso` → `completada` / `error`.
- Simula un tiempo de procesamiento de 2 segundos.

Para escalar el número de workers, basta con añadir más servicios en `docker-compose.yml`:

```yaml
worker4:
  build: ./worker
  environment:
    - REDIS_URL=redis://redis:6379
    - WORKER_ID=worker4
  depends_on:
    redis:
      condition: service_healthy
  restart: unless-stopped
```

---

## Variables de entorno

| Variable     | Servicio | Default                  | Descripción               |
|--------------|----------|--------------------------|---------------------------|
| `REDIS_URL`  | backend  | `redis://redis:6379`     | URL de conexión a Redis   |
| `REDIS_URL`  | worker   | `redis://redis:6379`     | URL de conexión a Redis   |
| `WORKER_ID`  | worker   | `worker-unknown`         | Identificador del worker  |

---

## Comandos útiles

```bash
# Ver logs de todos los servicios
docker compose logs -f

# Ver logs de un servicio específico
docker compose logs -f worker1

# Detener y eliminar contenedores
docker compose down

# Detener, eliminar contenedores y volúmenes (limpia Redis)
docker compose down -v

# Reconstruir solo un servicio
docker compose up --build backend
```

---

## Tecnologías utilizadas

- **FastAPI** — Framework web asíncrono para el backend
- **Redis** — Cola de tareas y almacén de estado
- **Server-Sent Events (SSE)** — Actualización en tiempo real sin WebSockets
- **Nginx** — Servidor de archivos estáticos para el frontend
- **Docker Compose** — Orquestación de todos los servicios
