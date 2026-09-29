# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
# Joins C:/tmp/audit/*-maq.png and *-app.png side by side into *-pair.png.
import glob, os
from PIL import Image
for maq in sorted(glob.glob("C:/tmp/audit/*-maq.png")):
    app = maq.replace("-maq.png", "-app.png")
    if not os.path.exists(app): continue
    a, b = Image.open(maq), Image.open(app)
    w = a.width + b.width + 8; h = max(a.height, b.height)
    out = Image.new("RGB", (w, h), (255, 0, 255)); out.paste(a, (0, 0)); out.paste(b, (a.width + 8, 0))
    out.save(maq.replace("-maq.png", "-pair.png"))
print("ok")
