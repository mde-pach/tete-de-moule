/**
 * Reader for MuseScore files (.mscz, and the raw .mscx inside them).
 *
 * The file is unzipped in the browser and parsed into a small neutral model.
 * MuseScore stores, for every note, both the sounding pitch (`pitch`) and its
 * concert spelling (`tpc`), which is what we want: fingerings and re-notation
 * are both derived from sounding pitch, never from how the part happens to be
 * written in the source file.
 *
 * Anything we cannot faithfully reproduce is recorded in `warnings` rather than
 * dropped in silence. A missing slur is cosmetic; a missing repeat changes the
 * shape of the piece, and the player would find out in rehearsal.
 */
import { unzipSync, strFromU8 } from "fflate";

export type UnsupportedFeature =
  | "jump"
  | "grace-note"
  | "extra-voice"
  | "clef-change"
  | "ornament"
  | "glissando"
  | "arpeggio";

export interface NoteEvent {
  readonly kind: "note";
  /** Sounding MIDI pitch. */
  readonly pitch: number;
  /** Concert tonal pitch class, MuseScore convention (13 = F, 14 = C, ...). */
  readonly tpc: number;
  readonly durationType: string;
  readonly dots: number;
  readonly chordIndex: number;
  readonly articulations: readonly string[];
  readonly hasAccidental: boolean;
  readonly tieStart: boolean;
  readonly tieStop: boolean;
  readonly slurStart: boolean;
  readonly slurStop: boolean;
  readonly tuplet: TupletContext | null;
  readonly tupletStart: boolean;
  readonly tupletStop: boolean;
}

export interface RestEvent {
  readonly kind: "rest";
  readonly durationType: string;
  readonly dots: number;
  readonly tuplet: TupletContext | null;
  readonly tupletStart: boolean;
  readonly tupletStop: boolean;
}

export interface DirectionEvent {
  readonly kind: "direction";
  readonly text: string;
  readonly placement: "above" | "below";
  readonly dynamic?: string;
}

export type MeasureEvent = NoteEvent | RestEvent | DirectionEvent;

export interface TupletContext {
  readonly actualNotes: number;
  readonly normalNotes: number;
  readonly baseNote: string;
}

export interface Measure {
  readonly number: number;
  readonly events: readonly MeasureEvent[];
  readonly startRepeat: boolean;
  readonly endRepeat: number | null;
  readonly voltaStart: string | null;
  readonly voltaStop: boolean;
  readonly keyFifths: number | null;
  readonly time: { beats: number; beatType: number } | null;
  /** Non-standard measure length, as a "n/d" fraction, for pickup bars. */
  readonly length: string | null;
}

export interface ScorePart {
  readonly index: number;
  readonly name: string;
  readonly displayName: string;
  readonly transposeChromatic: number;
  readonly sourceClef: string;
  readonly noteCount: number;
  readonly range: readonly [number, number] | null;
  readonly measures: readonly Measure[];
}

export interface ParsedScore {
  readonly title: string;
  readonly composer: string;
  readonly tempoBpm: number | null;
  readonly parts: readonly ScorePart[];
  readonly warnings: ReadonlySet<UnsupportedFeature>;
}

const DURATION_TYPES = new Set([
  "breve", "whole", "half", "quarter", "eighth",
  "16th", "32nd", "64th", "128th", "measure",
]);

function text(parent: Element | null, tag: string): string | null {
  if (!parent) return null;
  const child = parent.querySelector(`:scope > ${tag}`);
  return child ? (child.textContent ?? "").trim() : null;
}

function number(parent: Element | null, tag: string, fallback: number): number {
  const value = text(parent, tag);
  return value === null || value === "" ? fallback : Number(value);
}

/** Extracts the .mscx document out of a .mscz archive. */
export function extractMscx(archive: Uint8Array): string {
  const files = unzipSync(archive);
  const name = Object.keys(files).find(
    (path) => path.endsWith(".mscx") && !path.startsWith("META-INF/"),
  );
  if (!name) throw new Error("Aucune partition trouvée dans ce fichier.");
  return strFromU8(files[name]!);
}

