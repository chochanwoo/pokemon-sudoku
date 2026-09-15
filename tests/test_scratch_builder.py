import base64
import io
import json
import unittest
from PIL import Image
from scripts.build_scratch import build, PUBLIC


class ScratchBuilderTests(unittest.TestCase):
    def test_reproducible_and_crops_keep_every_visible_pixel(self):
        data = build()
        self.assertEqual(data, build())
        self.assertEqual(data, json.loads((PUBLIC / "scratch.json").read_text(encoding="utf-8")))
        catalog = json.loads((PUBLIC / "pokemantle.json").read_text(encoding="utf-8"))
        self.assertEqual(len(data["pokemon"]), 1179)
        for p in data["pokemon"]:
            with Image.open(io.BytesIO(base64.b64decode(catalog["images"][p["image"]].split(",", 1)[1]))) as image:
                x, y, w, h = p["crop"]
                self.assertEqual(image.convert("RGBA").getchannel("A").getbbox(), (x, y, x+w, y+h))
                fx, fy, fw, fh = p["frame"]
                self.assertTrue(0 <= fx < fx+fw <= 256 and 0 <= fy < fy+fh <= 256)
                self.assertEqual(max(fw, fh), 224)
                self.assertLess(abs(fw / fh - w / h), 0.1)


if __name__ == "__main__":
    unittest.main()
