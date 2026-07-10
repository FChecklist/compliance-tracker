# Doc Processing Service

This service provides a skeleton for the document‑processing micro‑service. It currently runs a minimal FastAPI application exposing a single health‑check endpoint. Future tasks will add OCR, parsing, transcription, and conversion capabilities.

## What it is
- **Base image**: `python:3.11-slim`
- **System dependencies**: LibreOffice (for document conversion)
- **Python dependencies**: FastAPI, Uvicorn, PaddleOCR, PaddlePaddle, Docling, whisper‑cpp‑python
- **Endpoint**: `GET /health` → `{"status": "ok"}`

## Building the Docker image
```bash
# From the repository root
cd services/doc-processing
docker build -t doc-processing:latest .
```

## Running locally
```bash
# Run the container and expose port 8080
docker run -p 8080:8080 doc-processing:latest
```

The service will be reachable at `http://localhost:8080`. Verify the health check:
```bash
curl http://localhost:8080/health
# Expected output: {"status": "ok"}
```

## Environment variables
- `DOC_PROCESSING_SERVICE_URL` – The URL the main Next.js application will use to reach this service once it is deployed. The deployment itself is handled separately by the operations team; this repository only provides the container image.

## Next steps
Future integration tasks will add:
- OCR processing using PaddleOCR
- Document parsing with Docling
- Audio transcription via Whisper.cpp
- Conversion utilities leveraging LibreOffice

For now, the service is a simple health‑check placeholder ready to be extended.
