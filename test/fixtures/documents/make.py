#!/usr/bin/env python3
"""
Synthetic Karnataka property documents for trying Realytica end to end.

Every document here is invented. Every page carries a DEMO banner, and no
party, survey number, registration number or amount refers to a real one.
They exist so a person can drop a realistic file into the chat and watch it
read — and so the reader has tests that look like what it will actually see.

What they are built to exercise:

  * Text-layer PDFs written by Ghostscript, so their content streams are
    FlateDecode-compressed and multi-page — the shape a registry or BBMP
    portal actually issues, not a hand-rolled uncompressed toy.
  * Scanned copies (a JPEG and an image-only PDF) with no text layer at all,
    which only OCR can read.
  * One file = one parcel. The values agree with each other where a real
    set would, and disagree in two places a diligence has to catch:
      - the khata records a smaller extent than the title (11,850 vs 12,000
        sqm), which the extent check computes as a divergence;
      - the encumbrance certificate carries a subsisting mortgage.

Regenerate:  python3 test/fixtures/documents/make.py
Needs Ghostscript (`gs`) and Pillow. The outputs are committed, so trying the
product never needs either.
"""

from __future__ import annotations

import os
import random
import subprocess
import tempfile
import textwrap

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = HERE

BANNER = "DEMO DOCUMENT - SYNTHETIC - NOT A REAL INSTRUMENT"

# The parcel every document describes.
PARCEL = {
    "sy": "118/2",
    "village": "Whitefield",
    "hobli": "Varthur",
    "taluk": "Bengaluru East",
    "district": "Bengaluru Urban",
    "extent_sqm": "12,000",
    "extent_ag": "2 Acres 38 Guntas",
    "owner": "Whitefield Tech Parks LLP",
    "vendor": "Sunrise Estates Private Limited",
    "root_owner": "Sri K. Ramaiah",
}


def ps_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def pages_to_pdf(path: str, pages: list[list[tuple[str, str]]]) -> None:
    """Write a multi-page, compressed, text-layer PDF through Ghostscript.

    Each page is a list of (style, text) lines; style is one of
    title / head / body / small / rule / gap.
    """
    ps = ["%!PS-Adobe-3.0", "%%Pages: " + str(len(pages))]
    fonts = {
        "title": ("/Times-Bold", 17, 26),
        "head": ("/Helvetica-Bold", 11, 18),
        "body": ("/Times-Roman", 11, 15),
        "small": ("/Helvetica", 8, 11),
    }
    for number, lines in enumerate(pages, 1):
        ps.append(f"%%Page: {number} {number}")
        ps.append("/Helvetica-Bold findfont 8 scalefont setfont 0.55 setgray")
        ps.append(f"56 812 moveto ({ps_escape(BANNER)}) show 0 setgray")
        y = 780
        for style, text in lines:
            if style == "gap":
                y -= 10
                continue
            if style == "rule":
                ps.append(f"0.6 setlinewidth 56 {y + 4} moveto 539 {y + 4} lineto stroke")
                y -= 10
                continue
            font, size, lead = fonts[style]
            width = 92 if style in ("body",) else (110 if style == "small" else 70)
            wrapped = textwrap.wrap(text, width=width) or [""]
            for part in wrapped:
                if style == "title":
                    # Centre titles the way a registry form does.
                    ps.append(f"{font} findfont {size} scalefont setfont")
                    ps.append(f"({ps_escape(part)}) dup stringwidth pop 2 div 297.5 exch sub {y} moveto show")
                else:
                    ps.append(f"{font} findfont {size} scalefont setfont 56 {y} moveto ({ps_escape(part)}) show")
                y -= lead
        ps.append("/Helvetica findfont 8 scalefont setfont 0.55 setgray")
        ps.append(f"56 36 moveto (Page {number} of {len(pages)}) show 0 setgray")
        ps.append("showpage")
    with tempfile.NamedTemporaryFile("w", suffix=".ps", delete=False) as fh:
        fh.write("\n".join(ps))
        src = fh.name
    try:
        subprocess.run(
            ["gs", "-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.6", f"-sOutputFile={path}", src],
            check=True,
        )
    finally:
        os.unlink(src)


