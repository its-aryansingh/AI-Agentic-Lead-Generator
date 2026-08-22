FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for cryptography, DNS
RUN apt-get update && apt-get install -y \
    gcc \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Collect static files (Django admin, etc.)
RUN python manage.py collectstatic --noinput 2>/dev/null || true

EXPOSE 8000

# Use uvicorn for ASGI (supports async views + SSE streaming)
CMD ["uvicorn", "leadgen_backend.asgi:application", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
