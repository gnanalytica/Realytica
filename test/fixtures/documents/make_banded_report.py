#!/usr/bin/env python3
"""
An invented cost table drawn as a spreadsheet prints one to a picture.

Every name and figure here is made up. The two pictures exist so the reader
is tested on a layout a consultant's report arrives in, and that an earlier
reader got none of:

- drawn at a screen's size, not at 300 dpi, so its type is small;
- the heading row, every sub-total and every total in white on a band of
  colour, which a reader of dark-on-light loses;
- a sub-total written with the section's letter and a dash before the words
  ("P - Sub Total"), a total of sub-totals in the middle of the table, and a
  line named "Grand Total" that is before GST, with the total after GST under
  it called something else;
- a contractor's name in one cell merged down four rows;
- a row for packages not let yet, whose own words are a column's ("unawarded",
  "Yet to be awarded");
- a row with no budget; a contingency worked on a sub-total;
- the table run on over a second page, whose total takes in the first page's.

The same table, as figures, is in test/cost-as-sent.test.ts.

Regenerate:  python3 test/fixtures/documents/make_banded_report.py
Needs Pillow. The output is committed, so no test needs it.
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

W = 1560
BLUE = (14, 104, 92)
PALE = (100, 170, 160)
DARK = (44, 52, 64)
RULE = (200, 200, 200)
INK = (0, 0, 0)
WHITE = (255, 255, 255)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for path in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


# Column edges: packages, awarded to, budget, forecast, certified, still to certify, notes.
EDGES = [0, 400, 700, 880, 1080, 1270, 1440, W]
HEADINGS = [
    ["Packages"],
    ["Awarded To"],
    ["Budget", "(Rs.) [P]"],
    ["Forecast final cost", "of the project", "(Rs.) [Q]"],
    ["Certified to", "05 Nov 2026", "(Rs.) [R]"],
    ["Still to", "certify", "[S = Q-R]"],
    ["Notes"],
]

PAGE_ONE = [
    ("gap",),
    ("row", "Frame, envelope and blockwork", "", "9,40,10,250", "9,40,10,250", "61,02,400", "8,79,07,850", ""),
    ("row", "Extra items", "", "18,30,500", "37,45,900", "15,20,300", "22,25,600", ""),
    ("row", "Frame - agreed changes", "", "82,15,700", "82,15,700", "70,05,111", "12,10,589", ""),
    ("row", "Price adjustment for ready-mix concrete", "", "", "4,12,340", "7,205", "4,05,135", ""),
    ("gap",),
    ("sub", "P - Sub Total", "10,40,56,450", "10,63,84,190", "1,46,35,016", "9,17,49,174"),
    ("gap",),
    ("head", "Owner supplied material"),
    ("tall", "Reinforcement supplied by the owner", ["Reinforcement by the owner - frame &", "envelope"], "2,61,00,000", "2,61,00,000", "30,45,125", "2,30,54,875", ""),
    ("gap",),
    ("sub", "Q - Sub Total", "2,61,00,000", "2,61,00,000", "30,45,125", "2,30,54,875"),
    ("gap",),
    ("row", "Interiors (unawarded, held against HCPL)", "Yet to be Awarded", "7,05,20,300", "7,05,20,300", "-", "7,05,20,300", ""),
    ("row", "Cladding and feature screens", "Yet to be Awarded", "1,92,40,600", "1,92,40,600", "-", "1,92,40,600", ""),
    ("row", "Building services", "Yet to be Awarded", "6,15,08,200", "6,15,08,200", "-", "6,15,08,200", ""),
    ("row", "Site works", "Yet to be Awarded", "2,48,30,900", "2,48,30,900", "-", "2,48,30,900", ""),
    ("row", "", "", "", "", "-", "-", ""),
    ("sub", "R - Sub Total", "17,61,00,000", "17,61,00,000", "-", "17,61,00,000"),
    ("gap",),
    ("total", "S - Total - (P+Q+R)", "30,62,56,450", "30,85,84,190", "1,76,80,140", "29,09,04,050"),
]

PAGE_TWO = [
    ("head", "Sundries"),
    ("row", "Sundry works", "", "6,20,000", "6,20,000", "-", "6,20,000", ""),
    ("row", "Design fees", "", "71,50,000", "71,50,000", "-", "71,50,000", ""),
    ("row", "Site supervision fee", "", "55,00,000", "55,00,000", "-", "55,00,000", ""),
    ("row", "Signage and wayfinding", "", "4,10,000", "4,10,000", "-", "4,10,000", ""),
    ("gap",),
    ("sub", "T - Sub Total", "1,36,80,000", "1,36,80,000", "-", "1,36,80,000"),
    ("gap",),
    ("head", "Contingency"),
    ("row", "Add Contingency 4% on Sub Total (S+T)", "", "1,27,97,458", "1,04,69,718", "", "1,04,69,718", ""),
    ("row", "", "", "", "", "-", "", ""),
    ("sub", "U- Sub Total", "1,27,97,458", "1,04,69,718", "-", "1,04,69,718"),
    ("gap",),
    ("total", "Grand Total - (S+T+U)", "33,27,33,908", "33,27,33,908", "1,76,80,140", "31,50,53,768"),
    ("pale", "GST (@18%)", "5,98,92,103", "5,98,92,103", "31,82,425", "5,67,09,678"),
    ("total", "Project outlay", "39,26,26,011", "39,26,26,011", "2,08,62,565", "37,17,63,446"),
]

# The contractor's name, written once in a cell merged down the first four rows of page one.
MERGED = ["M/s. Harbourline Constructions Pvt.", "Ltd. (Frame", "& envelope only)"]

HEIGHT = {"gap": 22, "row": 32, "sub": 32, "total": 46, "pale": 46, "head": 32, "tall": 54}


def draw(rows, name: str, title: str | None, merged: bool) -> None:
    head = 124
    top = 32 if title else 0
    height = top + head + sum(HEIGHT[row[0]] for row in rows) + 2
    image = Image.new("RGB", (W, height), WHITE)
    pen = ImageDraw.Draw(image)
    regular, bold = font(15), font(15, True)
    heading = font(17, True)

    def right(text: str, column: int, y: int, fill, face) -> None:
        width = pen.textlength(text, font=face)
        pen.text((EDGES[column + 1] - 8 - width, y), text, fill=fill, font=face)

    def centre(text: str, column: int, y: int, fill, face) -> None:
        width = pen.textlength(text, font=face)
        pen.text(((EDGES[column] + EDGES[column + 1] - width) / 2, y), text, fill=fill, font=face)

    if title:
        pen.rectangle([0, 0, W, top], fill=BLUE)
        width = pen.textlength(title, font=heading)
        pen.text(((W - width) / 2, 7), title, fill=WHITE, font=heading)
    pen.rectangle([0, top, W, top + head], fill=BLUE)
    for column, lines in enumerate(HEADINGS):
        start = top + (head - 25 * len(lines)) / 2
        for n, line in enumerate(lines):
            centre(line, column, int(start + 25 * n), WHITE, heading)

    y = top + head
    spans = []
    for row in rows:
        kind = row[0]
        h = HEIGHT[kind]
        if kind in ("sub", "total", "pale"):
            fill = DARK if kind == "sub" else PALE if kind == "pale" else BLUE
            pen.rectangle([0, y, W, y + h], fill=fill)
            pen.text((14 if kind == "sub" else 6, y + (h - 17) / 2), row[1], fill=WHITE, font=bold)
            for n, cell in enumerate(row[2:]):
                right(cell, 2 + n, int(y + (h - 17) / 2), WHITE, bold)
        elif kind == "head":
            pen.text((6, y + 8), row[1], fill=INK, font=bold)
        elif kind == "row":
            pen.text((6, y + 8), row[1], fill=INK, font=regular)
            pen.text((EDGES[1] + 4, y + 8), row[2], fill=INK, font=regular)
            for n, cell in enumerate(row[3:7]):
                right(cell, 2 + n, y + 8, INK, regular)
            spans.append((y, y + h))
        elif kind == "tall":
            pen.text((6, y + 19), row[1], fill=INK, font=regular)
            for n, line in enumerate(row[2]):
                pen.text((EDGES[1] + 4, y + 8 + 21 * n), line, fill=INK, font=regular)
            for n, cell in enumerate(row[3:7]):
                right(cell, 2 + n, y + 19, INK, regular)
        if kind not in ("sub", "total", "pale"):
            pen.line([0, y + h, W, y + h], fill=RULE)
        y += h
    if merged:
        # Centred down the four rows it is merged across, so its lines sit between theirs.
        first, last = spans[0][0], spans[3][1]
        start = (first + last - 21 * len(MERGED)) / 2
        for n, line in enumerate(MERGED):
            centre(line, 1, int(start + 21 * n), INK, regular)
        pen.rectangle([EDGES[1] + 1, first + 1, EDGES[2] - 1, last - 1], outline=WHITE)
    for edge in EDGES[1:-1]:
        pen.line([edge, top, edge, height], fill=INK)
    pen.rectangle([0, 0, W - 1, height - 1], outline=INK)
    image.save(os.path.join(HERE, name), optimize=True)
    print(name, image.size)


if __name__ == "__main__":
    draw(PAGE_ONE, "Cost_Table_Banded_Page_1.png", "BUDGET AGAINST FORECAST", merged=True)
    draw(PAGE_TWO, "Cost_Table_Banded_Page_2.png", None, merged=False)