def scan(lines: list[str], seed: int, tilt: float) -> Image.Image:
    """A page that only OCR can read: text drawn into pixels, then roughened
    the way a phone photograph or a cheap scanner roughens it."""
    rng = random.Random(seed)
    w, h = 1654, 2339  # A4 at 200 dpi
    img = Image.new("L", (w, h), 246)
    draw = ImageDraw.Draw(img)
    try:
        body = ImageFont.truetype("/System/Library/Fonts/Supplemental/Times New Roman.ttf", 34)
        bold = ImageFont.truetype("/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf", 46)
        small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24)
    except OSError:
        body = bold = small = ImageFont.load_default()
    draw.text((110, 70), BANNER, fill=120, font=small)
    y = 150
    for line in lines:
        if line.startswith("# "):
            text = line[2:]
            tw = draw.textlength(text, font=bold)
            draw.text(((w - tw) / 2, y), text, fill=20, font=bold)
            y += 76
            continue
        for part in textwrap.wrap(line, width=70) or [""]:
            draw.text((120, y), part, fill=25, font=body)
            y += 50
        y += 8
    # Paper grain, a little blur, and the page not quite square on the glass.
    noise = Image.effect_noise((w, h), 14).point(lambda v: 255 if v > 128 else 238)
    img = Image.composite(img, noise, Image.new("L", (w, h), 215))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img = img.rotate(tilt, resample=Image.BICUBIC, expand=False, fillcolor=236)
    del rng
    return img


def sale_deed() -> list[list[tuple[str, str]]]:
    p = PARCEL
    return [
        [
            ("title", "SALE DEED"),
            ("small", "Government of Karnataka - Department of Stamps and Registration"),
            ("gap", ""),
            ("body", "This Deed of Absolute Sale is made and executed at Bengaluru on this the 12th day of March, 2019 (12-03-2019)."),
            ("head", "BY"),
            ("body", f"{p['vendor']}, a company incorporated under the Companies Act, 1956, having its registered office at No. 14, "
                     "Residency Road, Bengaluru 560025, represented by its authorised signatory, hereinafter called the VENDOR."),
            ("head", "IN FAVOUR OF"),
            ("body", f"{p['owner']}, a limited liability partnership having its office at No. 3, ITPL Main Road, Whitefield, "
                     "Bengaluru 560066, represented by its designated partner, hereinafter called the PURCHASER."),
            ("gap", ""),
            ("head", "RECITALS"),
            ("body", f"WHEREAS the Vendor is the absolute owner of the Schedule Property having purchased the same from {p['root_owner']} "
                     "under a registered Sale Deed dated 06-09-1998, registered as Document No. 2217/1998-99 in the office of the "
                     "Sub-Registrar, Varthur, which is the root of title of the Vendor."),
            ("body", "WHEREAS the Schedule Property was converted from agricultural to non-agricultural residential use by an Order "
                     "of the Deputy Commissioner, Bengaluru Urban District, bearing No. ALN(E)(V)SR 212/2016-17 dated 14-11-2017."),
            ("body", "WHEREAS the Vendor has agreed to sell and the Purchaser has agreed to purchase the Schedule Property for a "
                     "total sale consideration of Rs. 42,00,00,000 (Rupees Forty Two Crores only)."),
        ],
        [
            ("head", "NOW THIS DEED WITNESSETH"),
            ("body", "In consideration of Rs. 42,00,00,000 paid by the Purchaser to the Vendor by way of RTGS transfers, the receipt "
                     "of which the Vendor hereby acknowledges, the Vendor hereby conveys, transfers and sells the Schedule Property "
                     "unto the Purchaser absolutely and forever, free from all encumbrances, charges, liens and claims."),
            ("body", "The Vendor covenants that the Schedule Property is not subject to any mortgage, attachment or acquisition "
                     "proceedings, and that the Vendor has paid all taxes and cesses up to the date of this deed."),
            ("gap", ""),
            ("head", "SCHEDULE PROPERTY"),
            ("body", f"All that piece and parcel of converted land bearing Survey No. {p['sy']}, situated at {p['village']} Village, "
                     f"{p['hobli']} Hobli, {p['taluk']} Taluk, {p['district']} District, measuring {p['extent_sqm']} square metres "
                     f"({p['extent_ag']}), abutting Whitefield Main Road, and bounded on the:"),
            ("body", "North by: Survey No. 117"),
            ("body", "South by: Whitefield Main Road (80 feet wide)"),
            ("body", "East by: Survey No. 119"),
            ("body", "West by: Survey No. 118/1"),
            ("gap", ""),
            ("body", "Access: The Schedule Property has direct frontage and access on the public road, Whitefield Main Road."),
        ],
        [
            ("head", "REGISTRATION"),
            ("body", "Registered as Document No. WTF-1-04471-2018-19, Book I, in the office of the Sub-Registrar, Whitefield, "
                     "Bengaluru, on 12-03-2019."),
            ("body", "Stamp duty paid: Rs. 2,35,20,000. Registration fee paid: Rs. 42,00,000."),
            ("gap", ""),
            ("body", "IN WITNESS WHEREOF the Vendor and the Purchaser have set their hands to this Deed on the day, month and year "
                     "first above written."),
            ("gap", ""),
            ("body", "VENDOR: for Sunrise Estates Private Limited, Authorised Signatory"),
            ("body", "PURCHASER: for Whitefield Tech Parks LLP, Designated Partner"),
            ("body", "WITNESSES: 1. R. Suresh, Bengaluru   2. A. Farooq, Bengaluru"),
        ],
    ]


