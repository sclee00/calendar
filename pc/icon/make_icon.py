# 실행 파일 아이콘(물고기) 만들기: python3 make_icon.py → fish.ico, fish.png
from PIL import Image, ImageDraw, ImageFilter
import math, os
S = 1024  # 크게 그린 뒤 줄여서 매끈하게
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
# 바탕: 둥근 사각형, 위는 밝은 바다색 → 아래는 깊은 바다색
bg = Image.new("RGBA", (S, S))
top, bot = (40, 160, 220), (16, 70, 140)
for y in range(S):
    t = y / (S - 1)
    c = tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,)
    ImageDraw.Draw(bg).line([(0, y), (S, y)], fill=c)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([24, 24, S - 24, S - 24], radius=210, fill=255)
img.paste(bg, (0, 0), mask)
d = ImageDraw.Draw(img)
# 물결
for k, yy in enumerate((800, 870)):
    pts = [(x, yy + 22 * math.sin((x / S) * 4 * math.pi + k)) for x in range(40, S - 40, 8)]
    d.line(pts, fill=(255, 255, 255, 70 if k else 110), width=22, joint="curve")
# 물고기 몸통(오른쪽을 봄)
cx, cy = 470, 450
body = [(cx + 300 * math.cos(a) * (1 if math.cos(a) > 0 else 0.92), cy + 170 * math.sin(a)) for a in [i * math.pi / 90 for i in range(180)]]
# 꼬리
tail = [(cx - 230, cy), (cx - 420, cy - 190), (cx - 380, cy), (cx - 420, cy + 190)]
coral = (255, 138, 76, 255)
d.polygon(tail, fill=(255, 112, 67, 255))
d.polygon(body, fill=coral)
# 등지느러미·배지느러미
d.polygon([(cx - 60, cy - 150), (cx + 40, cy - 270), (cx + 120, cy - 160)], fill=(255, 112, 67, 255))
d.polygon([(cx - 10, cy + 150), (cx + 60, cy + 240), (cx + 110, cy + 145)], fill=(255, 112, 67, 255))
d.polygon(body, fill=coral)
# 배 쪽 밝은 무늬
d.chord([cx - 220, cy - 10, cx + 270, cy + 175], 0, 180, fill=(255, 196, 150, 255))
# 아가미 선
d.arc([cx + 60, cy - 120, cx + 200, cy + 120], 110, 250, fill=(220, 90, 50, 255), width=18)
# 눈
d.ellipse([cx + 175, cy - 70, cx + 245, cy], fill=(255, 255, 255, 255))
d.ellipse([cx + 200, cy - 52, cx + 238, cy - 14], fill=(20, 40, 70, 255))
# 공기방울
for (x, y, r) in ((cx + 340, cy - 150, 34), (cx + 400, cy - 250, 24), (cx + 440, cy - 330, 16)):
    d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 255, 255, 220), width=10)
img = img.filter(ImageFilter.SMOOTH)
here = os.path.dirname(os.path.abspath(__file__))
img.resize((256, 256), Image.LANCZOS).save(os.path.join(here, "fish.png"))
img.resize((256, 256), Image.LANCZOS).save(os.path.join(here, "fish.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("ok")