export function parseScore(mscx: string): ParsedScore {
  const document = new DOMParser().parseFromString(mscx, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error("Ce fichier MuseScore est illisible.");
  }
  const score = document.querySelector("museScore > Score");
  if (!score) throw new Error("Ce fichier ne ressemble pas à une partition MuseScore.");

  const warnings = new Set<UnsupportedFeature>();
  const partElements = Array.from(score.querySelectorAll(":scope > Part"));
  const staffElements = Array.from(score.querySelectorAll(":scope > Staff"));

  const systemStaff = staffElements[0] ?? null;
  const tempoBpm = readTempo(systemStaff);
  const voltas = readVoltas(systemStaff);

  const parts = partElements.map((partElement, index) => {
    const staff = staffElements[index];
    const instrument = partElement.querySelector(":scope > Instrument");
    const measures = staff ? readMeasures(staff, voltas, warnings) : [];
    const pitches = measures
      .flatMap((measure) => measure.events)
      .filter((event): event is NoteEvent => event.kind === "note")
      .map((event) => event.pitch);
    return {
      index,
      name:
        text(partElement, "trackName") ??
        text(instrument, "longName") ??
        `Partie ${index + 1}`,
      displayName: text(instrument, "longName") ?? "",
      transposeChromatic: number(instrument, "transposeChromatic", 0),
      sourceClef:
        text(instrument, "clef") ??
        text(partElement.querySelector(":scope > Staff"), "defaultClef") ??
        "G",
      noteCount: pitches.length,
      range: pitches.length
        ? ([Math.min(...pitches), Math.max(...pitches)] as [number, number])
        : null,
      measures,
    } satisfies ScorePart;
  });

  return {
    title: readTitle(score),
    composer: readMetaTag(score, "composer"),
    tempoBpm,
    parts,
    warnings,
  };
}

function readMetaTag(score: Element, name: string): string {
  const tag = Array.from(score.querySelectorAll(":scope > metaTag")).find(
    (element) => element.getAttribute("name") === name,
  );
  return (tag?.textContent ?? "").trim();
}

function readTitle(score: Element): string {
  for (const element of Array.from(score.querySelectorAll("VBox > Text"))) {
    if (text(element, "style") === "title") {
      const value = (element.querySelector(":scope > text")?.textContent ?? "").trim();
      if (value) return value;
    }
  }
  return readMetaTag(score, "workTitle");
}

function readTempo(staff: Element | null): number | null {
  const tempo = staff?.querySelector("Tempo > tempo");
  if (!tempo) return null;
  // MuseScore stores quarter notes per second.
  const perSecond = Number(tempo.textContent);
  return Number.isFinite(perSecond) ? Math.round(perSecond * 60) : null;
}

/**
 * Voltas live on the first staff even though they apply to the whole system, so
 * they are read once and replayed onto whichever part the player picked.
 */
function readVoltas(staff: Element | null): Map<number, { start: string | null; stop: boolean }> {
  const result = new Map<number, { start: string | null; stop: boolean }>();
  if (!staff) return result;
  const measures = Array.from(staff.querySelectorAll(":scope > Measure"));
  measures.forEach((measure, index) => {
    for (const spanner of Array.from(measure.querySelectorAll("Spanner"))) {
      if (spanner.getAttribute("type") !== "Volta") continue;
      const volta = spanner.querySelector(":scope > Volta");
      if (volta) {
        const endings = text(volta, "endings") ?? "1";
        result.set(index, { ...(result.get(index) ?? { start: null, stop: false }), start: endings });
        const span = Number(text(spanner.querySelector(":scope > next > location"), "measures") ?? 0);
        const last = index + Math.max(span, 0);
        result.set(last, { ...(result.get(last) ?? { start: null, stop: false }), stop: true });
      }
    }
  });
  return result;
}