def mother_deed() -> list[list[tuple[str, str]]]:
    p = PARCEL
    return [
        [
            ("title", "SALE DEED"),
            ("small", "Office of the Sub-Registrar, Varthur - Document No. 2217/1998-99, Book I"),
            ("gap", ""),
            ("body", "This Sale Deed is executed at Bengaluru on 06-09-1998."),
            ("body", f"BY {p['root_owner']}, son of late Sri K. Muniyappa, aged about 58 years, residing at Whitefield Village, "
                     "hereinafter called the VENDOR,"),
            ("body", f"IN FAVOUR OF {p['vendor']}, hereinafter called the PURCHASER."),
            ("body", f"The Vendor is the absolute owner of the land bearing Survey No. {p['sy']} of {p['village']} Village, having "
                     "inherited the same from his father, as shown in the RTC and mutation register MR No. 44/1979-80."),
            ("body", "Sale consideration: Rs. 18,50,000 (Rupees Eighteen Lakhs Fifty Thousand only), paid in full."),
            ("head", "SCHEDULE"),
            ("body", f"Agricultural land bearing Survey No. {p['sy']}, {p['village']} Village, {p['hobli']} Hobli, "
                     f"{p['taluk']} Taluk, measuring {p['extent_ag']} ({p['extent_sqm']} square metres)."),
            ("body", "Registered on 06-09-1998 at the office of the Sub-Registrar, Varthur."),
        ]
    ]


def encumbrance_certificate() -> list[list[tuple[str, str]]]:
    p = PARCEL
    return [
        [
            ("title", "ENCUMBRANCE CERTIFICATE"),
            ("small", "FORM No. 15 [See Rule 146] - Karnataka Registration Rules, 1965"),
            ("gap", ""),
            ("body", "Office of the Sub-Registrar, Whitefield, Bengaluru. Application No. EC/WTF/2025/118842."),
            ("body", f"Encumbrances on the property: Survey No. {p['sy']}, {p['village']} Village, {p['hobli']} Hobli, "
                     f"{p['taluk']} Taluk, measuring {p['extent_sqm']} square metres."),
            ("body", "Period of search: from 01-04-1995 to 31-03-2025."),
            ("gap", ""),
            ("head", "TRANSACTIONS FOUND DURING THE PERIOD"),
            ("body", "1. 06-09-1998 - Sale Deed - Doc. No. 2217/1998-99 - Executant: Sri K. Ramaiah - Claimant: Sunrise Estates "
                     "Private Limited - Consideration Rs. 18,50,000."),
            ("body", "2. 12-03-2019 - Sale Deed - Doc. No. WTF-1-04471-2018-19 - Executant: Sunrise Estates Private Limited - "
                     "Claimant: Whitefield Tech Parks LLP - Consideration Rs. 42,00,00,000."),
            ("body", "3. 18-08-2021 - Mortgage by deposit of title deeds - Doc. No. WTF-1-02930-2021-22 - Executant: Whitefield "
                     "Tech Parks LLP - Claimant: Deccan Urban Co-operative Bank Ltd - Amount secured Rs. 25,00,00,000. "
                     "No release deed registered during the period."),
            ("gap", ""),
            ("body", "It is certified that, save the acts and encumbrances stated above, no other acts or encumbrances affecting "
                     "the said property have been found during the period searched."),
            ("body", "Date of issue: 04-08-2025. Sub-Registrar, Whitefield."),
        ]
    ]


