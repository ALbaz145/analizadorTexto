import json
import os
import re
import time
from collections import Counter
from datetime import datetime, timezone
import redis

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
WORKER_ID = os.getenv("WORKER_ID", "worker-unknown")

r = redis.from_url(REDIS_URL, decode_responses=True)

STOPWORDS = {
    "a","acá","ahí","al","algo","algunas","algunos","allá","allí","ambos","ante","antes","aquel","aquella","aquellas",
    "aquello","aquellos","aqui","aquí","arriba","asi","atras","aun","aunque","bajo","bastante","bien","cada","casi",
    "como","cómo","con","conmigo","consigo","consigue","consiguen","consigues","contigo","contra","cual",
    "cuales","cualquier","cuando","cuanto","de","del","desde","donde","dos","el","él","ella","ellas","ello","ellos",
    "en","encima","entonces","entre","era","eramos","eran","eras","eres","es","esa","esas","ese","eso","esos","esta",
    "estado","estais","estamos","estan","estar","estas","este","esto","estos","estoy","etc","fue","fueron","fui","fuimos",
    "ha","hace","hacen","hacer","hacia","hasta","incluso","intenta","ir","jamás","junto","la","las","lo","los","mas","más",
    "me","menos","mi","mis","misma","mismas","mismo","mismos","mucha","muchas","mucho","muchos","muy","nada","ni","ningun",
    "ninguna","ningunas","ninguno","ningunos","no","nos","nosotras","nosotros","nuestra","nuestras","nuestro","nuestros",
    "nunca","os","otra","otras","otro","otros","para","pero","poca","pocas","poco","pocos","por","porque","puede","pueden",
    "puedo","pues","que","qué","quien","quienes","quizas","quizá","se","segun","ser","si","sí","siempre","sin","sobre","solo",
    "somos","soy","su","sus","también","tener","tengo","ti","tiene","tienen","toda","todas","todavia","todavía","todo","todos",
    "tras","tu","tú","tus","un","una","unas","uno","unos","usted","ustedes","va","vamos","van","varias","varios","voy","yo"
}

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

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

    positive = {
        "excelente","increíble","genial","fantástico","maravilloso","perfecto","agradable","feliz","contento",
        "encantado","satisfecho","emocionante","positivo","eficiente","rápido","útil","recomendado","confiable",
        "amable","brillante","impresionante","bonito","hermoso","espectacular","fabuloso","magnífico","sobresaliente",
        "inspirador","agradable","divertido","innovador","creativo","inteligente","amigable","accesible","seguro","estable",
        "potente","práctico","cómodo","económico","valioso","exitoso","favorable","optimista","motivado","respetuoso","honesto",
        "eficaz","calidad","limpio","organizado","rápida","agradó","encanta","amo","adoro","disfruto","aprobado","genialidad",
        "sorprendente","destacado","admirable","talentoso","competente","funcional","fluido","reliable","premium","extraordinario",
        "excelso","agradablemente","eficientemente","bien","mejor","mejora","perfectamente","recomendable","agradables","positiva",
        "positivas","positivos"
    }
    negative = {
        "malo","terrible","horrible","pésimo","defectuoso","lento","decepcionante","feo","inútil","problemático","caro","molesto",
        "odio","frustrante","incorrecto","falló","dañado","negativo","triste","enojado","desastroso","aburrido","ridículo","inaceptable",
        "insuficiente","mediocre","complicado","confuso","deficiente","inestable","pobre","agresivo","desagradable","hostil","irritante",
        "molestia","basura","fraude","engaño","falso","mentira","odioso","detestable","lamentable","vergonzoso","patético","inservible",
        "débil","pesado","sucio","roto","fallando","terriblemente","desordenado","alarmante","peligroso","grave","crítico","error","errores",
        "falla","fallas","bug","bugs","crash","bloqueado","corrupto","spam","tóxico","violento","ofensivo","amargo","deprimente","desmotivado",
        "estresante","cancelado","rechazado","peor","fatal","mal","negativa","negativas","negativos"
    }
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
    data["updated_at"] = utc_now_iso()
    if result is not None:
        data["result"] = result
    if error is not None:
        data["error"] = error
    r.set(f"task:{task_id}", json.dumps(data))

def heartbeat(status = "idle", task_id=None):
    payload = {
        "worker_id": WORKER_ID,
        "status": status,
        "task_id": task_id,
        "last_seen": utc_now_iso(),
    }
    r.setex(f"worker:{WORKER_ID}", 10, json.dumps(payload))

print(f"[{WORKER_ID}] Listo para procesar tareas...")

while True:
    heartbeat("idle")
    result = r.brpop("task_queue", timeout=3)

    if result is None:
        continue

    _, raw_task = result
    task = json.loads(raw_task)
    task_id = task["task_id"]
    text = task["text"]
    print(f"[{WORKER_ID}] Tomando tarea {task_id}...")
    heartbeat("busy", task_id)
    update_task(task_id, "en proceso")
    try:
        time.sleep(2)
        analysis = analyze_text(text)
        update_task(task_id, "completada", result=analysis)
        print(f"[{WORKER_ID}] Tarea {task_id} completada.")
    except Exception as e:
        update_task(task_id, "error", error=str(e))
        print(f"[{WORKER_ID}] Error en tarea {task_id}: {e}")