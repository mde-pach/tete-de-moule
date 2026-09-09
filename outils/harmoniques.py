#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Un doigte = plusieurs notes : la serie harmonique de chaque combinaison.
Une page par clef de lecture.

    python3 outils/harmoniques.py [sortie.pdf]
"""
import io
import sys

from pypdf import PdfReader, PdfWriter, Transformation
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

import _commun as k
import doigtes_euphonium as de

LO, HI = 41, 65
COMBOS = ["0", "2", "1", "1-2", "2-3", "1-3", "1-2-3"]


def row_xml(notes, clef, octave_up):
    root, part = k.musicxml_head(clef, len(notes))
    m = de.sub(part, "measure", number=1)
    k.attributes(m, clef, 4 * 5)
    for concert in notes:
        tpc = k.tpc_of(concert)
        k.whole_note(m, concert, tpc, octave_up,
                     str(k.harmonic_of(concert)), de.note_name_fr(tpc))
    de.sub(de.sub(m, "barline", location="right"), "bar-style", "light-heavy")
    return k.serialize(root)


def row(notes, clef, octave_up, tmp, width=300):
    opts = {"pageWidth": 1500, "pageHeight": 900, "scale": 40,
            "adjustPageHeight": True, "header": "none", "footer": "none",
            "lyricSize": 5.6, "spacingStaff": 20,
            "pageMarginTop": 10, "pageMarginBottom": 10,
            "pageMarginLeft": 10, "pageMarginRight": 10, "font": "Leipzig"}
    return k.engrave_to_pdf_page(row_xml(notes, clef, octave_up), opts, tmp, width)


def page(clef, octave_up, valves, sous_titre, tmp_prefix):
    reg, bold = k.register_fonts()
    W, H = A4
    rows = []
    for combo in COMBOS:
        notes = [c for c in range(LO, HI + 1) if de.fingering(c, valves) == combo]
        if notes:
            rows.append((combo, notes))

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    y = H - 55
    c.setFont(bold, 15)
    c.drawCentredString(W / 2, y, "Un doigt\u00e9 = plusieurs notes : les harmoniques")
    y -= 20
    c.setFont(reg, 10.5)
    c.drawCentredString(W / 2, y, sous_titre)
    y -= 30
    c.setFont(reg, 9.5)
    for line in ["Sur chaque ligne, tu ne bouges pas les doigts. Tout se joue aux l\u00e8vres "
                 "et \u00e0 la vitesse d'air.",
                 "Le chiffre en gras sous la note est le num\u00e9ro de l'harmonique : plus il "
                 "est grand, plus il faut",
                 "serrer les l\u00e8vres et acc\u00e9l\u00e9rer l'air. Les notes s'\u00e9cartent en bas, se "
                 "resserrent en haut."]:
        c.drawString(58, y, line)
        y -= 14

    top = H - 150
    step_y = 82
    for i, (combo, notes) in enumerate(rows):
        yy = top - i * step_y - 34
        c.setFont(bold, 13)
        c.drawRightString(132, yy, combo)
        c.setFont(reg, 8)
        c.drawRightString(132, yy - 13,
                          "%d note%s" % (len(notes), "s" if len(notes) > 1 else ""))
    yy = top - len(rows) * step_y - 20
    c.setFont(bold, 10.5)
    c.drawString(58, yy, "Le vocabulaire")
    yy -= 17
    c.setFont(reg, 9.5)
    for line in ["On parle d'harmoniques, de partiels ou de sons naturels \u2014 c'est la m\u00eame chose.",
                 "L'harmonique 1, une octave sous le 2, s'appelle la p\u00e9dale : tr\u00e8s grave, "
                 "difficile au d\u00e9but.",
                 "Les 7e et 11e harmoniques sonnent faux : on ne les utilise pas, d'o\u00f9 les "
                 "trous dans les lignes.",
                 "Le trombone marche pareil : ses 7 positions de coulisse correspondent aux "
                 "7 doigt\u00e9s."]:
        c.drawString(58, yy, line)
        yy -= 14
    c.save()
    buf.seek(0)
    base = PdfReader(buf).pages[0]

    for i, (combo, notes) in enumerate(rows):
        img = row(notes, clef, octave_up, "%s_%d.musicxml" % (tmp_prefix, i))
        ih = float(img.mediabox.height)
        base.merge_transformed_page(
            img, Transformation().translate(150, top - i * step_y - ih))
    return base


def main(out="harmoniques.pdf", valves=3):
    w = PdfWriter()
    w.add_page(page("F", False, valves, "Cl\u00e9 de fa", "_h1"))
    w.add_page(page("G", True, valves, "Cl\u00e9 de sol \u2014 lecture Si\u266d", "_h2"))
    with open(out, "wb") as f:
        w.write(f)
    print(out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "harmoniques.pdf")
