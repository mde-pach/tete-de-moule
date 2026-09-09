#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tableau chromatique complet des doigtes, sur tout l'ambitus utile.
Une page par clef de lecture.

    python3 outils/tableau_complet.py [sortie.pdf]
"""
import io
import sys

from pypdf import PdfReader, PdfWriter, Transformation
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

import _commun as k
import doigtes_euphonium as de

LO, HI = 41, 67          # hauteurs reelles : Fa2 -> Sol4
PER_LINE = 9
COMBOS = ["0", "2", "1", "1-2", "2-3", "1-3", "1-2-3"]


def chart_xml(clef, octave_up, valves):
    root, part = k.musicxml_head(clef, PER_LINE)
    notes = list(range(LO, HI + 1))
    chunks = [notes[i:i + PER_LINE] for i in range(0, len(notes), PER_LINE)]
    for mi, chunk in enumerate(chunks, 1):
        m = de.sub(part, "measure", number=mi)
        if mi == 1:
            k.attributes(m, clef, 4 * PER_LINE)
        for concert in chunk:
            tpc = k.tpc_of(concert)
            k.whole_note(m, concert, tpc, octave_up,
                         de.fingering(concert, valves), de.note_name_fr(tpc))
        bl = de.sub(m, "barline", location="right")
        de.sub(bl, "bar-style", "none" if mi < len(chunks) else "light-heavy")
    return k.serialize(root)


def page(clef, octave_up, valves, sous_titre, used, tmp):
    reg, bold = k.register_fonts()
    W, H = A4
    opts = {"pageWidth": 2000, "pageHeight": 2400, "scale": 46,
            "adjustPageHeight": True, "header": "none", "footer": "none",
            "lyricSize": 5.2, "spacingStaff": 30, "spacingSystem": 28,
            "pageMarginTop": 20, "pageMarginLeft": 20, "pageMarginRight": 20,
            "mnumInterval": 0, "font": "Leipzig"}
    chart = k.engrave_to_pdf_page(chart_xml(clef, octave_up, valves), opts, tmp, 470)
    ch = float(chart.mediabox.height)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    y = H - 55
    c.setFont(bold, 15)
    c.drawCentredString(W / 2, y, "Tableau complet des doigt\u00e9s \u2014 euphonium en Si\u266d")
    y -= 20
    c.setFont(reg, 10.5)
    c.drawCentredString(W / 2, y, sous_titre)
    y -= 28
    c.setFont(reg, 9.5)
    for line in ["Du Sol grave au Sol aigu, note par note, demi-ton par demi-ton.",
                 "Les notes \u00e9crites en b\u00e9mol se lisent aussi en di\u00e8se : "
                 "La\u266d = Sol\u266f, Mi\u266d = R\u00e9\u266f, etc. M\u00eame doigt\u00e9."]:
        c.drawString(58, y, line)
        y -= 15

    yy = H - 175 - ch
    c.setFont(bold, 10.5)
    c.drawString(58, yy, "Les 7 combinaisons, de la plus courte \u00e0 la plus longue")
    yy -= 17
    for combo, txt in [("0", "\u00e0 vide"), ("2", "piston 2"), ("1", "piston 1"),
                       ("1-2", "pistons 1 + 2"), ("2-3", "pistons 2 + 3"),
                       ("1-3", "pistons 1 + 3"), ("1-2-3", "les trois pistons")]:
        c.setFont(bold, 9.5)
        c.drawString(58, yy, combo)
        c.setFont(reg, 9.5)
        c.drawString(100, yy, txt)
        if used is not None:
            c.setFont(reg, 8.5)
            c.drawString(200, yy, "  \u2190 dans ton morceau" if combo in used
                         else "  (absent de ton morceau)")
        yy -= 14
    yy -= 8
    c.setFont(reg, 9.5)
    for line in ["Chaque piston enfonc\u00e9 rallonge le tube et fait descendre la note :",
                 "le 2 d'un demi-ton, le 1 d'un ton, le 3 d'un ton et demi.",
                 "Avec un 4e piston, remplace 1-3 par 4 et 1-2-3 par 2-4 : c'est plus juste."]:
        c.drawString(58, yy, line)
        yy -= 14
    c.save()
    buf.seek(0)

    p = PdfReader(buf).pages[0]
    p.merge_transformed_page(chart, Transformation().translate(60, H - 168 - ch))
    return p


def main(out="tableau_complet.pdf", valves=3, used=None):
    w = PdfWriter()
    w.add_page(page("F", False, valves, "Cl\u00e9 de fa \u2014 \u00e9criture non transpos\u00e9e \u00e0 l'octave",
                    used, "_tc1.musicxml"))
    w.add_page(page("G", True, valves, "Cl\u00e9 de sol \u2014 lecture Si\u266d",
                    used, "_tc2.musicxml"))
    with open(out, "wb") as f:
        w.write(f)
    print(out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "tableau_complet.pdf")
