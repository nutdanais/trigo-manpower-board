#!/usr/bin/env python3
"""Builds the favicon / app-icon options from the TRIGO logo's four stripes.

The stripe geometry below is copied verbatim from the vector artwork in
NEW_TRIGO_logo_CMYK.ai (the four green Bezier paths), so the curves are exact
at any size. The old favicon.svg was a hand-traced polygon, which is why it
looked jagged on high-density phone screens.

Text is converted to outlines (no font dependency), so the SVGs look the same
everywhere, including as a favicon where web fonts are not loaded.

    python3 build_options.py <out_dir>

Needs: fonttools (pip install fonttools), Inter fonts in /usr/share/fonts/opentype/inter.
"""
import sys, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

NAVY = "#004983"       # --primary in styles.css, same as the old favicon
NAVY_DEEP = "#00365F"
LIME = "#A6CA57"       # logo stripe green (rgb 65.1%, 79.2%, 34.1%)
WHITE = "#FFFFFF"
FONT_BOLD = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"

# --- the four stripes, as in the .ai file -----------------------------------
# Original coordinates: x 795.78 .. 875.73, y 94.81 .. 258.05 (80 x 163.24).
SX0, SY0, SW, SH = 795.78125, 94.808594, 875.734375 - 795.78125, 258.046875 - 94.808594
STRIPE_PATHS = [
    "M 875.734375 122.777344 C 875.734375 122.777344 840.402344 146.453125 795.78125 146.453125 L 795.78125 118.484375 C 840.402344 118.484375 875.734375 94.808594 875.734375 94.808594 Z",
    "M 875.734375 159.972656 C 875.734375 159.972656 840.402344 183.648438 795.78125 183.648438 L 795.78125 155.679688 C 840.402344 155.679688 875.734375 132 875.734375 132 Z",
    "M 875.734375 197.171875 C 875.734375 197.171875 840.402344 220.851562 795.78125 220.851562 L 795.78125 192.878906 C 840.402344 192.878906 875.734375 169.203125 875.734375 169.203125 Z",
    "M 875.734375 234.371094 C 875.734375 234.371094 840.402344 258.046875 795.78125 258.046875 L 795.78125 230.078125 C 840.402344 230.078125 875.734375 206.398438 875.734375 206.398438 Z",
]


def stripes(cx, top, height, fill=LIME):
    """The stripe block, `height` tall, horizontally centred on cx, top edge at `top`."""
    s = height / SH
    w = SW * s
    tx = cx - w / 2 - SX0 * s
    ty = top - SY0 * s
    d = " ".join(STRIPE_PATHS)
    return f'<path fill="{fill}" transform="translate({tx:.3f} {ty:.3f}) scale({s:.5f})" d="{d}"/>', w


_font = TTFont(FONT_BOLD)
_gs = _font.getGlyphSet()
_cmap = _font.getBestCmap()
_upm = _font["head"].unitsPerEm
_cap = _font["OS/2"].sCapHeight


def text_outline(text, cx, baseline, cap_h, fill, tracking=0.10, xscale=1.14):
    """Outlined caps, centred on cx. cap_h = cap height in px. xscale widens the
    letters to echo the extended TRIGO wordmark; tracking is in em."""
    k = cap_h / _cap
    pen_x, items = 0.0, []
    for i, ch in enumerate(text):
        g = _cmap[ord(ch)]
        adv = _gs[g].width
        items.append((g, pen_x))
        pen_x += adv * k * xscale + (tracking * _upm * k * xscale if i < len(text) - 1 else 0)
    total = pen_x
    x0 = cx - total / 2
    parts = []
    for g, px in items:
        pen = SVGPathPen(_gs)
        tp = TransformPen(pen, (k * xscale, 0, 0, -k, x0 + px, baseline))
        _gs[g].draw(tp)
        parts.append(pen.getCommands())
    return f'<path fill="{fill}" d="{" ".join(p for p in parts if p)}"/>', total


def text_width(text, cap_h, tracking=0.10, xscale=1.14):
    return text_outline(text, 0, 0, cap_h, "#000", tracking, xscale)[1]