def khata() -> list[list[tuple[str, str]]]:
    p = PARCEL
    return [
        [
            ("title", "KHATA CERTIFICATE AND KHATA EXTRACT"),
            ("small", "Bruhat Bengaluru Mahanagara Palike - Revenue Department - Mahadevapura Zone, Ward 84 (Hagadur)"),
            ("gap", ""),
            ("body", "Khata type: A-Khata (Form A register)."),
            ("body", "Khata No.: 1182/118/2. PID No.: 81-120-118/2."),
            ("body", f"Name of the owner: {p['owner']}."),
            ("body", f"Property: Survey No. {p['sy']}, {p['village']} Village, Whitefield Main Road, Bengaluru 560066."),
            ("body", "Site area: 11,850 square metres. Built-up area on record: nil (vacant land)."),
            ("body", "Property tax paid up to: 2025-26."),
            ("gap", ""),
            ("body", "Certified that the above property stands registered in the name of the above owner in the Khata register "
                     "of this office. Issued on 19-05-2025 by the Assistant Revenue Officer, Hagadur."),
        ]
    ]


def tax_receipt() -> list[list[tuple[str, str]]]:
    p = PARCEL
    return [
        [
            ("title", "PROPERTY TAX PAYMENT RECEIPT"),
            ("small", "Bruhat Bengaluru Mahanagara Palike - Self Assessment Scheme (SAS)"),
            ("gap", ""),
            ("body", "SAS Application No.: 2025-26-0081-44712. Assessment year: 2025-26."),
            ("body", "PID No.: 81-120-118/2. Ward: 84 Hagadur."),
            ("body", f"Owner: {p['owner']}."),
            ("body", "Property tax: Rs. 17,88,000. Cess: Rs. 54,650. Total amount paid: Rs. 18,42,650."),
            ("body", "Date of payment: 28-04-2025. Mode: Net banking. Transaction reference: BBMPSAS2504281177."),
        ]
    ]


def zoning() -> list[list[tuple[str, str]]]:
    p = PARCEL
    return [
        [
            ("title", "ZONING CERTIFICATE"),
            ("small", "Bangalore Development Authority - Town Planning Section - Revised Master Plan 2015"),
            ("gap", ""),
            ("body", "Certificate No. BDA/TPM/ZC/2025/3318, dated 11-06-2025."),
            ("body", f"Property: Survey No. {p['sy']}, {p['village']} Village, {p['hobli']} Hobli, {p['taluk']} Taluk."),
            ("body", "Land use as per the Revised Master Plan 2015 (plan in force): Residential (Main)."),
            ("body", "Planning district: 16 (Whitefield). Abutting road width as per the plan: 24 metres (80 feet)."),
            ("body", "Permissible FAR: 2.25. Permissible ground coverage: 50 percent."),
            ("gap", ""),
            ("body", "This certificate states the land use in the master plan in force only. It does not regularise any "
                     "building and is not a building plan sanction. Issued by the Town Planning Member, BDA."),
        ]
    ]


def conversion_order() -> list[list[tuple[str, str]]]:
    p = PARCEL
    return [
        [
            ("title", "OFFICIAL MEMORANDUM"),
            ("small", "Office of the Deputy Commissioner, Bengaluru Urban District"),
            ("gap", ""),
            ("body", "No. ALN(E)(V)SR 212/2016-17, dated 14-11-2017."),
            ("body", "Subject: Conversion of agricultural land to non-agricultural residential purpose under Section 95(2) of the "
                     "Karnataka Land Revenue Act, 1964."),
            ("body", f"Land: Survey No. {p['sy']}, {p['village']} Village, {p['hobli']} Hobli, {p['taluk']} Taluk, "
                     f"measuring {p['extent_ag']}."),
            ("body", "ORDER: Permission is hereby granted to convert the above land from agricultural to non-agricultural "
                     "residential purpose, subject to payment of conversion fine, which has been paid vide challan dated 02-11-2017."),
            ("body", "Deputy Commissioner, Bengaluru Urban District."),
        ]
    ]


