#!/usr/bin/env python3
"""Composite raw phone screenshots into finished, captioned Play Store frames.
Output: 1080x1920 (9:16). Brand-dark background + caption band + framed screenshot.
"""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1080, 1920
BG_TOP, BG_BOT = (0x16, 0x11, 0x2C), (0x0B, 0x0A, 0x14)
INK = (255, 255, 255)
ACCENT = (0x9B, 0x87, 0xFF)      # brand purple, brightened for dark ground
SUB = (0xA7, 0xA3, 0xC2)

SFNS = "/System/Library/Fonts/SFNS.ttf"
ARIAL_B = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"

def font(size, weight="Bold"):
    try:
        f = ImageFont.truetype(SFNS, size)
        try: f.set_variation_by_name(weight)
        except Exception: pass
        return f
    except Exception:
        return ImageFont.truetype(ARIAL_B if weight in ("Bold","Heavy","Semibold") else ARIAL, size)

def gradient_bg():
    img = Image.new("RGB", (W, H), BG_BOT)
    top = Image.new("RGB", (W, H), BG_TOP)
    mask = Image.new("L", (1, H))
    for y in range(H):
        mask.putpixel((0, y), int(255 * max(0, 1 - y / (H * 0.62))))
    img.paste(top, (0, 0), mask.resize((W, H)))
    # soft brand glow near top-center
    glow = Image.new("RGB", (W, H), BG_BOT)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W//2-460, -360, W//2+460, 360], fill=(0x3A, 0x24, 0x74))
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    return Image.blend(img, glow, 0.5)

def measure(draw, segs, f):
    return sum(draw.textlength(t, font=f) for t, _ in segs)

def draw_centered_segments(draw, y, segs, f):
    total = measure(draw, segs, f)
    x = (W - total) / 2
    asc, desc = f.getmetrics()
    for t, col in segs:
        draw.text((x, y), t, font=f, fill=col)
        x += draw.textlength(t, font=f)
    return y + asc + desc

def rounded(im, rad):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0], im.size[1]], rad, fill=255)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out

def compose(src, out, headline_segs, subhead, crop=None, shot_w=612, shot_top=None):
    canvas = gradient_bg().convert("RGBA")
    draw = ImageDraw.Draw(canvas)

    # caption
    hf = font(74, "Heavy")
    sf = font(34, "Regular")
    # vertically place headline block around y=150
    y = 150
    y = draw_centered_segments(draw, y, headline_segs, hf)
    if subhead:
        y += 14
        tw = draw.textlength(subhead, font=sf)
        draw.text(((W - tw) / 2, y), subhead, font=sf, fill=SUB)

    # screenshot
    shot = Image.open(src).convert("RGB")
    if crop:
        shot = shot.crop(crop)
    scale = shot_w / shot.width
    shot = shot.resize((shot_w, int(shot.height * scale)), Image.LANCZOS)
    shot = rounded(shot, 40)
    # vertically center the framed shot in the space below the caption
    if shot_top is None:
        band_top, band_bot = 380, 1890
        shot_top = max(band_top, band_top + ((band_bot - band_top) - shot.height) // 2)
    # shadow
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sx = (W - shot_w) // 2
    shbox = Image.new("RGBA", shot.size, (0, 0, 0, 150))
    shbox = rounded(shbox, 40)
    sh.paste(shbox, (sx, shot_top + 16), shbox)
    sh = sh.filter(ImageFilter.GaussianBlur(34))
    canvas = Image.alpha_composite(canvas, sh)
    # hairline border
    bd = Image.new("RGBA", shot.size, (0, 0, 0, 0))
    ImageDraw.Draw(bd).rounded_rectangle([0, 0, shot.size[0]-1, shot.size[1]-1], 40,
                                         outline=(255, 255, 255, 34), width=2)
    canvas.alpha_composite(shot, (sx, shot_top))
    canvas.alpha_composite(bd, (sx, shot_top))

    canvas.convert("RGB").save(out, "PNG")
    print(f"wrote {out}  ({W}x{H})")

if __name__ == "__main__":
    D = sys.argv[1]
    # 1. Talk hero — crop to top hero (mic + hint), drop 3-step list + code line
    compose(f"{D}/f_talk-n.png", f"{D}/OUT_01_talk.png",
            [("Talk. ", INK), ("It types.", ACCENT)],
            "Speak naturally — VibeFlow writes it out clean.",
            crop=(0, 0, 720, 1040), shot_w=612)
    # 2. Keyboard in Messages — the core "works in any app"
    compose(f"{D}/f_kb1-n.png", f"{D}/OUT_02_keyboard.png",
            [("One keyboard, ", INK), ("every app.", ACCENT)],
            "Tap the mic in Messages, Mail, WhatsApp — anywhere.",
            crop=(0, 150, 720, 1600), shot_w=612)
    # 3. Paywall — free + Pro
    compose(f"{D}/f_paywall-n.png", f"{D}/OUT_03_pro.png",
            [("Free to start.", INK)],
            "50 free AI formats. Go Pro for unlimited.",
            crop=(0, 150, 720, 1560), shot_w=612)
    # 4. Settings — on-device + control (secondary)
    compose(f"{D}/f_settings-n.png", f"{D}/OUT_04_control.png",
            [("Yours to ", INK), ("tune.", ACCENT)],
            "On-device recognition. Your data stays yours.",
            crop=(0, 150, 720, 1520), shot_w=612)
