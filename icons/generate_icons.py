"""Genera los PNG de AutoCare con Pillow a partir de icons/icon.svg.

Uso:  python icons/generate_icons.py
Escudo aerodinamico con silueta de vehiculo y degradido
ambar -> naranja (#F59E0B -> #FB923C), a 4x con reduccion LANCZOS.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
SCALE = 32  # 64 unidades de viewBox -> 2048 px de master
N = 64 * SCALE
BG = (10, 13, 18, 255)       # #0A0D12
AMBER = (245, 158, 11, 255)  # #F59E0B
ORANGE = (251, 146, 60, 255)  # #FB923C


def px(v):
    return int(round(v * SCALE))


def box(*values):
    return tuple(px(v) for v in values)


def cubic(p0, p1, p2, p3, steps=28):
    points = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        points.append((
            u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
        ))
    return points


def quad(p0, p1, p2, steps=16):
    points = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        points.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                       u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))
    return points


SHIELD = (
    [(32, 5), (54, 13), (54, 30)]
    + cubic((54, 30), (54, 43), (45, 53), (32, 59))
    + cubic((32, 59), (19, 53), (10, 43), (10, 30))
    + [(10, 13)]
)
CAR = (
    [(18, 39), (21, 30)]
    + quad((21, 30), (22.5, 27), (26, 27))
    + [(38, 27)]
    + quad((38, 27), (41.5, 27), (43, 30))
    + [(46, 39)]
)


def gradient():
    n = 256
    data = bytearray()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * (n - 1))
            data.append(int(t * 255 + 0.5))
    ramp = Image.frombytes("L", (n, n), bytes(data)).resize((N, N), Image.Resampling.BICUBIC)
    return Image.composite(Image.new("RGBA", (N, N), ORANGE), Image.new("RGBA", (N, N), AMBER), ramp)


def apply(mask, opacity=1.0):
    if opacity != 1.0:
        mask = mask.point(lambda v: int(v * opacity))
    layer = gradient()
    layer.putalpha(mask)
    return layer


def polygon(draw, points, **kwargs):
    draw.polygon([(px(x), px(y)) for x, y in points], **kwargs)


def stroke(draw, points, width, fill=255):
    draw.line([(px(x), px(y)) for x, y in points], fill=fill, width=px(width), joint="curve")
    r = int(px(width) / 2)
    for x, y in (points[0], points[-1]):
        draw.ellipse((px(x) - r, px(y) - r, px(x) + r, px(y) + r), fill=fill)


def artwork():
    image = Image.new("RGBA", (N, N), BG)

    halo = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(halo).ellipse(box(4, 4, 60, 60), fill=(*AMBER[:3], 52))
    image = Image.alpha_composite(image, halo.filter(ImageFilter.GaussianBlur(N * 0.06)))

    rim = Image.new("L", (N, N), 0)
    ImageDraw.Draw(rim).rounded_rectangle(box(0.5, 0.5, 63.5, 63.5), radius=px(13.5), outline=255, width=px(1))
    image = Image.alpha_composite(image, apply(rim, 0.4))

    shield_fill = Image.new("L", (N, N), 0)
    polygon(ImageDraw.Draw(shield_fill), SHIELD, fill=255)
    image = Image.alpha_composite(image, apply(shield_fill, 0.12))

    shield_line = Image.new("L", (N, N), 0)
    stroke(ImageDraw.Draw(shield_line), SHIELD + [SHIELD[0]], 4)
    image = Image.alpha_composite(image, apply(shield_line))

    car = Image.new("L", (N, N), 0)
    cd = ImageDraw.Draw(car)
    polygon(cd, CAR, fill=255)
    stroke(cd, [(19, 39), (45, 39)], 2.4)
    image = Image.alpha_composite(image, apply(car))

    # Ruedas: nucleo oscuro y aro degradido.
    for cx in (23, 41):
        d = ImageDraw.Draw(image)
        d.ellipse(box(cx - 3.2, 37.8, cx + 3.2, 44.2), fill=BG)
        ring = Image.new("L", (N, N), 0)
        ImageDraw.Draw(ring).ellipse(box(cx - 3.2, 37.8, cx + 3.2, 44.2), outline=255, width=px(2))
        image = Image.alpha_composite(image, apply(ring))

    key = Image.new("L", (N, N), 0)
    stroke(ImageDraw.Draw(key), [(32, 21), (32, 27), (36, 27)], 2.2)
    return Image.alpha_composite(image, apply(key))


def main():
    master = artwork()
    for size in (180, 192, 512):
        path = HERE / f"icon-{size}.png"
        master.resize((size, size), Image.Resampling.LANCZOS).save(path, "PNG", optimize=True)
        print(f"wrote {path.name} ({size}x{size})")


if __name__ == "__main__":
    main()
