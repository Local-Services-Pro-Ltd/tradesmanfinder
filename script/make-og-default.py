#!/usr/bin/env python3
"""
Generate the default OG image for TradesmanFinder social shares.
Run once at build setup time; the resulting PNG is committed and served
by Vercel as a static asset at /og-default.png.

Why a script rather than a service: keeps the build deterministic, no
runtime image generation, no third-party dependency at request time.
A per-page dynamic OG (with N pros / area name) would be PR-#19-G+.
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
NAVY = (15, 42, 68)
NAVY_2 = (22, 59, 96)
ORANGE = (232, 147, 43)
ORANGE_LIGHT = (242, 163, 56)
WHITE = (255, 255, 255)
MUTED = (207, 216, 227)

FONT_BLACK = "/usr/share/fonts/truetype/lato/Lato-Black.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/lato/Lato-Bold.ttf"
FONT_SEMI = "/usr/share/fonts/truetype/lato/Lato-Semibold.ttf"
FONT_MEDIUM = "/usr/share/fonts/truetype/lato/Lato-Medium.ttf"


def vertical_gradient(size, top, bottom):
    """Return an RGB image filled with a top-to-bottom linear gradient."""
    img = Image.new("RGB", size)
    px = img.load()
    w, h = size
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(top[0] * (1 - t) + bottom[0] * t)
        g = int(top[1] * (1 - t) + bottom[1] * t)
        b = int(top[2] * (1 - t) + bottom[2] * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def main():
    img = vertical_gradient((W, H), NAVY, NAVY_2)
    draw = ImageDraw.Draw(img, "RGBA")

    # Faint horizontal grid lines (subtle texture)
    for y in (120, 260, 400, 540):
        draw.line([(0, y), (W, y)], fill=(255, 255, 255, 15), width=1)

    # --- Logo mark (top-left, 120x120) ---
    logo_x, logo_y, logo_s = 96, 130, 120
    # Rounded orange square
    draw.rounded_rectangle(
        [logo_x, logo_y, logo_x + logo_s, logo_y + logo_s],
        radius=26, fill=ORANGE,
    )
    cx = logo_x + logo_s / 2
    cy = logo_y + logo_s / 2
    # House roof (chevron)
    roof = [
        (cx,        logo_y + 22),
        (logo_x + logo_s - 18, logo_y + 50),
        (logo_x + logo_s - 18, logo_y + 58),
        (cx,        logo_y + 30),
        (logo_x + 18, logo_y + 58),
        (logo_x + 18, logo_y + 50),
    ]
    draw.polygon(roof, fill=WHITE)
    # Vertical stem
    draw.line([(cx, logo_y + 42), (cx, logo_y + 86)], fill=WHITE, width=8)
    # Diamond (compass tip)
    diamond = [
        (cx,      logo_y + 76),
        (cx + 14, logo_y + 94),
        (cx,      logo_y + 112),
        (cx - 14, logo_y + 94),
    ]
    draw.polygon(diamond, fill=NAVY, outline=WHITE)

    # --- Wordmark beside logo ---
    f_brand = ImageFont.truetype(FONT_BLACK, 64)
    draw.text((244, logo_y + 24), "TradesmanFinder", font=f_brand, fill=WHITE)

    # --- Tagline ---
    f_tagline = ImageFont.truetype(FONT_BOLD, 56)
    draw.text((96, 320), "Find a trusted local tradesman.",
              font=f_tagline, fill=WHITE)

    f_sub = ImageFont.truetype(FONT_MEDIUM, 34)
    draw.text((96, 392), "Verified pros. Real reviews. Free quotes.",
              font=f_sub, fill=MUTED)

    # --- Feature chips ---
    chip_y = 480
    chip_h = 56
    chips = ["Verified pros", "Real reviews", "Free quotes"]
    f_chip = ImageFont.truetype(FONT_SEMI, 24)
    x = 96
    pad_x = 28
    for text in chips:
        bbox = draw.textbbox((0, 0), text, font=f_chip)
        tw = bbox[2] - bbox[0]
        w = tw + pad_x * 2
        draw.rounded_rectangle(
            [x, chip_y, x + w, chip_y + chip_h],
            radius=chip_h // 2,
            fill=(255, 255, 255, 22),
            outline=(255, 255, 255, 50),
            width=1,
        )
        ty = chip_y + (chip_h - (bbox[3] - bbox[1])) // 2 - 4
        draw.text((x + pad_x, ty), text, font=f_chip, fill=WHITE)
        x += w + 18

    # --- Domain (bottom-right) ---
    f_domain = ImageFont.truetype(FONT_SEMI, 22)
    domain = "tradesmanfinder.com"
    bbox = draw.textbbox((0, 0), domain, font=f_domain)
    dw = bbox[2] - bbox[0]
    draw.text((W - 96 - dw, H - 60), domain, font=f_domain, fill=ORANGE_LIGHT)

    out = "client/public/og-default.png"
    img.save(out, "PNG", optimize=True)
    print(f"wrote {out} ({W}x{H})")


if __name__ == "__main__":
    main()