def sanctioned_plan() -> list[list[tuple[str, str]]]:
    p = PARCEL
    return [
        [
            ("title", "BUILDING PLAN SANCTION"),
            ("small", "Bruhat Bengaluru Mahanagara Palike - Town Planning - Joint Director (East)"),
            ("gap", ""),
            ("body", "LP No. BBMP/Addl.Dir/JD EAST/0142/2020-21. Date of sanction: 22-02-2021."),
            ("body", f"Applicant: {p['owner']}. Property: Survey No. {p['sy']}, {p['village']} Village, PID No. 81-120-118/2."),
            ("body", "Proposal: Residential apartment building, 2 basements + ground + 14 upper floors (Block C)."),
            ("body", "Site area: 12,000 square metres. Sanctioned built-up area: 27,000 square metres."),
            ("body", "FAR sanctioned: 2.25. Ground coverage sanctioned: 42 percent."),
            ("body", "Refuge area provided: 310 square metres."),
            ("gap", ""),
            ("body", "Sanction valid for two years from the date of sanction. Any deviation from the sanctioned plan beyond "
                     "5 percent is not regularisable."),
        ]
    ]


def survey_sketch() -> list[list[tuple[str, str]]]:
    p = PARCEL
    return [
        [
            ("title", "SURVEY SKETCH (HISSA / 11E)"),
            ("small", "Department of Survey, Settlement and Land Records, Karnataka"),
            ("gap", ""),
            ("body", f"Survey No. {p['sy']}, {p['village']} Village, {p['hobli']} Hobli, {p['taluk']} Taluk, {p['district']} District."),
            ("body", "Extent as measured on the ground: 11,980 square metres."),
            ("body", "Abutting road: Whitefield Main Road, road width 80 feet."),
            ("body", "Sketch prepared on 03-02-2025 by the Licensed Surveyor, Bengaluru East."),
        ]
    ]


TEXT_DOCS = [
    ("Sale_Deed_2019_Sy_118-2_Whitefield.pdf", sale_deed),
    ("Mother_Deed_1998_Sy_118-2.pdf", mother_deed),
    ("Encumbrance_Certificate_Form15_1995-2025.pdf", encumbrance_certificate),
    ("Khata_Certificate_and_Extract_BBMP.pdf", khata),
    ("Property_Tax_Receipt_BBMP_2025-26.pdf", tax_receipt),
    ("Zoning_Certificate_BDA_RMP2015.pdf", zoning),
    ("DC_Conversion_Order_2017.pdf", conversion_order),
    ("Building_Plan_Sanction_BBMP_2021.pdf", sanctioned_plan),
    ("Survey_Sketch_11E_Sy_118-2.pdf", survey_sketch),
]


def as_scan_lines(pages: list[list[tuple[str, str]]]) -> list[str]:
    lines: list[str] = []
    for page in pages:
        for style, text in page:
            if style == "title":
                lines.append("# " + text)
            elif style in ("body", "head", "small"):
                lines.append(text)
    return lines


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for name, build in TEXT_DOCS:
        pages_to_pdf(os.path.join(OUT, name), build())
        print("wrote", name)

    # A phone photograph of the deed's schedule page: JPEG, no text layer.
    deed = sale_deed()
    photo = scan(as_scan_lines([deed[1]]), seed=7, tilt=-0.9).convert("RGB")
    photo.save(os.path.join(OUT, "SCANNED_Sale_Deed_Schedule_Page.jpg"), quality=82)
    print("wrote SCANNED_Sale_Deed_Schedule_Page.jpg")

    # A scanned EC: an image-only PDF, which is how most people send one.
    ec = scan(as_scan_lines(encumbrance_certificate()), seed=11, tilt=0.6).convert("RGB")
    ec.save(os.path.join(OUT, "SCANNED_Encumbrance_Certificate.pdf"), "PDF", resolution=200)
    print("wrote SCANNED_Encumbrance_Certificate.pdf")


if __name__ == "__main__":
    main()
