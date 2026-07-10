from fastapi import FastAPI, HTTPException
import base64
import io
import numpy as np
from PIL import Image
from paddleocr import PaddleOCR

app = FastAPI()

# Initialize PaddleOCR once to avoid reloading model on each request
_ocr_engine = PaddleOCR(lang='en', use_gpu=False)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.post("/ocr")
async def ocr_endpoint(payload: dict):
    """Accept a JSON payload with a base64‑encoded image and return OCR results.

    Expected payload::
        {"image_base64": "..."}
    """
    image_base64 = payload.get("image_base64")
    if not image_base64:
        raise HTTPException(status_code=400, detail="Missing image_base64 field")

    try:
        image_bytes = base64.b64decode(image_base64)
        pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img_np = np.array(pil_img)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid image data") from e

    # Run OCR. PaddleOCR's .ocr() returns a list of PAGES, each page being a
    # list of line-results [bbox, (text, confidence)] -- not a flat list of
    # lines directly. Confirmed live (2026-07-10 E2E test): treating the
    # top-level list as lines caused "bbox, (text, conf) = line[0], line[1]"
    # to IndexError on any single-page image with exactly 1 detection
    # (result[0] IS the single line, so line[1] doesn't exist). result[0] can
    # also be None for a page with zero detections.
    result = _ocr_engine.ocr(img_np, cls=False)
    page = result[0] if result and result[0] else []

    regions = []
    full_text_parts = []
    confidences = []
    for line in page:
        # Each line is [bbox, (text, confidence)]
        bbox, (text, conf) = line[0], line[1]
        xs = [point[0] for point in bbox]
        ys = [point[1] for point in bbox]
        minx, miny, maxx, maxy = min(xs), min(ys), max(xs), max(ys)
        regions.append({
            "text": text,
            "confidence": conf,
            "bbox": [minx, miny, maxx, maxy]
        })
        full_text_parts.append(text)
        confidences.append(conf)

    overall_confidence = sum(confidences) / len(confidences) if confidences else 0.0
    full_text = " ".join(full_text_parts).strip()

    return {
        "text": full_text,
        "regions": regions,
        "overallConfidence": overall_confidence
    }
