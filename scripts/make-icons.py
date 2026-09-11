#!/usr/bin/env python3
"""Raad DM — generate app & extension icons (rounded bolt on gradient)."""
from PIL import Image, ImageDraw, ImageFilter
import os

ROOT = '/home/z/my-project/raad-dm'
OUT_APP = os.path.join(ROOT, 'assets', 'icons')
OUT_EXT = os.path.join(ROOT, 'extension', 'icons')
os.makedirs(OUT_APP, exist_ok=True)
os.makedirs(OUT_EXT, exist_ok=True)

S = 8  # supersample factor


def rounded_gradient(size, r_ratio=0.23):
    big = size * S
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    # vertical-diagonal gradient indigo -> violet
    grad = Image.new('RGBA', (big, big))
    c1, c2 = (79, 70, 229), (124, 58, 237)
    px = grad.load()
    for y in range(big):
        for x in range(0, big, 1):
            t = (x * 0.35 + y * 0.65) / big
            px[x, y] = (
                int(c1[0] + (c2[0] - c1[0]) * t),
                int(c1[1] + (c2[1] - c1[1]) * t),
                int(c1[2] + (c2[2] - c1[2]) * t),
                255)
    mask = Image.new('L', (big, big), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * r_ratio), fill=255)
    img.paste(grad, (0, 0), mask)
    return img


BOLT = [(300, 32), (128, 288), (232, 288), (196, 480), (384, 208), (268, 208), (320, 32)]


def draw_bolt(img, size, glow=True):
    big = size * S
    pts = [(x * big / 512, y * big / 512) for x, y in BOLT]
    if glow:
        gl = Image.new('RGBA', (big, big), (0, 0, 0, 0))
        dg = ImageDraw.Draw(gl)
        dg.polygon(pts, fill=(255, 255, 255, 200))
        gl = gl.filter(ImageFilter.GaussianBlur(big * 0.035))
        img.alpha_composite(gl)
    d = ImageDraw.Draw(img)
    d.polygon(pts, fill=(255, 255, 255, 255))


def make_icon(size, tray=False):
    img = rounded_gradient(size)
    draw_bolt(img, size)
    if not tray:
        # subtle top highlight
        big = size * S
        hi = Image.new('RGBA', (big, big), (0, 0, 0, 0))
        dh = ImageDraw.Draw(hi)
        dh.rounded_rectangle([int(big*0.06), int(big*0.05), int(big*0.94), int(big*0.42)],
                             radius=int(big*0.18), fill=(255, 255, 255, 26))
        img.alpha_composite(hi)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    # master icon
    for s in [16, 24, 32, 48, 64, 128, 256, 512]:
        make_icon(s).save(os.path.join(OUT_APP, f'icon{s}.png'))
    make_icon(512).save(os.path.join(OUT_APP, 'icon.png'))
    # multi-size ICO
    make_icon(256).save(os.path.join(OUT_APP, 'icon.ico'),
                        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    # tray (32)
    make_icon(32).save(os.path.join(OUT_APP, 'tray.png'))
    # extension icons
    for s in [16, 32, 48, 128]:
        make_icon(s).save(os.path.join(OUT_EXT, f'icon{s}.png'))
    print('icons done:', OUT_APP, OUT_EXT)
