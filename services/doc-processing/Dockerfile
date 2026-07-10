FROM python:3.11-slim

# Install system dependencies
# build-essential + cmake: whisper-cpp-python (requirements.txt) wraps the
# whisper.cpp C++ library and has no manylinux wheel for every platform this
# might build on -- pip falls back to compiling from source, which needs a
# C/C++ toolchain this base image doesn't include by default. Audit fix
# (2026-07-10): the original Dockerfile only installed libreoffice, which
# would make `pip install -r requirements.txt` fail as soon as it reached
# whisper-cpp-python on any platform without a prebuilt wheel.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libreoffice build-essential cmake && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose the FastAPI port
EXPOSE 8080

# Run the FastAPI app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
