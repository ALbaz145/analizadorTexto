import json
import os
import re
import time
from collections import Counter
from datetime import datetime
import redis

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
WORKER_ID = os.getenv("WORKER_ID", "worker-unknown")

r = redis.from_url(REDIS_URL, decode_responses=True)

STOPWORDS = {
    "el", "la", "los", "las", "un","una", "unos", "unas", "y", "o", "pero", 
    "si", "mientras", "con", "a", "de", "en", "por", "es", "son", "fue", 
    "fueron", "ser", "sido","este", "esa", "estos", "esas"
}

def analyze_text(text: str) -> dict:
    words = re.findall(r'\b[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ]+\b', text.lower())
    sentences = [s.strip()  for s in re.split(r'[.!?]+', text) if s.strip()]

    word_count = len(words)
    char_count = len(text)
    sentence_count = len(sentences)

    meaningful_words = [w for w in words if w not in STOPWORDS and len(w) > 2]
    top_words = Counter(meaningful_words).most_common(5)

    categories = {
        "tecnologia": ["software", "hardware", "programación", "inteligencia artificial", "redes", "computadora"],
        "deportes": ["fútbol", "baloncesto", "tenis", "atletismo", "deporte"],
        "ciencia": ["investigación", "experimento", "teoría", "científico", "descubrimiento"],
        "arte": ["pintura", "música", "literatura", "escultura", "arte"],
        "negocios": ["empresa", "mercado", "finanzas", "inversion", "negocio"],
        "educacion": ["escuela", "universidad", "estudiante", "profesor", "educación"],
    }
    detected = [cat for cat, kws in categories.items() if any(w in text.lower() for w in kws)]

    positive = {"bueno", "excelente", "maravilloso", "positivo", "feliz", "genial", "fantástico", "agradable"}
    negative = {"malo", "terrible", "horrible", "negativo", "triste", "deprimente", "desagradable"}
    pos = sum(1 for w in words if w in positive)
    neg = sum(1 for w in words if w in negative)
    sentiment = "positivo" if pos > neg else "negativo" if neg > pos else "neutral"

    summary = sentences[0][:120] + "..." if sentences and len(sentences[0]) > 120 else (sentences[0] if sentences else text[:100])

    return {
        "word_count": word_count,
        "char_count": char_count,
        "sentence_count": sentence_count,
        "top_words": top_words,
        "detected_keywords": detected,
        "sentiment": sentiment,
        "summary": summary,
    }

def update_task(task_id: str, status: str, result=None, error=None):
    raw = r.get(f"task:{task_id}")
    if not raw:
        return
    data = json.loads(raw)
    data["status"] = status
    data["worker_id"] = WORKER_ID
    data["updated_at"] = datetime.utcnow().isoformat()
    if result:
        data["result"] = result
    if error:
        data["error"] = error
    r.set(f"task:{task_id}", json.dumps(data))

def heartbeat(status = "idle", task_id=None):
    payload = {
        "worker_id": WORKER_ID,
        "status": status,
        "task_id": task_id,
        "last_seen": datetime.utcnow().isoformat(),
    }
    r.setex(f"worker:{WORKER_ID}", json.dumps(payload), 10)

    print(f"[{WORKER_ID}] Listo para procesar tareas...")

    while True:
        heartbeat("idle")
        result = r.blpop("tasks:queue", timeout=3)

        if result is None:
            continue

        _, raw_task = result
        task = json.loads(raw_task)
        task_id = task["task_id"]
        text = task["text"]

        print(f"[{WORKER_ID}] Tomando tarea {task_id}...")
        heartbeat("busy", task_id)
        update_task(task_id, "en progreso")

        try:
            time.sleep(2)
            analysis = analyze_text(text)
            update_task(task_id, "completada", result=analysis)
            print(f"[{WORKER_ID}] Tarea {task_id} completada.")
        except Exception as e:
            update_task(task_id, "error", error=str(e))
            print(f"[{WORKER_ID}] Error en tarea {task_id}: {e}")