import asyncio
import json
import uuid
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import redis.asyncio as aioredis

app = FastAPI(title="Analizador de Texto")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

REDIS_URL = "redis://localhost:6379"

class TextTask(BaseModel):
    text: str

@app.post("/task")
async def create_task(payload: TextTask):
    task_id = str(uuid.uuid4())
    r = await aioredis.from_url(REDIS_URL)

    task_data = {
        "task_id": task_id,
        "text": payload.text,
        "status": "pendiente",
        "created_at": datetime.utcnow().isoformat(),
        "worker_id": None,
        "result": None,
    }

    await r.set(f"task:{task_id}", json.dumps(task_data))  # Guarda el estado inicial en REDIS
    await r.lpush("task_queue", json.dumps({"task_id": task_id, "text": payload.text})) # Agrega la tarea a la cola
    await r.aclose()
    return {"task_id": task_id, "status": "pendiente"}

@app.get("/task/{task_id}")
async def task_status_sse(task_id: str):
    async def event_stream():
        r = await aioredis.from_url(REDIS_URL)
        last_status = None
        try:
            while True:
                raw = await r.get(f"task:{task_id}")
                if raw:
                    data = json.loads(raw)
                    status = data.get("status")
                    if status != last_status:
                        last_status = status
                        yield f"data: {json.dumps(data)}\n\n"
                    
                    if status in ["completada", "error"]:
                        break
                await asyncio.sleep(1)  # Espera un segundo antes de verificar nuevamente
        finally:
            await r.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

@app.get("/tasks")
async def list_tasks():
    r = await aioredis.from_url(REDIS_URL)
    keys = await r.keys("task:*")
    tasks = []
    for key in keys:
        raw = await r.get(key)
        if raw:
            tasks.append(json.loads(raw))
    await r.aclose()
    tasks.sort(key=lambda x: x["created_at"], reverse=True)
    return tasks

@app.get("/workers")
async def list_workers():
    r = await aioredis.from_url(REDIS_URL)
    keys = await r.keys("worker:*")
    workers = []
    for key in keys:
        raw = await r.get(key)
        if raw:
            workers.append(json.loads(raw))
    await r.aclose()
    return workers