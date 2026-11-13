import numpy as np
from PIL import Image, ImageDraw
BGC = (119, 104, 100, 255)
def over_bg(cell, bg=BGC):
    im = Image.new('RGBA', (cell.shape[1], cell.shape[0]), bg); im.alpha_composite(Image.fromarray(cell)); return im
def strip(cells_rows, z=6, crop=None, labels=None, grid=0):
    """cells_rows: list of rows, each a list of HxWx4 arrays."""
    H, W = cells_rows[0][0].shape[:2]
    x0, y0, x1, y1 = crop or (0, 0, W, H)
    w, h = x1 - x0, y1 - y0
    out = Image.new('RGBA', (len(cells_rows[0]) * w * z, len(cells_rows) * h * z), BGC)
    d = ImageDraw.Draw(out)
    for r, row in enumerate(cells_rows):
        for c, cell in enumerate(row):
            im = over_bg(cell[y0:y1, x0:x1]).resize((w * z, h * z), Image.NEAREST)
            out.paste(im, (c * w * z, r * h * z))
            if grid:
                for g in range(0, w, grid): d.line([(c*w*z + g*z, r*h*z), (c*w*z + g*z, (r+1)*h*z)], fill=(140,128,125,255))
                for g in range(0, h, grid): d.line([(c*w*z, r*h*z + g*z), ((c+1)*w*z, r*h*z + g*z)], fill=(140,128,125,255))
            d.rectangle([c*w*z, r*h*z, (c+1)*w*z-1, (r+1)*h*z-1], outline=(90,80,78,255))
            if labels: d.text((c*w*z+3, r*h*z+2), labels[r][c], fill=(255,255,0,255))
    return out
