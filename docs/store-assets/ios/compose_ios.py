#!/usr/bin/env python3
"""iOS Play->App Store frame compositor. Canvas 1290x2796 (Apple 6.9"/6.7" required).
Two entry points:
  compose(src, out, headline_segs, subhead, crop)  -> frame a real iPhone screenshot
  beforeafter(out)                                  -> the illustrative before/after
Sources can be ANY iPhone resolution; they're scaled to fit the frame.
"""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1290, 2796
BG_TOP, BG_BOT = (0x16, 0x11, 0x2C), (0x0B, 0x0A, 0x14)
INK = (255, 255, 255)
ACCENT = (0x9B, 0x87, 0xFF)
SUB = (0xA7, 0xA3, 0xC2)
CARD_RAW = (0x1A, 0x17, 0x26)
CARD_OUT = (0x12, 0x0F, 0x18)
FAINT = (0x8B, 0x86, 0xA6)
SFNS = "/System/Library/Fonts/SFNS.ttf"

def font(size, weight="Bold"):
    f = ImageFont.truetype(SFNS, size)
    try: f.set_variation_by_name(weight)
    except Exception: pass
    return f

def gradient_bg():
    img = Image.new("RGB", (W, H), BG_BOT)
    top = Image.new("RGB", (W, H), BG_TOP)
    mask = Image.new("L", (1, H))
    for y in range(H):
        mask.putpixel((0, y), int(255 * max(0, 1 - y / (H * 0.60))))
    img.paste(top, (0, 0), mask.resize((W, H)))
    glow = Image.new("RGB", (W, H), BG_BOT)
    ImageDraw.Draw(glow).ellipse([W//2-560, -440, W//2+560, 440], fill=(0x3A, 0x24, 0x74))
    glow = glow.filter(ImageFilter.GaussianBlur(190))
    return Image.blend(img, glow, 0.5)

def wrap(draw, text, f, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= maxw: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def draw_wrapped(draw, x, y, text, f, fill, maxw, lh):
    for ln in wrap(draw, text, f, maxw):
        draw.text((x, y), ln, font=f, fill=fill); y += lh
    return y

def rounded(im, rad):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0], im.size[1]], rad, fill=255)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out

def caption(draw, segs, subhead):
    hf, sf = font(88, "Heavy"), font(40, "Regular")
    total = sum(draw.textlength(t, font=hf) for t, _ in segs)
    x = (W - total) / 2
    for t, c in segs:
        draw.text((x, 180), t, font=hf, fill=c); x += draw.textlength(t, font=hf)
    if subhead:
        draw.text(((W - draw.textlength(subhead, font=sf)) / 2, 300), subhead, font=sf, fill=SUB)

def compose(src, out, headline_segs, subhead, crop=None, shot_w=740):
    canvas = gradient_bg().convert("RGBA")
    d = ImageDraw.Draw(canvas)
    caption(d, headline_segs, subhead)
    shot = Image.open(src).convert("RGB")
    if crop: shot = shot.crop(crop)
    shot = shot.resize((shot_w, int(shot.height * shot_w / shot.width)), Image.LANCZOS)
    shot = rounded(shot, 48)
    band_top, band_bot = 470, 2740
    shot_top = max(band_top, band_top + ((band_bot - band_top) - shot.height) // 2)
    sx = (W - shot_w) // 2
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    box = rounded(Image.new("RGBA", shot.size, (0, 0, 0, 150)), 48)
    sh.paste(box, (sx, shot_top + 20), box)
    canvas = Image.alpha_composite(canvas, sh.filter(ImageFilter.GaussianBlur(40)))
    bd = Image.new("RGBA", shot.size, (0, 0, 0, 0))
    ImageDraw.Draw(bd).rounded_rectangle([0, 0, shot.size[0]-1, shot.size[1]-1], 48,
                                         outline=(255, 255, 255, 34), width=2)
    canvas.alpha_composite(shot, (sx, shot_top))
    canvas.alpha_composite(bd, (sx, shot_top))
    canvas.convert("RGB").save(out, "PNG")
    print(f"wrote {out} ({W}x{H})")

def beforeafter(out):
    canvas = gradient_bg().convert("RGBA")
    d = ImageDraw.Draw(canvas)
    caption(d, [("AI that ", INK), ("writes it right.", ACCENT)],
            "Punctuation, capitals, lists — the way you'd type it.")
    M = 108; cw = W - 2 * M
    lab = font(28, "Semibold"); body = font(48, "Regular"); bodyb = font(48, "Semibold")
    raw = "send priya the q3 numbers by friday and ask if she got the invoice, also say thanks"
    raw_lines = len(wrap(d, raw, body, cw - 112))
    rh = 72 + 52 + raw_lines * 62 + 48
    body_txt = "Sending the Q3 numbers by Friday. Did you get the invoice?"
    body_lines = len(wrap(d, body_txt, body, cw - 112))
    fh = 40 + 26 + 74 + 66 + 28 + body_lines * 66 + 28 + 66 + 60
    chip_h = 76
    group_h = rh + 30 + chip_h + 30 + fh
    ry0 = max(500, 560 + ((2736 - 560) - group_h) // 2)

    d.rounded_rectangle([M, ry0, M + cw, ry0 + rh], 40, fill=CARD_RAW)
    d.text((M + 56, ry0 + 40), "YOU SPOKE", font=lab, fill=FAINT)
    draw_wrapped(d, M + 56, ry0 + 40 + 62, raw, body, (0xC9, 0xC6, 0xDE), cw - 112, 62)

    chip_y = ry0 + rh + 30; chip_w = 300
    cx = (W - chip_w) // 2
    grad = Image.new("RGB", (chip_w, chip_h))
    for i in range(chip_w):
        r = int(0x8B + (0x5F - 0x8B) * i / chip_w)
        g = int(0x5C + (0xA8 - 0x5C) * i / chip_w)
        b = int(0xF6 + (0xFF - 0xF6) * i / chip_w)
        for j in range(chip_h): grad.putpixel((i, j), (r, g, b))
    gm = Image.new("L", (chip_w, chip_h), 0)
    ImageDraw.Draw(gm).rounded_rectangle([0, 0, chip_w, chip_h], chip_h//2, fill=255)
    canvas.paste(grad, (cx, chip_y), gm)
    cd = ImageDraw.Draw(canvas); cf = font(34, "Bold"); tx = "✨ VibeFlow AI"
    cd.text((cx + (chip_w - cd.textlength(tx, font=cf)) / 2, chip_y + 19), tx, font=cf, fill=INK)

    fy0 = chip_y + chip_h + 30
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle([M, fy0, M + cw, fy0 + fh], 40, fill=CARD_OUT,
                        outline=(0x9B, 0x87, 0xFF, 90), width=2)
    d.text((M + 56, fy0 + 40), "VIBEFLOW WROTE", font=lab, fill=ACCENT)
    ty = fy0 + 40 + 74
    ty = draw_wrapped(d, M + 56, ty, "Hi Priya,", bodyb, INK, cw - 112, 66) + 28
    ty = draw_wrapped(d, M + 56, ty, body_txt, body, INK, cw - 112, 66) + 28
    draw_wrapped(d, M + 56, ty, "Thanks!", body, INK, cw - 112, 66)
    canvas.convert("RGB").save(out, "PNG")
    print(f"wrote {out} ({W}x{H})")

if __name__ == "__main__":
    if sys.argv[1] == "beforeafter":
        beforeafter(sys.argv[2])
