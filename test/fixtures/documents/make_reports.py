#!/usr/bin/env python3
"""
An invented cost consultant's monthly cost report whose tables are pictures.

Every name and figure here is made up. The file exists so the reader is
tested on the shape such a report arrives in: a cover page, a cost table drawn
as an image with ruled columns, sub-totals, a contingency, a fee, a total, GST
and a grand total, and a page of site photographs with captions in English.

The same table, as figures, is in test/fixtures/cost-report.ts. The text-layer
form of the report is built as the tests run (test/fixtures/report-papers.ts);
this file is the form whose pages are pictures.

Regenerate:  python3 test/fixtures/documents/make_reports.py
Needs Pillow. The output is committed, so no test needs it.
"""

from __future__ import annotations

import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

W, H = 2480, 1754  # A4 landscape at 300 dpi


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for path in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


COLUMNS = ["Sl", "Packages", "Budget", "Awarded value", "Awarded to", "Anticipated final cost", "Amount certified", "Cost per sq ft"]
EDGES = [90, 190, 800, 1070, 1340, 1700, 1990, 2230, 2390]
RIGHT = {2, 3, 5, 6, 7}

# kind, cells
ROWS = [
    ("head", ["A", "CIVIL AND STRUCTURE", "", "", "", "", "", ""]),
    ("row", ["1", "Earthwork and excavation", "85,00,000", "82,40,000", "Ridgeline Earthmovers", "82,40,000", "82,40,000", "69"]),
    ("row", ["2", "RCC structure", "12,50,00,000", "12,18,60,000", "Northgate Constructions", "12,46,10,000", "6,04,25,000", "1,038"]),
    ("row", ["3", "Masonry and plastering", "2,40,00,000", "-", "-", "2,40,00,000", "-", "200"]),
    ("sum", ["", "SUB-TOTAL A", "15,75,00,000", "13,01,00,000", "", "15,68,50,000", "6,86,65,000", "1,307"]),
    ("head", ["B", "FINISHES", "", "", "", "", "", ""]),
    ("row", ["4", "Flooring and tiling", "3,10,00,000", "-", "-", "3,10,00,000", "-", "258"]),
    ("row", ["5", "Doors and windows", "2,25,00,000", "2,31,50,000", "Harbour Joinery", "2,31,50,000", "23,15,000", "193"]),
    ("row", ["6", "Painting", "95,00,000", "-", "-", "95,00,000", "-", "79"]),
    ("sum", ["", "SUB-TOTAL B", "6,30,00,000", "2,31,50,000", "", "6,36,50,000", "23,15,000", "530"]),
    ("head", ["C", "SERVICES", "", "", "", "", "", ""]),
    ("row", ["7", "Electrical works", "2,80,00,000", "2,74,00,000", "Corewire Electricals", "2,74,00,000", "54,80,000", "228"]),
    ("row", ["8", "Plumbing and fire fighting", "1,90,00,000", "-", "-", "1,90,00,000", "-", "158"]),
    ("row", ["9", "Lifts", "1,20,00,000", "1,16,00,000", "Summit Elevators", "1,16,00,000", "11,60,000", "97"]),
    ("sum", ["", "SUB-TOTAL C", "5,90,00,000", "3,90,00,000", "", "5,80,00,000", "66,40,000", "483"]),
    ("row", ["10", "Design contingency", "1,00,00,000", "-", "-", "1,00,00,000", "-", "83"]),
    ("row", ["11", "Project management consultancy fee", "90,00,000", "90,00,000", "Meridian Cost Consultants", "90,00,000", "36,00,000", "75"]),
    ("sum", ["", "TOTAL", "29,85,00,000", "20,12,50,000", "", "29,75,00,000", "8,12,20,000", "2,479"]),
    ("sum", ["", "GST @ 18%", "5,37,30,000", "", "", "5,35,50,000", "", ""]),
    ("sum", ["", "GRAND TOTAL", "35,22,30,000", "", "", "35,10,50,000", "", "2,925"]),
]


