#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
doigtes_euphonium.py
====================
Ajoute automatiquement les doigtes (et les noms de notes) sur une partition
MuseScore, pour euphonium / saxhorn basse / trompette / bugle en Si bemol.

Produit :
  - un PDF pret a imprimer (page de reference + la partie seule)
  - un .mscz ne contenant que ta partie, avec les doigtes, editable dans MuseScore

Installation :
    pip install lxml verovio cairosvg reportlab pypdf

Utilisation :
    # 1. voir quelles parties contient le fichier
    python3 doigtes_euphonium.py partition.mscz --lister

    # 2. generer (partie n 4, clef de fa telle qu'ecrite)
    python3 doigtes_euphonium.py partition.mscz --partie 4

    # 3. la meme chose en clef de sol (lecture Si b habituelle en fanfare)
    python3 doigtes_euphonium.py partition.mscz --partie 4 --cle sol

Options utiles :
    --pistons 4      instrument a 4 pistons (compense) : le 4e remplace 1-3
    --sans-noms      n'ecrit que les doigtes, sans le nom des notes
    --sortie DOSSIER dossier de destination (defaut : a cote du fichier source)
"""

import argparse
import io
import os
import re
import shutil
import sys
import tempfile
import zipfile

from lxml import etree

# ---------------------------------------------------------------------------
# 1. Doigtes
# ---------------------------------------------------------------------------
# Harmoniques utilisables du tube a vide, en hauteurs REELLES (MIDI).
# Fondamentale Si b 1 = 34. On saute les 7e et 11e harmoniques, trop faux.
PARTIALS = [46, 53, 58, 62, 65, 70, 72, 74, 77]

COMBOS_3 = {0: "0", 1: "2", 2: "1", 3: "1-2", 4: "2-3", 5: "1-3", 6: "1-2-3"}
COMBOS_4 = {0: "0", 1: "2", 2: "1", 3: "1-2", 4: "2-3", 5: "4", 6: "2-4",
            7: "1-4", 8: "1-2-4", 9: "2-3-4", 10: "1-3-4", 11: "1-2-3-4"}


def fingering(concert_pitch, valves=3):
    """Doigte d'une note, a partir de sa hauteur reelle (MIDI).

    Principe : on cherche l'harmonique juste au-dessus de la note, puis les
    pistons qui font descendre de l'ecart restant. On prend l'harmonique le
    plus proche, ce qui donne le doigte le plus court (donc le plus juste).
    """
    table = COMBOS_3 if valves == 3 else COMBOS_4
    best = None
    for p in PARTIALS:
        d = p - concert_pitch
        if d in table and (best is None or d < best):
            best = d
    return table[best] if best is not None else "?"


# --- noms de notes ---------------------------------------------------------
LETTERS = "FCGDAEB"                     # ordre des "tpc" MuseScore (quintes)
FR = {"C": "Do", "D": "Re", "E": "Mi", "F": "Fa", "G": "Sol", "A": "La", "B": "Si"}
ALTER_FR = {-2: "bb", -1: "b", 0: "", 1: "#", 2: "##"}
NATURAL_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def tpc_to_step_alter(tpc):
    return LETTERS[(tpc - 13) % 7], (tpc - 13) // 7


def octave_for(written_pitch, step, alter):
    return (written_pitch - alter - NATURAL_PC[step]) // 12 - 1


def note_name_fr(tpc):
    step, alter = tpc_to_step_alter(tpc)
    return FR[step] + ALTER_FR[alter]


# ---------------------------------------------------------------------------
# 2. Lecture du fichier MuseScore
# ---------------------------------------------------------------------------
def unpack(mscz_path):
    """Decompresse un .mscz dans un dossier temporaire, renvoie (dossier, mscx)."""
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(mscz_path) as z:
        z.extractall(tmp)
    mscx = [f for f in os.listdir(tmp) if f.endswith(".mscx")][0]
    return tmp, os.path.join(tmp, mscx)


def list_parts(mscx):
    score = etree.parse(mscx).getroot().find("Score")
    rows = []
    for i, (part, staff) in enumerate(zip(score.findall("Part"),
                                          score.findall("Staff")), start=1):
        ins = part.find("Instrument")
        pitches = [int(n.findtext("pitch")) for n in staff.iter("Note")]
        rows.append({
            "n": i,
            "nom": part.findtext("trackName") or ins.findtext("longName") or "?",
            "affiche": ins.findtext("longName") or "",
            "transposition": int(ins.findtext("transposeChromatic") or 0),
            "cle": ins.findtext("clef") or part.find("Staff").findtext("defaultClef") or "G",
            "notes": len(pitches),
            "ambitus": (min(pitches), max(pitches)) if pitches else None,
        })
    return rows


def distinct_notes(mscx, staff_index):
    st = etree.parse(mscx).getroot().find("Score").findall("Staff")[staff_index]
    seen = {}
    for n in st.iter("Note"):
        key = (int(n.findtext("pitch")), int(n.findtext("tpc2", n.findtext("tpc"))))
        seen[key] = seen.get(key, 0) + 1
    return sorted(seen.items())


def score_title(mscx):
    root = etree.parse(mscx).getroot().find("Score")
    for t in root.iter("Text"):
        if t.findtext("style") == "title":
            return (t.findtext("text") or "").strip()
    for m in root.findall("metaTag"):
        if m.get("name") == "workTitle":
            return (m.text or "").strip()
    return ""


# ---------------------------------------------------------------------------
# 3. Export MusicXML (une seule partie, avec doigtes en "paroles")
# ---------------------------------------------------------------------------
DIV = 480
TYPE_DUR = {"whole": 4 * DIV, "half": 2 * DIV, "quarter": DIV, "eighth": DIV // 2,
            "16th": DIV // 4, "32nd": DIV // 8, "64th": DIV // 16}
XML_TYPE = {k: k for k in TYPE_DUR}
ARTIC = {"articStaccatoAbove": "staccato", "articStaccatoBelow": "staccato",
         "articAccentAbove": "accent", "articAccentBelow": "accent",
         "articTenutoAbove": "tenuto", "articTenutoBelow": "tenuto",
         "articMarcatoAbove": "strong-accent", "articMarcatoBelow": "strong-accent"}
ACC_NAME = {-2: "flat-flat", -1: "flat", 0: "natural", 1: "sharp", 2: "sharp-sharp"}


def sub(parent, tag, text=None, **attrs):
    e = etree.SubElement(parent, tag,
                         {k.replace("_", "-"): str(v) for k, v in attrs.items()})
    if text is not None:
        e.text = str(text)
    return e


def _dur_and_dots(el):
    dt = el.findtext("durationType")
    dots = int(el.findtext("dots", "0") or 0)
    base = TYPE_DUR.get(dt, DIV)
    dur, add = base, base
    for _ in range(dots):
        add //= 2
        dur += add
    return dt, dots, dur


def to_musicxml(mscx, staff_index, clef="F", octave_up=False, valves=3,
                show_names=True, part_name="Euphonium", title="", tempo_bpm=None):
    score = etree.parse(mscx).getroot().find("Score")
    staff = score.findall("Staff")[staff_index]

    root = etree.Element("score-partwise", version="3.1")
    sub(sub(root, "work"), "work-title", title)
    sub(sub(sub(root, "identification"), "encoding"), "software", "doigtes_euphonium")
    sp = sub(sub(root, "part-list"), "score-part", id="P1")
    sub(sp, "part-name", part_name)
    part = sub(root, "part", id="P1")

    first = True
    for mi, meas in enumerate(staff.findall("Measure"), start=1):
        m = sub(part, "measure", number=mi)
        voice = meas.find("voice")

        if first:
            a = sub(m, "attributes")
            sub(a, "divisions", DIV)
            ks = voice.find("KeySig") if voice is not None else None
            fifths = int(ks.findtext("actualKey", ks.findtext("concertKey", "0"))) if ks is not None else 0
            sub(sub(a, "key"), "fifths", fifths)
            ts = voice.find("TimeSig") if voice is not None else None
            t = sub(a, "time")
            sub(t, "beats", ts.findtext("sigN") if ts is not None else 4)
            sub(t, "beat-type", ts.findtext("sigD") if ts is not None else 4)
            c = sub(a, "clef")
            sub(c, "sign", "F" if clef == "F" else "G")
            sub(c, "line", 4 if clef == "F" else 2)
            tr = sub(a, "transpose")
            sub(tr, "diatonic", -1)
            sub(tr, "chromatic", -2)
            if octave_up:
                sub(tr, "octave-change", -1)
            if tempo_bpm:
                d = sub(m, "direction", placement="above")
                sub(sub(d, "direction-type"), "words", "Noire = %s" % tempo_bpm)
                sub(d, "sound", tempo=tempo_bpm)
            first = False

        if voice is None:
            continue

        for el in voice:
            if el.tag == "Dynamic":
                d = sub(m, "direction", placement="below")
                sub(sub(sub(d, "direction-type"), "dynamics"),
                    el.findtext("subtype", "mf"))

            elif el.tag == "StaffText":
                txt = "".join(el.find("text").itertext()) if el.find("text") is not None else ""
                if txt.strip():
                    d = sub(m, "direction", placement="above")
                    sub(sub(d, "direction-type"), "words", txt.strip())

            elif el.tag == "Rest":
                dt, dots, dur = _dur_and_dots(el)
                n = sub(m, "note")
                if dt == "measure":
                    sub(n, "rest", measure="yes")
                    sub(n, "duration", 4 * DIV)
                else:
                    sub(n, "rest")
                    sub(n, "duration", dur)
                    sub(n, "type", XML_TYPE.get(dt, "quarter"))
                    for _ in range(dots):
                        sub(n, "dot")

            elif el.tag == "Chord":
                dt, dots, dur = _dur_and_dots(el)
                arts = [ARTIC.get(a.findtext("subtype")) for a in el.findall("Articulation")]
                arts = [a for a in arts if a]
                for ni, nd in enumerate(el.findall("Note")):
                    concert = int(nd.findtext("pitch"))
                    tpc2 = int(nd.findtext("tpc2", nd.findtext("tpc")))
                    written = concert + 2 + (12 if octave_up else 0)
                    step, alter = tpc_to_step_alter(tpc2)
                    n = sub(m, "note")
                    if ni:
                        sub(n, "chord")
                    p = sub(n, "pitch")
                    sub(p, "step", step)
                    if alter:
                        sub(p, "alter", alter)
                    sub(p, "octave", octave_for(written, step, alter))
                    sub(n, "duration", dur)
                    sub(n, "type", XML_TYPE.get(dt, "quarter"))
                    for _ in range(dots):
                        sub(n, "dot")
                    if nd.find("Accidental") is not None:
                        sub(n, "accidental", ACC_NAME[alter])
                    if arts:
                        aa = sub(sub(n, "notations"), "articulations")
                        for a in arts:
                            sub(aa, a)
                    if ni == 0:
                        ly = sub(n, "lyric", number=1)
                        sub(ly, "syllabic", "single")
                        sub(ly, "text", fingering(concert, valves))
                        if show_names:
                            ly2 = sub(n, "lyric", number=2)
                            sub(ly2, "syllabic", "single")
                            sub(ly2, "text", note_name_fr(tpc2))

    return etree.tostring(
        root, pretty_print=True, xml_declaration=True, encoding="UTF-8",
        doctype='<!DOCTYPE score-partwise PUBLIC '
                '"-//Recordare//DTD MusicXML 3.1 Partwise//EN" '
                '"http://www.musicxml.org/dtds/partwise.dtd">')


# ---------------------------------------------------------------------------
# 4. Gravure (verovio) + mise en forme
# ---------------------------------------------------------------------------
SVG_NS = "http://www.w3.org/2000/svg"
ONLY_DIGITS = re.compile(r"^[0-9\-]+$")

PAGE_OPTS = {
    "pageWidth": 2100, "pageHeight": 2970,          # A4, en 1/10 de mm
    "pageMarginTop": 100, "pageMarginBottom": 100,
    "pageMarginLeft": 100, "pageMarginRight": 100,
    "scale": 38, "adjustPageHeight": False,
    "mnumInterval": 1, "breaks": "auto",
    "lyricSize": 4.0, "spacingStaff": 20, "spacingSystem": 10,
    "footer": "none", "font": "Leipzig",
}


def style_svg(svg_text):
    """Doigtes en gras noir, noms de notes en gris italique."""
    root = etree.fromstring(svg_text.encode())
    for g in root.iter("{%s}g" % SVG_NS):
        if g.get("class") != "verse":
            continue
        for tspan in g.iter("{%s}tspan" % SVG_NS):
            if tspan.get("font-size") is None:
                continue
            txt = "".join(tspan.itertext()).strip()
            if not txt:
                continue
            if ONLY_DIGITS.match(txt):
                tspan.set("font-weight", "bold")
            else:
                tspan.set("fill", "#808080")
                tspan.set("font-style", "italic")
    return etree.tostring(root).decode()


def engrave(musicxml_bytes, opts, tmpname):
    import verovio
    open(tmpname, "wb").write(musicxml_bytes)
    tk = verovio.toolkit()
    tk.setOptions(opts)
    if not tk.loadFile(tmpname):
        raise RuntimeError("verovio n'a pas pu lire le MusicXML")
    return [style_svg(tk.renderToSVG(p)) for p in range(1, tk.getPageCount() + 1)]


def svgs_to_pdf_pages(svgs, width=595, height=842):
    import cairosvg
    from pypdf import PdfReader
    pages = []
    for svg in svgs:
        buf = io.BytesIO()
        cairosvg.svg2pdf(bytestring=svg.encode(), write_to=buf,
                         output_width=width, output_height=height)
        buf.seek(0)
        pages.extend(PdfReader(buf).pages)
    return pages


# ---------------------------------------------------------------------------
# 5. Page de reference (les notes du morceau + leur doigte)
# ---------------------------------------------------------------------------
def _register_fonts():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    for name, fn in (("DJ", "DejaVuSans.ttf"), ("DJ-B", "DejaVuSans-Bold.ttf")):
        for d in ("/usr/share/fonts/truetype/dejavu/",
                  "/Library/Fonts/", "C:/Windows/Fonts/"):
            if os.path.exists(d + fn):
                pdfmetrics.registerFont(TTFont(name, d + fn))
                break
        else:
            return "Helvetica", "Helvetica-Bold"
    return "DJ", "DJ-B"


def chart_musicxml(notes, clef, octave_up, valves):
    root = etree.Element("score-partwise", version="3.1")
    sub(sub(sub(root, "part-list"), "score-part", id="P1"), "part-name", "")
    part = sub(root, "part", id="P1")
    m = sub(part, "measure", number=1)
    a = sub(m, "attributes")
    sub(a, "divisions", 1)
    sub(sub(a, "key"), "fifths", 0)
    t = sub(a, "time", **{"print-object": "no"})
    sub(t, "beats", 4 * max(len(notes), 1))
    sub(t, "beat-type", 4)
    c = sub(a, "clef")
    sub(c, "sign", "F" if clef == "F" else "G")
    sub(c, "line", 4 if clef == "F" else 2)
    for (concert, tpc2), _ in notes:
        written = concert + 2 + (12 if octave_up else 0)
        step, alter = tpc_to_step_alter(tpc2)
        n = sub(m, "note")
        p = sub(n, "pitch")
        sub(p, "step", step)
        if alter:
            sub(p, "alter", alter)
        sub(p, "octave", octave_for(written, step, alter))
        sub(n, "duration", 4)
        sub(n, "type", "whole")
        if alter:
            sub(n, "accidental", ACC_NAME[alter])
        ly = sub(n, "lyric", number=1)
        sub(ly, "syllabic", "single")
        sub(ly, "text", fingering(concert, valves))
        ly2 = sub(n, "lyric", number=2)
        sub(ly2, "syllabic", "single")
        sub(ly2, "text", note_name_fr(tpc2))
    sub(sub(m, "barline", location="right"), "bar-style", "light-heavy")
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8",
                          doctype='<!DOCTYPE score-partwise PUBLIC '
                                  '"-//Recordare//DTD MusicXML 3.1 Partwise//EN" '
                                  '"http://www.musicxml.org/dtds/partwise.dtd">')


def reference_page(notes, clef, octave_up, valves, clef_label, workdir):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from pypdf import PdfReader, Transformation
    import cairosvg

    reg, bold = _register_fonts()
    W, H = A4

    opts = {"pageWidth": 2400, "pageHeight": 1400, "scale": 48,
            "adjustPageHeight": True, "header": "none", "footer": "none",
            "lyricSize": 5.5, "spacingStaff": 26, "spacingSystem": 18,
            "pageMarginTop": 20, "pageMarginLeft": 20, "pageMarginRight": 20,
            "mnumInterval": 0, "font": "Leipzig"}
    svgs = engrave(chart_musicxml(notes, clef, octave_up, valves), opts,
                   os.path.join(workdir, "_chart.musicxml"))
    buf = io.BytesIO()
    cairosvg.svg2pdf(bytestring=svgs[0].encode(), write_to=buf, output_width=480)
    buf.seek(0)
    chart = PdfReader(buf).pages[0]
    ch = float(chart.mediabox.height)

    txt = io.BytesIO()
    c = canvas.Canvas(txt, pagesize=A4)
    y = H - 55
    c.setFont(bold, 15)
    c.drawCentredString(W / 2, y, "Doigt\u00e9s \u2014 euphonium / saxhorn basse en Si\u266d")
    y -= 22
    c.setFont(reg, 10.5)
    c.drawCentredString(W / 2, y, "Les %d notes de ce morceau (%s)" % (len(notes), clef_label))
    y -= 30
    c.setFont(reg, 9.5)
    for l in ["Comment lire : le chiffre en gras sous la note = les pistons \u00e0 enfoncer.",
              "0 = aucun piston (\u00e0 vide).  1 = piston 1 (le plus pr\u00e8s de toi).  1-3 = pistons 1 et 3 ensemble.",
              "Le nom en gris italique sous le chiffre = le nom de la note telle qu'elle est \u00e9crite."]:
        c.drawString(60, y, l)
        y -= 15

    yy = H - 192 - ch
    c.setFont(bold, 10.5)
    c.drawString(60, yy, "\u00c0 retenir")
    yy -= 18
    c.setFont(reg, 9.5)
    for l in ["M\u00eame nom de note, octave diff\u00e9rente = doigt\u00e9 parfois diff\u00e9rent.",
              "Si ton instrument a un 4e piston (compens\u00e9), tu peux remplacer 1-3 par 4 : c'est plus juste.",
              "Ces doigt\u00e9s valent aussi pour la trompette et le bugle : c'est le m\u00eame syst\u00e8me en Si\u266d."]:
        c.drawString(60, yy, l)
        yy -= 15
    c.save()
    txt.seek(0)

    page = PdfReader(txt).pages[0]
    page.merge_transformed_page(chart, Transformation().translate(62, H - 168 - ch))
    return page


# ---------------------------------------------------------------------------
# 6. Export .mscz (une seule partie, doigtes inclus)
# ---------------------------------------------------------------------------
def to_mscz(src_mscz, staff_index, out_mscz, valves=3, part_long_name=None):
    tmp, path = unpack(src_mscz)
    tree = etree.parse(path)
    score = tree.getroot().find("Score")
    parts, staves = score.findall("Part"), score.findall("Staff")
    keep_part, keep_staff = parts[staff_index], staves[staff_index]

    vbox = staves[0].find("VBox")                       # cadre du titre
    m1 = staves[0].find("Measure")
    tempo = m1.find("voice").find("Tempo") if (m1 is not None and m1.find("voice") is not None) else None

    for p in parts:
        if p is not keep_part:
            score.remove(p)
    for s in staves:
        if s is not keep_staff:
            score.remove(s)
    keep_part.find("Staff").attrib.pop("id", None)
    keep_staff.set("id", "1")
    for br in list(keep_part.iter("bracket")):
        br.getparent().remove(br)
    if part_long_name:
        e = keep_part.find("Instrument").find("longName")
        if e is not None:
            e.text = part_long_name

    if vbox is not None:
        keep_staff.insert(0, vbox)
    if tempo is not None:
        v = keep_staff.findall("Measure")[0].find("voice")
        idx = 0
        for i, ch in enumerate(v):
            if ch.tag in ("KeySig", "TimeSig"):
                idx = i + 1
        v.insert(idx, tempo)

    count = 0
    for note in keep_staff.iter("Note"):
        f = etree.SubElement(note, "Fingering")
        etree.SubElement(f, "text").text = fingering(int(note.findtext("pitch")), valves)
        count += 1

    tree.write(path, encoding="UTF-8", xml_declaration=True, pretty_print=True)

    cont = os.path.join(tmp, "META-INF", "container.xml")
    if os.path.exists(cont):
        ct = etree.parse(cont)
        for rf in list(ct.getroot().find("rootfiles")):
            if "thumbnail" in (rf.get("full-path") or ""):
                rf.getparent().remove(rf)
        ct.write(cont, encoding="UTF-8", xml_declaration=True)
    shutil.rmtree(os.path.join(tmp, "Thumbnails"), ignore_errors=True)

    with zipfile.ZipFile(out_mscz, "w", zipfile.ZIP_DEFLATED) as z:
        for root_, _, files in os.walk(tmp):
            for f in files:
                full = os.path.join(root_, f)
                z.write(full, os.path.relpath(full, tmp))
    shutil.rmtree(tmp)
    return out_mscz, count


# ---------------------------------------------------------------------------
# 7. Ligne de commande
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Ajoute les doigtes d'euphonium sur une partition MuseScore.")
    ap.add_argument("fichier", help="partition .mscz")
    ap.add_argument("--lister", action="store_true", help="afficher les parties disponibles")
    ap.add_argument("--partie", type=int, default=None, help="numero de la partie (voir --lister)")
    ap.add_argument("--cle", choices=["fa", "sol"], default="fa", help="clef de lecture (defaut : fa)")
    ap.add_argument("--pistons", type=int, choices=[3, 4], default=3)
    ap.add_argument("--sans-noms", dest="noms", action="store_false")
    ap.add_argument("--tempo", type=int, default=None, help="indication de tempo a afficher")
    ap.add_argument("--nom", default=None, help="nom affiche a gauche de la portee")
    ap.add_argument("--sortie", default=None)
    args = ap.parse_args()

    tmp, mscx = unpack(args.fichier)

    if args.lister or args.partie is None:
        print("\nParties du fichier :\n")
        for r in list_parts(mscx):
            amb = "%s-%s" % r["ambitus"] if r["ambitus"] else "-"
            print("  %d. %-28s  clef %-4s  transp %+d  %4d notes  (ambitus MIDI %s)"
                  % (r["n"], r["nom"], r["cle"], r["transposition"], r["notes"], amb))
        print("\nRelance avec --partie N\n")
        shutil.rmtree(tmp)
        return

    idx = args.partie - 1
    clef = "F" if args.cle == "fa" else "G"
    octave_up = (args.cle == "sol")
    title = score_title(mscx)
    base = os.path.splitext(os.path.basename(args.fichier))[0]
    outdir = args.sortie or os.path.dirname(os.path.abspath(args.fichier))
    os.makedirs(outdir, exist_ok=True)

    parts = list_parts(mscx)
    label = args.nom or parts[idx]["affiche"] or parts[idx]["nom"]
    label = label.replace("\u266d", "b").replace("\u266f", "#")   # glyphes absents des polices texte
    clef_label = ("cl\u00e9 de fa" if clef == "F" else "cl\u00e9 de sol, lecture Si\u266d")

    from pypdf import PdfWriter
    notes = distinct_notes(mscx, idx)
    writer = PdfWriter()
    writer.add_page(reference_page(notes, clef, octave_up, args.pistons, clef_label, tmp))
    part_name = ("%s \u2014 %s" % (label, clef_label)).replace("\u266d", "b").replace("\u266f", "#")
    xml = to_musicxml(mscx, idx, clef=clef, octave_up=octave_up, valves=args.pistons,
                      show_names=args.noms, part_name=part_name,
                      title=title, tempo_bpm=args.tempo)
    for pg in svgs_to_pdf_pages(engrave(xml, PAGE_OPTS, os.path.join(tmp, "_part.musicxml"))):
        writer.add_page(pg)
    pdf_path = os.path.join(outdir, "%s_doigtes_cle-de-%s.pdf" % (base, args.cle))
    with open(pdf_path, "wb") as f:
        writer.write(f)
    print("PDF   :", pdf_path)

    mscz_path = os.path.join(outdir, "%s_doigtes.mscz" % base)
    _, n = to_mscz(args.fichier, idx, mscz_path, valves=args.pistons, part_long_name=label)
    print("MSCZ  :", mscz_path, "(%d doigt\u00e9s)" % n)

    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
