# -*- coding: utf-8 -*-
"""Briques partagees par les generateurs de fiches (outils/)."""
import io
import os
import sys

from lxml import etree

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import doigtes_euphonium as de  # noqa: E402

SVG_NS = "{http://www.w3.org/2000/svg}"

# tpc MuseScore : F=13 C=14 G=15 D=16 A=17 E=18 B=19 ; un bemol = -7
TPC = {"C": 14, "D": 16, "E": 18, "F": 13, "G": 15, "A": 17, "B": 19}
# orthographe retenue pour le chromatisme : bemols (usage courant en fanfare)
SPELL = {0: ("C", 0), 1: ("D", -1), 2: ("D", 0), 3: ("E", -1), 4: ("E", 0),
         5: ("F", 0), 6: ("G", -1), 7: ("G", 0), 8: ("A", -1), 9: ("A", 0),
         10: ("B", -1), 11: ("B", 0)}
# hauteur reelle de l'harmonique -> son numero
HARM_NO = {46: 2, 53: 3, 58: 4, 62: 5, 65: 6, 70: 8, 72: 9, 74: 10, 77: 12}


def tpc_of(concert):
    """tpc MuseScore de la note ecrite correspondant a une hauteur reelle."""
    step, alter = SPELL[(concert + 2) % 12]
    return TPC[step] + 7 * alter


def harmonic_of(concert):
    """Numero de l'harmonique sur lequel se joue la note."""
    candidates = [(p - concert, p) for p in de.PARTIALS if p - concert >= 0]
    if not candidates:
        return ""
    return HARM_NO.get(min(candidates)[1], "")


def register_fonts():
    """Enregistre DejaVu (pour le symbole bemol), avec repli sur Helvetica."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    dirs = ("/usr/share/fonts/truetype/dejavu/", "/Library/Fonts/", "C:/Windows/Fonts/")
    for name, filename in (("DJ", "DejaVuSans.ttf"), ("DJ-B", "DejaVuSans-Bold.ttf")):
        for d in dirs:
            if os.path.exists(d + filename):
                pdfmetrics.registerFont(TTFont(name, d + filename))
                break
        else:
            return "Helvetica", "Helvetica-Bold"
    return "DJ", "DJ-B"


def strip_measure_numbers(svg):
    """Retire les numeros de mesure auto-generes par verovio."""
    root = etree.fromstring(svg.encode())
    for g in list(root.iter(SVG_NS + "g")):
        if "mNum" in (g.get("class") or ""):
            g.getparent().remove(g)
    return etree.tostring(root).decode()


def musicxml_head(clef, per_measure):
    """Squelette MusicXML d'une portee nue, sans chiffrage apparent."""
    root = etree.Element("score-partwise", version="3.1")
    de.sub(de.sub(de.sub(root, "part-list"), "score-part", id="P1"), "part-name", "")
    part = de.sub(root, "part", id="P1")
    return root, part


def attributes(measure, clef, beats):
    a = de.sub(measure, "attributes")
    de.sub(a, "divisions", 1)
    de.sub(de.sub(a, "key"), "fifths", 0)
    t = de.sub(a, "time", **{"print-object": "no"})
    de.sub(t, "beats", beats)
    de.sub(t, "beat-type", 4)
    c = de.sub(a, "clef")
    de.sub(c, "sign", "F" if clef == "F" else "G")
    de.sub(c, "line", 4 if clef == "F" else 2)


def whole_note(measure, concert, tpc, octave_up, lyric1, lyric2):
    written = concert + 2 + (12 if octave_up else 0)
    step, alter = de.tpc_to_step_alter(tpc)
    n = de.sub(measure, "note")
    p = de.sub(n, "pitch")
    de.sub(p, "step", step)
    if alter:
        de.sub(p, "alter", alter)
    de.sub(p, "octave", de.octave_for(written, step, alter))
    de.sub(n, "duration", 4)
    de.sub(n, "type", "whole")
    if alter:
        de.sub(n, "accidental", de.ACC_NAME[alter])
    for no, txt in ((1, lyric1), (2, lyric2)):
        ly = de.sub(n, "lyric", number=no)
        de.sub(ly, "syllabic", "single")
        de.sub(ly, "text", txt)


def serialize(root):
    return etree.tostring(
        root, xml_declaration=True, encoding="UTF-8",
        doctype='<!DOCTYPE score-partwise PUBLIC '
                '"-//Recordare//DTD MusicXML 3.1 Partwise//EN" '
                '"http://www.musicxml.org/dtds/partwise.dtd">')


def engrave_to_pdf_page(xml_bytes, opts, tmpname, width):
    """Grave un extrait avec verovio et renvoie une page PDF (pypdf)."""
    import cairosvg
    from pypdf import PdfReader
    svgs = de.engrave(xml_bytes, opts, tmpname)
    buf = io.BytesIO()
    cairosvg.svg2pdf(bytestring=strip_measure_numbers(svgs[0]).encode(),
                     write_to=buf, output_width=width)
    buf.seek(0)
    return PdfReader(buf).pages[0]
