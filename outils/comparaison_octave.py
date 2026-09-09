#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Illustre l'erreur classique : passer une partie en clef de sol sans decaler
d'une octave. Rend le meme extrait de trois facons.

    python3 outils/comparaison_octave.py partition.mscz --partie 4 --de 31 --a 34
"""
import argparse
import io
import os
import shutil
import sys

from lxml import etree
from pypdf import PdfReader, PdfWriter, Transformation
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

import _commun as k
import doigtes_euphonium as de


def trimmed(mscx, staff_index, first, last, out):
    """Copie du .mscx ne gardant que les mesures [first, last] de la portee."""
    tree = etree.parse(mscx)
    staff = tree.getroot().find("Score").findall("Staff")[staff_index]
    for i, m in enumerate(staff.findall("Measure"), 1):
        if not (first <= i <= last):
            staff.remove(m)
    tree.write(out, encoding="UTF-8", xml_declaration=True)
    return out


def snippet(mscx, staff_index, clef, octave_up, tag, width=430):
    xml = de.to_musicxml(mscx, staff_index, clef=clef, octave_up=octave_up,
                         show_names=False, part_name="", title="")
    opts = {"pageWidth": 2000, "pageHeight": 900, "scale": 40,
            "adjustPageHeight": True, "header": "none", "footer": "none",
            "lyricSize": 5.0, "spacingStaff": 20,
            "pageMarginTop": 30, "pageMarginBottom": 30,
            "pageMarginLeft": 15, "pageMarginRight": 15, "font": "Leipzig"}
    return k.engrave_to_pdf_page(xml, opts, "_cmp_%s.musicxml" % tag, width)


def build(mscz, staff_index, first, last, out):
    reg, bold = k.register_fonts()
    tmp, mscx = de.unpack(mscz)
    src = trimmed(mscx, staff_index, first, last, os.path.join(tmp, "_cmp.mscx"))
    W, H = A4

    blocks = [
        ("1.  Cl\u00e9 de fa \u2014 l'original", "F", False,
         "Ce que contient le fichier. Tout tient dans la port\u00e9e."),
        ("2.  Cl\u00e9 de sol sans d\u00e9calage \u2014 le bug", "G", False,
         "M\u00eames notes \u00e9crites, simplement affich\u00e9es en cl\u00e9 de sol. Tout part sous la port\u00e9e."),
        ("3.  Cl\u00e9 de sol avec d\u00e9calage d'octave \u2014 correct", "G", True,
         "On remonte l'\u00e9criture d'une octave. C'est la lecture Si\u266d de l'euphonium."),
    ]

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont(bold, 15)
    c.drawCentredString(W / 2, H - 55, "Pourquoi les notes sortent de la port\u00e9e")
    c.setFont(reg, 10.5)
    c.drawCentredString(W / 2, H - 75,
                        "Les mesures %d \u00e0 %d, \u00e9crites de trois fa\u00e7ons" % (first, last))
    top = H - 120
    for i, (title, clef, oct_up, note) in enumerate(blocks):
        c.setFont(bold, 11)
        c.drawString(70, top - i * 150 + 8, title)
    c.setFont(reg, 9.5)
    yy = top - 3 * 150 - 30
    c.setFont(bold, 10.5)
    c.drawString(70, yy, "En une phrase")
    yy -= 17
    c.setFont(reg, 9.5)
    for line in ["La trompette en Si\u266d lit une seconde majeure au-dessus du son r\u00e9el.",
                 "L'euphonium en cl\u00e9 de sol lit une neuvi\u00e8me majeure au-dessus : une octave de plus.",
                 "M\u00eame transposition, m\u00eames doigt\u00e9s \u2014 mais pas la m\u00eame octave d'\u00e9criture."]:
        c.drawString(70, yy, line)
        yy -= 14
    c.save()
    buf.seek(0)
    page = PdfReader(buf).pages[0]

    notes_buf = io.BytesIO()
    c2 = canvas.Canvas(notes_buf, pagesize=A4)
    c2.setFont(reg, 9)
    for i, (title, clef, oct_up, note) in enumerate(blocks):
        img = snippet(src, staff_index, clef, oct_up, str(i))
        ih = float(img.mediabox.height)
        ypos = top - i * 150 - ih
        page.merge_transformed_page(img, Transformation().translate(78, ypos))
        c2.drawString(70, ypos - 14, note)
    c2.save()
    notes_buf.seek(0)
    page.merge_page(PdfReader(notes_buf).pages[0])

    w = PdfWriter()
    w.add_page(page)
    with open(out, "wb") as f:
        w.write(f)
    shutil.rmtree(tmp, ignore_errors=True)
    print(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("fichier")
    ap.add_argument("--partie", type=int, required=True)
    ap.add_argument("--de", type=int, default=1)
    ap.add_argument("--a", type=int, default=4)
    ap.add_argument("--sortie", default="comparaison_octave.pdf")
    a = ap.parse_args()
    build(a.fichier, a.partie - 1, a.de, a.a, a.sortie)
