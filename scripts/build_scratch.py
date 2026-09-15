"""Export scratch-game candidates and tight sprite bounds, without modifying images."""
import base64
import hashlib
import io
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "web/public"


def build():
    catalog = json.loads((PUBLIC / "pokemantle.json").read_text(encoding="utf-8"))
    candidates = json.loads((PUBLIC / "pokinator.json").read_text(encoding="utf-8"))
    raw = {p["id"]: p for p in catalog["pokemon"]}
    rows = []
    for entry in candidates["pokemon"]:
        key = raw[entry["id"]].get("image")
        if not key or key not in catalog["images"]:
            continue
        with Image.open(io.BytesIO(base64.b64decode(catalog["images"][key].split(",", 1)[1]))) as image:
            rgba = image.convert("RGBA")
            box = rgba.getchannel("A").getbbox()
            if not box:
                continue
            x, y, right, bottom = box
            width, height = right - x, bottom - y
            scale = 224 / max(width, height)
            w, h = max(1, round(width * scale)), max(1, round(height * scale))
            fingerprint = hashlib.sha256(str((width, height)).encode() + rgba.crop(box).tobytes()).hexdigest()[:16]
            rows.append({**entry, "image": key, "crop": [x, y, width, height],
                         "frame": [(256 - w) // 2, (256 - h) // 2, w, h], "art": fingerprint})
    data = {"version": "scratch-v1", "catalogVersion": catalog["version"], "pokemon": rows}
    data["dataVersion"] = hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
    return data


if __name__ == "__main__":
    data = build()
    (PUBLIC / "scratch.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Scratch: {len(data['pokemon'])} candidates, {data['dataVersion']}")
