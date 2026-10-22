"""Blacked-out tile sprites for the line-of-sight overlay (see animat.js): each tile's
shape in pure black, so unseen ground is blacked out, drawn as cheaply as any other tile
(a different background image, no extra element to paint).

  images/ground-slopes-unseen.png  every cell of images/ground-slopes.png, blacked out
  images/water-unseen.png          the water tile from images/tiles.png, blacked out

Blacking out: every pixel's colour becomes black (0, 0, 0); its transparency is kept, so
the shape stays exactly the sprite's.

Run from the project root:  python3 spritecraft/make_unseen_tiles.py
"""
from PIL import Image

WATER_CELL = (192, 288, 32, 32)  # x, y, w, h of the water tile in tiles.png (.tile.water)


def black_out(img):
    img = img.convert("RGBA")
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (0, 0, 0, a)
    return img


black_out(Image.open("images/ground-slopes.png")).save("images/ground-slopes-unseen.png")
x, y, w, h = WATER_CELL
black_out(Image.open("images/tiles.png").crop((x, y, x + w, y + h))).save("images/water-unseen.png")
print("wrote images/ground-slopes-unseen.png, images/water-unseen.png")