function readMeasures(
  staff: Element,
  voltas: Map<number, { start: string | null; stop: boolean }>,
  warnings: Set<UnsupportedFeature>,
): Measure[] {
  const measureElements = Array.from(staff.querySelectorAll(":scope > Measure"));

  return measureElements.map((measureElement, index) => {
    const voices = Array.from(measureElement.querySelectorAll(":scope > voice"));
    if (voices.length > 1) warnings.add("extra-voice");
    const voice = voices[0] ?? measureElement;

    const events: MeasureEvent[] = [];
    let tuplet: TupletContext | null = null;
    let tupletJustStarted = false;

    for (const element of Array.from(voice.children)) {
      switch (element.tagName) {
        case "Tuplet": {
          tuplet = {
            actualNotes: number(element, "actualNotes", 3),
            normalNotes: number(element, "normalNotes", 2),
            baseNote: text(element, "baseNote") ?? "eighth",
          };
          tupletJustStarted = true;
          break;
        }
        case "endTuplet": {
          const last = events[events.length - 1];
          if (last && (last.kind === "note" || last.kind === "rest")) {
            (last as { tupletStop: boolean }).tupletStop = true;
          }
          tuplet = null;
          break;
        }
        case "Dynamic": {
          events.push({
            kind: "direction",
            text: "",
            placement: "below",
            dynamic: text(element, "subtype") ?? "mf",
          });
          break;
        }
        case "StaffText":
        case "RehearsalMark": {
          const value = (element.querySelector(":scope > text")?.textContent ?? "").trim();
          if (value) events.push({ kind: "direction", text: value, placement: "above" });
          break;
        }
        case "Jump":
        case "Marker": {
          warnings.add("jump");
          break;
        }
        case "Clef": {
          warnings.add("clef-change");
          break;
        }
        case "Rest": {
          const durationType = text(element, "durationType") ?? "quarter";
          events.push({
            kind: "rest",
            durationType: DURATION_TYPES.has(durationType) ? durationType : "quarter",
            dots: number(element, "dots", 0),
            tuplet,
            tupletStart: tupletJustStarted,
            tupletStop: false,
          });
          tupletJustStarted = false;
          break;
        }
        case "Chord": {
          const durationType = text(element, "durationType") ?? "quarter";
          const dots = number(element, "dots", 0);
          const articulations = Array.from(
            element.querySelectorAll(":scope > Articulation"),
          )
            .map((articulation) => text(articulation, "subtype") ?? "")
            .filter(Boolean);
          if (element.querySelector(":scope > Arpeggio")) warnings.add("arpeggio");
          if (element.querySelector(":scope > Glissando")) warnings.add("glissando");
          if (element.querySelector(":scope > Ornament, :scope > Trill")) warnings.add("ornament");

          const slurStart = hasSpanner(element, "Slur", "next");
          const slurStop = hasSpanner(element, "Slur", "prev");

          const notes = Array.from(element.querySelectorAll(":scope > Note"));
          notes.forEach((noteElement, chordIndex) => {
            events.push({
              kind: "note",
              pitch: number(noteElement, "pitch", 60),
              tpc: number(noteElement, "tpc", 14),
              durationType: DURATION_TYPES.has(durationType) ? durationType : "quarter",
              dots,
              chordIndex,
              articulations,
              hasAccidental: noteElement.querySelector(":scope > Accidental") !== null,
              tieStart: hasSpanner(noteElement, "Tie", "next"),
              tieStop: hasSpanner(noteElement, "Tie", "prev"),
              slurStart: chordIndex === 0 && slurStart,
              slurStop: chordIndex === 0 && slurStop,
              tuplet,
              tupletStart: chordIndex === 0 && tupletJustStarted,
              tupletStop: false,
            });
          });
          if (element.querySelector(":scope > Grace, :scope > appoggiatura")) {
            warnings.add("grace-note");
          }
          tupletJustStarted = false;
          break;
        }
        default:
          break;
      }
    }

    const keySig = voice.querySelector(":scope > KeySig");
    const timeSig = voice.querySelector(":scope > TimeSig");
    const volta = voltas.get(index);

    return {
      number: index + 1,
      events,
      startRepeat: measureElement.querySelector(":scope > startRepeat") !== null,
      endRepeat: measureElement.querySelector(":scope > endRepeat")
        ? number(measureElement, "endRepeat", 2)
        : null,
      voltaStart: volta?.start ?? null,
      voltaStop: volta?.stop ?? false,
      keyFifths: keySig ? number(keySig, "concertKey", 0) : null,
      time: timeSig
        ? { beats: number(timeSig, "sigN", 4), beatType: number(timeSig, "sigD", 4) }
        : null,
      length: measureElement.getAttribute("len"),
    } satisfies Measure;
  });
}

function hasSpanner(parent: Element, type: string, direction: "next" | "prev"): boolean {
  return Array.from(parent.querySelectorAll(":scope > Spanner")).some(
    (spanner) =>
      spanner.getAttribute("type") === type &&
      spanner.querySelector(`:scope > ${direction}`) !== null,
  );
}
