import base64
import io
import sys
from pathlib import Path

from fastapi.testclient import TestClient

# Ensure the parent directory (containing main.py) is on the import path
sys.path.append(str(Path(__file__).resolve().parents[1]))
from main import app

client = TestClient(app)

def create_sample_image(text: str = "Test") -> str:
    # Create a simple image with white background and black text
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (200, 60), color="white")
    d = ImageDraw.Draw(img)
    d.text((10, 10), text, fill="black")
    buffered = io.BytesIO()
    img.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode()

def test_ocr_endpoint_returns_text():
    image_base64 = create_sample_image()
    response = client.post("/ocr", json={"image_base64": image_base64})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "text" in data
    assert data["text"].strip() != ""
