# Pinned to 3.10, not 3.11: paddleocr==2.7.0.2 hard-requires PyMuPDF<1.21.0,
# and no PyMuPDF release in that range ships a cp311 wheel (Python 3.11
# support was added around PyMuPDF 1.21.x) -- would force a from-source build
# that fails on modern GCC (confirmed live, 2026-07-10: "passing argument 1 of
# 'delete_Font' from incompatible pointer type"). PyMuPDF 1.20.2 has a real
# cp310 manylinux wheel, and every other pin here (docling>=3.10, paddlepaddle,
# whisper-cpp-python>=3.9) supports 3.10, so downgrading the base image avoids
# the conflict entirely instead of bumping paddleocr to a heavier 3.x/paddlex
# dependency chain that nothing in the app has been written against yet.
FROM python:3.10-slim

# Install system dependencies
# build-essential + cmake: whisper-cpp-python (requirements.txt) wraps the
# whisper.cpp C++ library and has no manylinux wheel for every platform this
# might build on -- pip falls back to compiling from source, which needs a
# C/C++ toolchain this base image doesn't include by default. Audit fix
# (2026-07-10): the original Dockerfile only installed libreoffice, which
# would make `pip install -r requirements.txt` fail as soon as it reached
# whisper-cpp-python on any platform without a prebuilt wheel.
# swig: confirmed live (first real build attempt, 2026-07-10) that both
# whisper-cpp-python AND PyMuPDF (a transitive dependency of docling, used
# for its PDF parsing) fail to build their C-extension wheels without it --
# "error: command 'swig' failed: No such file or directory".
# ffmpeg: Phase 4 (Whisper.cpp) needs audio input, but meeting recordings
# are typically video (.mp4) -- ffmpeg is the bridge that extracts/converts
# audio before transcription. Added here (Phase 0 skeleton) rather than
# deferred to Phase 4 since it's a cheap system package, not application
# code, and avoids a second Dockerfile edit + rebuild later.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libreoffice build-essential cmake swig ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for caching
COPY requirements.txt .

# CMAKE_ARGS: 5th real build failure. whisper-cpp-python vendors whisper.cpp's
# own CMakeLists.txt, which declares an old cmake_minimum_required() version;
# pip's build-isolation `cmake` package installs a modern CMake (4.x) that
# hard-removed support for configs below 3.5 ("Compatibility with CMake < 3.5
# has been removed from CMake"). This is CMake's own suggested workaround from
# the error output, applied globally via env var since whisper-cpp-python's
# build doesn't expose a way to pass it through pip install flags directly.
ENV CMAKE_ARGS="-DCMAKE_POLICY_VERSION_MINIMUM=3.5"

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download PaddleOCR model weights at BUILD time, not container-start
# time. main.py instantiates PaddleOCR(...) at module scope, which downloads
# 3 separate model files (det/rec/cls) from a Baidu CDN on first run --
# confirmed live (2026-07-10, doc-processing-job.yml E2E test, 3rd attempt)
# that this can exceed the job's health-check budget under normal network
# variance (worked fine once, then took longer than 60s the next run).
# Placed before COPY so app-code changes don't invalidate this layer and
# force a redundant re-download on every rebuild.
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(lang='en', use_gpu=False)"

# Copy application code
COPY . .

# Expose the FastAPI port
EXPOSE 8080

# Run the FastAPI app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
