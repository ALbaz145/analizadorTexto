FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir redis==5.0.4

COPY worker.py .

CMD ["python", "-u", "worker.py"]