def cover() -> Image.Image:
    img = Image.new("L", (W, H), 255)
    draw = ImageDraw.Draw(img)
    draw.text((W // 2, 420), "MONTHLY COST REPORT", font=font(96, True), fill=0, anchor="mm")
    draw.text((W // 2, 560), "Cost Report No. 5 - August 2026", font=font(60), fill=0, anchor="mm")
    draw.text((W // 2, 700), "Lakeview Residences, Mysuru", font=font(60), fill=0, anchor="mm")
    draw.text((W // 2, 840), "Prepared by Meridian Cost Consultants for Lakeview Homes", font=font(44), fill=0, anchor="mm")
    draw.text((W // 2, 1000), "Built-up area 1,20,000 sq ft", font=font(44), fill=0, anchor="mm")
    draw.text((W // 2, 1620), "INVENTED FOR TESTS - NOT A REAL REPORT", font=font(34), fill=90, anchor="mm")
    return img


def table() -> Image.Image:
    img = Image.new("L", (W, H), 255)
    draw = ImageDraw.Draw(img)
    draw.text((90, 110), "COST SUMMARY - BUDGET AGAINST ANTICIPATED FINAL COST", font=font(48, True), fill=0)
    top = 210
    row_h = 66
    y = top
    body, bold = font(36), font(36, True)
    lines = [("hdr", COLUMNS)] + ROWS
    for kind, cells in lines:
        if kind in ("hdr", "head", "sum"):
            draw.rectangle([EDGES[0], y, EDGES[-1], y + row_h], fill=228 if kind != "hdr" else 205)
        for n, cell in enumerate(cells):
            f = bold if kind in ("hdr", "head", "sum") else body
            if n in RIGHT and kind != "hdr":
                draw.text((EDGES[n + 1] - 14, y + row_h // 2), cell, font=f, fill=0, anchor="rm")
            else:
                draw.text((EDGES[n] + 14, y + row_h // 2), cell if kind != "hdr" or len(cell) < 14 else cell, font=f if kind != "hdr" else font(28, True), fill=0, anchor="lm")
        y += row_h
        draw.line([EDGES[0], y, EDGES[-1], y], fill=0, width=2)
    draw.line([EDGES[0], top, EDGES[-1], top], fill=0, width=3)
    for x in EDGES:
        draw.line([x, top, x, y], fill=0, width=2)
    draw.text((90, 1650), "All amounts in Indian rupees. GST shown separately.", font=font(30), fill=0)
    return img


def photos() -> Image.Image:
    """Two site photographs, drawn as textured pictures, each captioned in English."""
    rng = random.Random(7)
    img = Image.new("L", (W, H), 255)
    draw = ImageDraw.Draw(img)
    draw.text((90, 110), "SITE PROGRESS PHOTOGRAPHS", font=font(48, True), fill=0)
    for n, (x, caption) in enumerate(((90, "Tower A - third floor slab reinforcement in progress"), (1290, "Tower B - blockwork to the second floor"))):
        pic = Image.effect_noise((1100, 1000), 60).filter(ImageFilter.GaussianBlur(3))
        shade = ImageDraw.Draw(pic)
        for _ in range(60):
            a, b = rng.randrange(1100), rng.randrange(1000)
            shade.rectangle([a, b, a + rng.randrange(30, 320), b + rng.randrange(10, 200)], fill=rng.randrange(20, 235))
            shade.line([rng.randrange(1100), rng.randrange(1000), rng.randrange(1100), rng.randrange(1000)], fill=rng.randrange(0, 255), width=rng.randrange(2, 9))
        pic = pic.filter(ImageFilter.GaussianBlur(1.2))
        img.paste(pic, (x, 220))
        draw.text((x, 1260), f"Photo {n + 1}: {caption}", font=font(36), fill=0)
    return img


def main() -> None:
    pages = [cover(), table(), photos()]
    out = os.path.join(HERE, "SCANNED_Cost_Report_Tables_As_Images.pdf")
    pages[0].save(out, "PDF", resolution=300.0, save_all=True, append_images=pages[1:], quality=70)
    print("wrote", out, os.path.getsize(out))
    # The table and the photographs as pictures of their own, for a page of type with a picture set on it.
    pages[1].save(os.path.join(HERE, "Cost_Report_Table_Picture.png"))
    pages[2].save(os.path.join(HERE, "Cost_Report_Photographs_Picture.jpg"), quality=70)


if __name__ == "__main__":
    main()
