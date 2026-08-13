# ── Backend: FastAPI + Uvicorn ────────────────────────────────────────────────
FROM python:3.11-slim

# FastAPI/uvicorn are pure-Python, but the OCR stack (easyocr/torch/pymupdf/
# pytesseract) needs native shared libs that "slim" doesn't ship, plus the
# tesseract binary that pytesseract shells out to. Install them up front so
# `import fitz`, `import easyocr`, and pytesseract work at runtime. OCR degrades
# gracefully when ENABLE_OCR=False, but tesseract stays installed regardless.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl \
      libgomp1 libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
      tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source. backend/.env and backend/venv are excluded via
# .dockerignore so no local secrets leak into the image.
COPY . .

# Non-root user (the app runs Uvicorn which binds 0.0.0.0).
RUN useradd --system --create-home --shell /bin/bash appuser \
    && chown -R appuser:appuser /app
USER appuser

ENV PYTHONUNBUFFERED=1 PORT=8000 HOST=0.0.0.0
EXPOSE 8000

# `app` package lives at /app/app; uvicorn imports app.main:app from WORKDIR=/app.
# Lifespan (main.py) seeds indexes/RBAC/org/learning on every start — no separate
# migration step is required for a fresh DB, but it IS required before login.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