def fit_cap(text, width, tracking=0.10, xscale=1.14):
    """Cap height at which `text` is `width` px wide."""
    return width / text_width(text, 1.0, tracking, xscale)


def svg(inner, bg):
    bgr = f'<rect width="1024" height="1024" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">'
            f'{bgr}{inner}</svg>\n')


# --- options ----------------------------------------------------------------
def opt_a():
    """A - Stacked: stripes, MANPOWER / BOARD in white on navy."""
    sh = 380
    cap = fit_cap("MANPOWER", 640)
    gap1, gap2 = 70, 0.62 * cap
    total = sh + gap1 + cap + gap2 + cap
    top = (1024 - total) / 2
    s, _ = stripes(512, top, sh)
    y1 = top + sh + gap1 + cap
    y2 = y1 + gap2 + cap
    t1, _ = text_outline("MANPOWER", 512, y1, cap, WHITE)
    t2, _ = text_outline("BOARD", 512, y2, cap, WHITE)
    return svg(s + t1 + t2, NAVY)


def opt_b():
    """B - Big stripes, single caption line."""
    sh = 500
    cap = fit_cap("MANPOWER BOARD", 780)
    gap = 70
    total = sh + gap + cap
    top = (1024 - total) / 2
    s, _ = stripes(512, top, sh)
    t, _ = text_outline("MANPOWER BOARD", 512, top + sh + gap + cap, cap, WHITE)
    return svg(s + t, NAVY)


def opt_c():
    """C - Two-tone: MANPOWER white, BOARD in the stripe green."""
    sh = 370
    cap = fit_cap("MANPOWER", 660)
    gap1, gap2 = 66, 0.62 * cap
    total = sh + gap1 + cap + gap2 + cap
    top = (1024 - total) / 2
    s, _ = stripes(512, top, sh)
    y1 = top + sh + gap1 + cap
    y2 = y1 + gap2 + cap
    t1, _ = text_outline("MANPOWER", 512, y1, cap, WHITE)
    t2, _ = text_outline("BOARD", 512, y2, cap, LIME)
    return svg(s + t1 + t2, NAVY)


def opt_d():
    """D - Light: white tile, navy text, green stripes (as the logo prints on paper)."""
    sh = 380
    cap = fit_cap("MANPOWER", 640)
    gap1, gap2 = 70, 0.62 * cap
    total = sh + gap1 + cap + gap2 + cap
    top = (1024 - total) / 2
    s, _ = stripes(512, top, sh)
    y1 = top + sh + gap1 + cap
    y2 = y1 + gap2 + cap
    t1, _ = text_outline("MANPOWER", 512, y1, cap, NAVY)
    t2, _ = text_outline("BOARD", 512, y2, cap, NAVY)
    return svg(s + t1 + t2, WHITE)


def opt_e():
    """E - Caption band: large stripes on navy, text in a deeper navy band at the foot."""
    band_h = 250
    sh = 520
    top = (1024 - band_h - sh) / 2 + 20
    s, _ = stripes(512, top, sh)
    cap = fit_cap("MANPOWER BOARD", 700)
    band = f'<rect y="{1024 - band_h}" width="1024" height="{band_h}" fill="{NAVY_DEEP}"/>'
    rule = f'<rect y="{1024 - band_h}" width="1024" height="10" fill="{LIME}"/>'
    t, _ = text_outline("MANPOWER BOARD", 512, 1024 - band_h / 2 + cap / 2 + 4, cap, WHITE)
    return svg(band + rule + s + t, NAVY)


def opt_mark():
    """Stripes only - for sizes where text cannot be read (browser tab, 16-32 px)."""
    sh = 640
    s, _ = stripes(512, (1024 - sh) / 2, sh)
    return svg(s, NAVY)


OPTIONS = {
    "A-stacked": opt_a, "B-big-stripes-one-line": opt_b, "C-two-tone": opt_c,
    "D-light": opt_d, "E-caption-band": opt_e, "mark-stripes-only": opt_mark,
}

if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for name, fn in OPTIONS.items():
        with open(os.path.join(out, f"icon-{name}.svg"), "w") as f:
            f.write(fn())
        print("wrote", name)
