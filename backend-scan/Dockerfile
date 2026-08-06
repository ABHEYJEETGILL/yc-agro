FROM python:3.12-slim

# System deps for opencv/torch/PIL runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxext6 libxrender-dev libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the service code and model
COPY main.py .
COPY drone/ ./drone/
COPY ycagro_v3_best_91.pt .

# Cloud Run provides PORT; gunicorn binds to it
CMD exec gunicorn --bind :$PORT --workers 1 --threads 2 --timeout 300 main:app