FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# runtime deps (Pillow + OpenCV-free)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Download Open Images vocab at build time (optional; will also download at runtime if missing)
RUN python build_vocab.py

EXPOSE 8080
CMD ["uvicorn", "app:app", "--host=0.0.0.0", "--port=8080"]
