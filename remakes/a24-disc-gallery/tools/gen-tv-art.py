"""生成 Television 目录的盘面标签。

跑它需要 Pillow 与 macOS 自带的 Didot / Futura：

    python3 tools/gen-tv-art.py

产物提交进仓库，站点运行时不需要 Python。


电影盘用的是原站下载的海报图；剧集没有对应素材，所以这里不去模仿海报，
改成排版式标签：平涂底色 + 大字片名 + 外缘环绕演职员。
是有意的设计选择，不是画不出海报的退让。
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "art", "tv")
SIZE = 1536
DIDOT = "/System/Library/Fonts/Supplemental/Didot.ttc"
FUTURA = "/System/Library/Fonts/Supplemental/Futura.ttc"

SERIES = [
    dict(slug="the-quiet-channel", title="The Quiet\nChannel", ground="#b8402f",
         ink="#f2e6d8", accent="#1b1b1f", face="serif",
         credits="CREATED BY MIRA OKONKWO · WITH JESSIE BUCKLEY · BARRY KEOGHAN · 2026"),
    dict(slug="low-tide", title="Low Tide", ground="#1d3b4a", ink="#e8e2d2",
         accent="#d9a441", face="serif",
         credits="CREATED BY TOMAS HALLE · WITH PAUL MESCAL · THUSO MBEDU · 2026"),
    dict(slug="nightjar", title="Nightjar", ground="#0d0d10", ink="#e4e4e6",
         accent="#7f5af0", face="sans",
         credits="CREATED BY ANNIKA REUSS · WITH SOPHIE OKONEDO · DEV PATEL · 2025"),
    dict(slug="the-understudy", title="The\nUnderstudy", ground="#e8dcc6", ink="#1a1a1c",
         accent="#b8402f", face="serif",
         credits="CREATED BY JUNO PARK · WITH CAREY MULLIGAN · COLMAN DOMINGO · 2025"),
    dict(slug="salt-flats", title="Salt Flats", ground="#c9c4bb", ink="#232326",
         accent="#3c6e57", face="sans",
         credits="CREATED BY RAFAEL IBANEZ · WITH LILY GLADSTONE · JEREMY ALLEN WHITE · 2024"),
    dict(slug="paper-moonlight", title="Paper\nMoonlight", ground="#2b2140", ink="#f0e9f5",
         accent="#e7b6c8", face="serif",
         credits="CREATED BY WEN LI · WITH GRETA LEE · ANDREW SCOTT · 2024"),
]


def font(face, px):
    """Didot for serif, Futura for sans; both ship with macOS."""
    return ImageFont.truetype(DIDOT if face == "serif" else FUTURA, px)


def ring_text(img, text, radius, px, color, face="sans", start=-90, spacing=1.0, flip=False):
    """Lay text around a circle, one rotated glyph at a time."""
    f = font(face, px)
    d = ImageDraw.Draw(img)
    cx = cy = SIZE / 2
    widths = [d.textlength(ch, font=f) + px * 0.08 * spacing for ch in text]
    total = sum(widths)
    # angle subtended by the whole string at this radius
    sweep = total / radius
    angle = math.radians(start) + (sweep / 2 if flip else -sweep / 2)
    for ch, w in zip(text, widths):
        step = (-w if flip else w) / radius
        a = angle + step / 2
        glyph = Image.new("RGBA", (px * 3, px * 3), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glyph)
        gd.text((px * 1.5, px * 1.5), ch, font=f, fill=color, anchor="mm")
        spin = -math.degrees(a) + (90 if flip else -90)
        glyph = glyph.rotate(spin, resample=Image.BICUBIC)
        x = cx + radius * math.cos(a) - glyph.width / 2
        y = cy + radius * math.sin(a) - glyph.height / 2
        img.alpha_composite(glyph, (int(x), int(y)))
        angle += step


def build(s):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = cy = SIZE / 2

    # 圆形色底：盘面外缘之内全部铺满，合成时再裁中心孔
    d.ellipse([0, 0, SIZE, SIZE], fill=s["ground"])

    # 一道细的同心线，给平涂底色一点印刷层次
    d.ellipse([SIZE * 0.085] * 2 + [SIZE * 0.915] * 2, outline=s["accent"], width=3)

    # 顶部 A24 标记。两行标题会顶到这个位置，那时外缘的
    # "TELEVISION · A24" 已经把品牌交代清楚，这里就省掉。
    if "\n" not in s["title"]:
        f_mark = font("sans", int(SIZE * 0.042))
        d.text((cx, SIZE * 0.175), "A24", font=f_mark, fill=s["accent"], anchor="mm")

    # 主标题：按行排，整体避开中心孔（孔在 y 中线，所以标题偏上）
    lines = s["title"].split("\n")
    px = int(SIZE * (0.115 if len(lines) > 1 else 0.155))
    f_title = font(s["face"], px)
    lh = px * 1.04
    # 中心孔占到半径 24% 左右，多行标题整块抬到孔上方，否则第二行会被挖穿
    baseline = cy - SIZE * (0.205 if len(lines) > 1 else 0.145)
    top = baseline - (len(lines) - 1) * lh
    for i, line in enumerate(lines):
        d.text((cx, top + i * lh), line, font=f_title, fill=s["ink"], anchor="mm")

    # 底部署名条：和真实盘面一样把演职员绕在外缘
    ring_text(img, s["credits"], SIZE * 0.405, int(SIZE * 0.0225),
              s["ink"], face="sans", start=90, flip=True)

    # 片名重复一次贴在外缘上方，呼应原站盘面的环绕排版
    ring_text(img, "TELEVISION · A24", SIZE * 0.405, int(SIZE * 0.0225),
              s["accent"], face="sans", start=-90)

    return img


os.makedirs(OUT, exist_ok=True)
for s in SERIES:
    build(s).save(os.path.join(OUT, f"{s['slug']}.webp"), quality=92, method=6)
    print("wrote", s["slug"])
