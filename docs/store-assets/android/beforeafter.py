#!/usr/bin/env python3
"""Before -> after frame: raw dictation transformed into clean formatted text.
Illustrative marketing frame (no device capture needed). 1080x1920, brand style.
"""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1080, 1920
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
        mask.putpixel((0, y), int(255 * max(0, 1 - y / (H * 0.62))))
    img.paste(top, (0, 0), mask.resize((W, H)))
    glow = Image.new("RGB", (W, H), BG_BOT)
    ImageDraw.Draw(glow).ellipse([W//2-460, -360, W//2+460, 360], fill=(0x3A, 0x24, 0x74))
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    return Image.blend(img, glow, 0.5)

def wrap(draw, text, f, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= maxw:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def draw_wrapped(draw, x, y, text, f, fill, maxw, lh):
    for ln in wrap(draw, text, f, maxw):
        draw.text((x, y), ln, font=f, fill=fill); y += lh
    return y

def main(out):
    canvas = gradient_bg().convert("RGBA")
    d = ImageDraw.Draw(canvas)

    # caption
    hf = font(74, "Heavy"); sf = font(34, "Regular")
    segs = [("AI that ", INK), ("writes it right.", ACCENT)]
    total = sum(d.textlength(t, font=hf) for t, _ in segs)
    x = (W - total) / 2
    for t, c in segs:
        d.text((x, 150), t, font=hf, fill=c); x += d.textlength(t, font=hf)
    sub = "Punctuation, capitals, lists — the way you'd type it."
    d.text(((W - d.textlength(sub, font=sf)) / 2, 250), sub, font=sf, fill=SUB)

    M = 90                      # card side margin
    cw = W - 2 * M
    lab = font(24, "Semibold")
    body = font(40, "Regular")
    bodyb = font(40, "Semibold")

    # --- pre-measure both cards so the whole group can be vertically centered ---
    raw = "send priya the q3 numbers by friday and ask if she got the invoice, also say thanks"
    raw_lines = len(wrap(d, raw, body, cw - 96))
    rh = 60 + 44 + raw_lines * 52 + 40
    body_pre = len(wrap(d, "Sending the Q3 numbers by Friday. Did you get the invoice?", body, cw - 96))
    fh_pre = 34 + 22 + 62 + 56 + 24 + body_pre * 56 + 24 + 56 + 50
    chip_h_pre = 64
    group_h = rh + 26 + chip_h_pre + 26 + fh_pre
    ry0 = max(400, 380 + ((1880 - 380) - group_h) // 2)

    # --- RAW card (what you said) ---
    lines = wrap(d, raw, body, cw - 96)
    d.rounded_rectangle([M, ry0, M + cw, ry0 + rh], 34, fill=CARD_RAW)
    d.text((M + 48, ry0 + 34), "YOU SPOKE", font=lab, fill=FAINT)
    yy = ry0 + 34 + 52
    draw_wrapped(d, M + 48, yy, raw, body, (0xC9, 0xC6, 0xDE), cw - 96, 52)

    # --- connector chip ---
    chip_y = ry0 + rh + 26
    chip_w, chip_h = 250, 64
    cx = (W - chip_w) // 2
    grad = Image.new("RGB", (chip_w, chip_h), (0x8B, 0x5C, 0xF6))
    for i in range(chip_w):
        r = int(0x8B + (0x5F - 0x8B) * i / chip_w)
        g = int(0x5C + 0xA8 * 0 + (0xA8 - 0x5C) * i / chip_w)
        b = int(0xF6 + (0xFF - 0xF6) * i / chip_w)
        for j in range(chip_h): grad.putpixel((i, j), (r, g, b))
    gmask = Image.new("L", (chip_w, chip_h), 0)
    ImageDraw.Draw(gmask).rounded_rectangle([0, 0, chip_w, chip_h], chip_h//2, fill=255)
    canvas.paste(grad, (cx, chip_y), gmask)
    cd = ImageDraw.Draw(canvas)
    cf = font(28, "Bold")
    tx = "✨ VibeFlow AI"
    cd.text((cx + (chip_w - cd.textlength(tx, font=cf)) / 2, chip_y + 16), tx, font=cf, fill=INK)

    # --- FORMATTED card (what VibeFlow wrote) — sized to content ---
    fy0 = chip_y + chip_h + 26
    d = ImageDraw.Draw(canvas)
    body_txt = "Sending the Q3 numbers by Friday. Did you get the invoice?"
    body_lines = len(wrap(d, body_txt, body, cw - 96))
    # header(62) + greeting(56)+gap(24) + body(n*56)+gap(24) + signoff(56) + pads(34+50)
    fh = 34 + 22 + 62 + 56 + 24 + body_lines * 56 + 24 + 56 + 50
    d.rounded_rectangle([M, fy0, M + cw, fy0 + fh], 34, fill=CARD_OUT,
                        outline=(0x9B, 0x87, 0xFF, 90), width=2)
    d.text((M + 48, fy0 + 34), "VIBEFLOW WROTE", font=lab, fill=ACCENT)
    ty = fy0 + 34 + 62
    ty = draw_wrapped(d, M + 48, ty, "Hi Priya,", bodyb, INK, cw - 96, 56); ty += 24
    ty = draw_wrapped(d, M + 48, ty, body_txt, body, INK, cw - 96, 56); ty += 24
    ty = draw_wrapped(d, M + 48, ty, "Thanks!", body, INK, cw - 96, 56)

    canvas.convert("RGB").save(out, "PNG")
    print(f"wrote {out} ({W}x{H})")

if __name__ == "__main__":
    main(sys.argv[1])
