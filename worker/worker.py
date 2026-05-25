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