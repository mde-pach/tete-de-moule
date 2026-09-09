/**
 * Rewrites one part of a parsed MuseScore score as MusicXML, in the clef and
 * transposition the player reads, with fingerings and note names attached.
 *
 * Fingerings and note names ride along as lyric verses: verse 1 is the valve
 * combination, verse 2 the French note name. Engravers place lyrics under the
 * staff, aligned with each note, which is exactly where a player wants them.
 */
import { fingeringFor } from "./fingering.ts";
import {
  fifthsShift,
  writtenPitch,
  type Instrument,
  type Reading,
} from "./instruments.ts";
import type { Measure, NoteEvent, ScorePart } from "./musescore.ts";

const DIVISIONS = 480;

const DURATION_TICKS: Record<string, number> = {
  breve: 8 * DIVISIONS,
  whole: 4 * DIVISIONS,
  half: 2 * DIVISIONS,
  quarter: DIVISIONS,
  eighth: DIVISIONS / 2,
  "16th": DIVISIONS / 4,
  "32nd": DIVISIONS / 8,
  "64th": DIVISIONS / 16,
  "128th": DIVISIONS / 32,
};

const ARTICULATION_NAMES: Record<string, string> = {
  articStaccatoAbove: "staccato",
  articStaccatoBelow: "staccato",
  articAccentAbove: "accent",
  articAccentBelow: "accent",
  articTenutoAbove: "tenuto",
  articTenutoBelow: "tenuto",
  articMarcatoAbove: "strong-accent",
  articMarcatoBelow: "strong-accent",
  articStaccatissimoAbove: "staccatissimo",
  articStaccatissimoBelow: "staccatissimo",
};

const ACCIDENTAL_NAMES: Record<number, string> = {
  [-2]: "flat-flat",
  [-1]: "flat",
  0: "natural",
  1: "sharp",
  2: "sharp-sharp",
};

/** Circle-of-fifths letter order used by MuseScore tonal pitch classes. */
const LETTERS = "FCGDAEB";
const NATURAL_PITCH_CLASS: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};
const FRENCH_NAMES: Record<string, string> = {
  C: "Do", D: "Ré", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si",
};
const FRENCH_ACCIDENTALS: Record<number, string> = {
  [-2]: "♭♭", [-1]: "♭", 0: "", 1: "♯", 2: "♯♯",
};

export interface Spelling {
  readonly step: string;
  readonly alter: number;
  readonly octave: number;
}

export function spell(tpc: number, pitch: number): Spelling {
  const step = LETTERS[((((tpc - 13) % 7) + 7) % 7)]!;
  const alter = Math.floor((tpc - 13) / 7);
  const octave = Math.floor((pitch - alter - NATURAL_PITCH_CLASS[step]!) / 12) - 1;
  return { step, alter, octave };
}

export function frenchNoteName(tpc: number): string {
  const step = LETTERS[((((tpc - 13) % 7) + 7) % 7)]!;
  const alter = Math.floor((tpc - 13) / 7);
  return FRENCH_NAMES[step]! + (FRENCH_ACCIDENTALS[alter] ?? "");
}

/**
 * Below this many consecutive empty bars, a rest is left as it is: a lone
 * bar marked "1" reads worse than a plain whole rest.
 */
const MIN_MULTI_REST = 2;

function isSilent(measure: Measure): boolean {
  let restCount = 0;
  for (const event of measure.events) {
    if (event.kind === "note") return false;
    if (event.kind === "direction") return false;
    if (event.durationType !== "measure") return false;
    restCount += 1;
  }
  return restCount === 1;
}

/**
 * Groups runs of empty bars so the engraver can collapse them into a single
 * barred rest topped with a count, the way a printed part does. Without this a
 * player turns pages through bars that hold nothing, and the bar numbers stop
 * matching everyone else's part.
 *
 * A run stops at anything that must stay visible on its own bar: a key or time
 * change, a repeat sign, a volta, or a direction such as a rehearsal cue —
 * engravers drop the text of a bar swallowed by a multi-rest.
 *
 * Returns, for the first bar of each run, how many bars it covers.
 */
export function multiRestRuns(
  measures: readonly Measure[],
): ReadonlyMap<number, number> {
  const runs = new Map<number, number>();
  let start: number | null = null;

  const flush = (end: number): void => {
    if (start === null) return;
    const length = end - start;
    if (length >= MIN_MULTI_REST) runs.set(start, length);
    start = null;
  };

  measures.forEach((measure, index) => {
    // The opening bar is never absorbed: it carries the clef, the key and the
    // tempo mark, and an engraver drops whatever sits on a bar it swallows.
    if (index === 0) return;

    const breaksBefore =
      measure.keyFifths !== null ||
      measure.time !== null ||
      measure.length !== null ||
      measure.startRepeat ||
      measure.voltaStart !== null;
    if (breaksBefore) flush(index);

    if (!isSilent(measure)) {
      flush(index);
      return;
    }

    if (start === null) start = index;

    if (measure.endRepeat !== null || measure.voltaStop) flush(index + 1);
  });
  flush(measures.length);
  return runs;
}

/** Number of flags a note carries; 0 means it is never beamed. */
const FLAG_COUNT: Record<string, number> = {
  eighth: 1, "16th": 2, "32nd": 3, "64th": 4, "128th": 5,
};

interface BeamMark {
  readonly number: number;
  readonly type: string;
}

type TimeSignature = { beats: number; beatType: number };

/**
 * How wide a beam group may be, in ticks.
 *
 * Read off the band's own engraved parts: in 4/4, plain quavers beam across
 * two beats, but as soon as a semiquaver joins the run the grouping tightens
 * to the beat — which is why a dotted quaver plus semiquaver beams on its own
 * and the next quaver starts a fresh group. Compound metres group by the
 * dotted beat.
 */
function beamGroupTicks(time: TimeSignature, hasShortNotes: boolean): number {
  const beatTicks = (DIVISIONS * 4) / time.beatType;
  if (time.beatType === 8 && time.beats % 3 === 0) return 3 * beatTicks;
  if (!hasShortNotes && time.beats % 2 === 0) return 2 * beatTicks;
  return beatTicks;
}

/**
 * MuseScore stores beaming implicitly — it applies the metre's default rules
 * and only records exceptions — but MusicXML needs every beam spelled out.
 * Without this, engravers fall back to one flag per note and a run of quavers
 * reads as a stack of isolated notes.
 *
 * Returns the beam elements to attach to each event, by event index.
 */
function beamsFor(
  measure: Measure,
  time: TimeSignature,
): ReadonlyMap<number, readonly BeamMark[]> {
  interface Slot { index: number; tick: number; flags: number }

  const slots: Slot[] = [];
  let tick = 0;
  measure.events.forEach((event, index) => {
    if (event.kind === "direction") return;
    // Chord tones share the stem of the first note, which carries the beam.
    if (event.kind === "note" && event.chordIndex > 0) return;
    const flags = event.kind === "note" ? (FLAG_COUNT[event.durationType] ?? 0) : 0;
    slots.push({ index, tick, flags });
    tick += event.durationType === "measure"
      ? measureTicks(time)
      : ticksOf(event.durationType, event.dots, event.tuplet);
  });

  const marks = new Map<number, BeamMark[]>();

  const writeGroup = (group: Slot[]): void => {
    if (group.length < 2) return;
    group.forEach((slot, position) => {
      const list: BeamMark[] = [];
      for (let level = 1; level <= slot.flags; level += 1) {
        const previous = position > 0 && group[position - 1]!.flags >= level;
        const next = position < group.length - 1 && group[position + 1]!.flags >= level;
        let type: string;
        if (previous && next) type = "continue";
        else if (next) type = "begin";
        else if (previous) type = "end";
        else type = position > 0 ? "backward hook" : "forward hook";
        list.push({ number: level, type });
      }
      if (list.length > 0) marks.set(slot.index, list);
    });
  };

  const writeRun = (run: Slot[]): void => {
    if (run.length === 0) return;
    const width = beamGroupTicks(time, run.some((slot) => slot.flags >= 2));
    let group: Slot[] = [];
    let boundary = Number.POSITIVE_INFINITY;
    for (const slot of run) {
      if (slot.tick >= boundary) {
        writeGroup(group);
        group = [];
      }
      if (group.length === 0) boundary = (Math.floor(slot.tick / width) + 1) * width;
      group.push(slot);
    }
    writeGroup(group);
  };

  let run: Slot[] = [];
  for (const slot of slots) {
    if (slot.flags === 0) {
      writeRun(run);
      run = [];
      continue;
    }
    run.push(slot);
  }
  writeRun(run);
  return marks;
}

export interface RewriteOptions {
  readonly part: ScorePart;
  readonly instrument: Instrument;
  readonly reading: Reading;
  readonly valveCount: number;
  readonly showFingerings: boolean;
  readonly showNoteNames: boolean;
  readonly title: string;
  readonly partLabel: string;
  readonly tempoBpm: number | null;
}

class XmlBuilder {
  private readonly chunks: string[] = [];

  open(tag: string, attributes: Record<string, string | number> = {}): this {
    const rendered = Object.entries(attributes)
      .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
      .join("");
    this.chunks.push(`<${tag}${rendered}>`);
    return this;
  }

  close(tag: string): this {
    this.chunks.push(`</${tag}>`);
    return this;
  }

  empty(tag: string, attributes: Record<string, string | number> = {}): this {
    const rendered = Object.entries(attributes)
      .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
      .join("");
    this.chunks.push(`<${tag}${rendered}/>`);
    return this;
  }

  leaf(tag: string, value: string | number, attributes: Record<string, string | number> = {}): this {
    return this.open(tag, attributes).text(String(value)).close(tag);
  }

  text(value: string): this {
    this.chunks.push(escapeXml(value));
    return this;
  }

  toString(): string {
    return this.chunks.join("");
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ticksOf(
  durationType: string,
  dots: number,
  tuplet: { actualNotes: number; normalNotes: number } | null,
): number {
  const base = DURATION_TICKS[durationType] ?? DIVISIONS;
  let total = base;
  let increment = base;
  for (let index = 0; index < dots; index += 1) {
    increment /= 2;
    total += increment;
  }
  if (tuplet) total = Math.round((total * tuplet.normalNotes) / tuplet.actualNotes);
  return total;
}

export function toMusicXml(options: RewriteOptions): string {
  const { part, instrument, reading, valveCount } = options;
  const shift = fifthsShift(reading.transpose);
  const xml = new XmlBuilder();

  xml.open("score-partwise", { version: "4.0" });
  // The reading belongs in the heading, not beside the staff: a part name on
  // the score-part indents the first system and pushes the music inwards.
  const heading = [options.title, options.partLabel].filter(Boolean).join(" — ");
  xml.leaf("movement-title", heading);
  xml.open("identification").open("encoding")
    .leaf("software", "Tête de Moule").close("encoding").close("identification");
  xml.open("part-list").open("score-part", { id: "P1" })
    .leaf("part-name", "").close("score-part").close("part-list");
  xml.open("part", { id: "P1" });

  const multiRests = multiRestRuns(part.measures);

  let time: TimeSignature = { beats: 4, beatType: 4 };
  let first = true;
  for (const [index, measure] of part.measures.entries()) {
    if (measure.time) time = measure.time;
    const beams = beamsFor(measure, time);
    xml.open("measure", { number: measure.number });

    const multiRest = multiRests.get(index) ?? null;
    const needsAttributes =
      first || measure.keyFifths !== null || measure.time !== null || multiRest !== null;
    if (needsAttributes) {
      xml.open("attributes");
      if (first) xml.leaf("divisions", DIVISIONS);
      if (first || measure.keyFifths !== null) {
        const concertFifths = measure.keyFifths ?? 0;
        xml.open("key").leaf("fifths", concertFifths + shift).close("key");
      }
      if (first || measure.time !== null) {
        xml.open("time").leaf("beats", time.beats).leaf("beat-type", time.beatType).close("time");
      }
      if (first) {
        xml.open("clef")
          .leaf("sign", reading.clef)
          .leaf("line", reading.clef === "F" ? 4 : 2)
          .close("clef");
        xml.open("transpose")
          .leaf("diatonic", reading.transpose.diatonic)
          .leaf("chromatic", reading.transpose.chromatic);
        if (reading.transpose.octaveChange !== 0) {
          xml.leaf("octave-change", reading.transpose.octaveChange);
        }
        xml.close("transpose");
      }
      // measure-style comes last inside attributes, per the MusicXML schema.
      if (multiRest !== null) {
        xml.open("measure-style")
          .leaf("multiple-rest", multiRest)
          .close("measure-style");
      }
      xml.close("attributes");
    }

    if (measure.startRepeat || measure.voltaStart) {
      xml.open("barline", { location: "left" });
      if (measure.voltaStart) {
        xml.empty("ending", { number: measure.voltaStart, type: "start" });
      }
      if (measure.startRepeat) {
        xml.leaf("bar-style", "heavy-light");
        xml.empty("repeat", { direction: "forward" });
      }
      xml.close("barline");
    }

    if (first && options.tempoBpm) {
      xml.open("direction", { placement: "above" })
        .open("direction-type").open("metronome")
        .leaf("beat-unit", "quarter").leaf("per-minute", options.tempoBpm)
        .close("metronome").close("direction-type")
        .empty("sound", { tempo: options.tempoBpm })
        .close("direction");
    }
    first = false;

    for (const [eventIndex, event] of measure.events.entries()) {
      if (event.kind === "direction") {
        xml.open("direction", { placement: event.placement }).open("direction-type");
        if (event.dynamic) {
          xml.open("dynamics").empty(event.dynamic).close("dynamics");
        } else {
          xml.leaf("words", event.text);
        }
        xml.close("direction-type").close("direction");
        continue;
      }

      if (event.kind === "rest") {
        const ticks = ticksOf(event.durationType, event.dots, event.tuplet);
        xml.open("note");
        if (event.durationType === "measure") {
          xml.empty("rest", { measure: "yes" });
          xml.leaf("duration", measureTicks(time));
        } else {
          xml.empty("rest");
          xml.leaf("duration", ticks);
          xml.leaf("type", event.durationType);
          for (let index = 0; index < event.dots; index += 1) xml.empty("dot");
        }
        xml.close("note");
        continue;
      }

      writeNote(xml, event, options, shift, instrument, reading, valveCount,
                beams.get(eventIndex) ?? []);
    }

    if (measure.endRepeat !== null || measure.voltaStop) {
      xml.open("barline", { location: "right" });
      if (measure.endRepeat !== null) xml.leaf("bar-style", "light-heavy");
      if (measure.voltaStop) xml.empty("ending", { number: "1", type: "stop" });
      if (measure.endRepeat !== null) {
        xml.empty("repeat", { direction: "backward", times: measure.endRepeat });
      }
      xml.close("barline");
    }

    xml.close("measure");
  }

  xml.close("part").close("score-partwise");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n${xml.toString()}`;
}

/**
 * Length of a full bar. The time signature is only written on the bar that
 * changes it, so the caller carries the running one: assuming 4/4 everywhere
 * would give a whole-bar rest the wrong duration in any other metre.
 */
function measureTicks(time: TimeSignature): number {
  return Math.round((DIVISIONS * 4 * time.beats) / time.beatType);
}

function writeNote(
  xml: XmlBuilder,
  event: NoteEvent,
  options: RewriteOptions,
  shift: number,
  instrument: Instrument,
  reading: Reading,
  valveCount: number,
  beams: readonly BeamMark[],
): void {
  const written = writtenPitch(event.pitch, reading.transpose);
  const spelling = spell(event.tpc + shift, written);
  const ticks = ticksOf(event.durationType, event.dots, event.tuplet);

  xml.open("note");
  if (event.chordIndex > 0) xml.empty("chord");
  xml.open("pitch").leaf("step", spelling.step);
  if (spelling.alter !== 0) xml.leaf("alter", spelling.alter);
  xml.leaf("octave", spelling.octave).close("pitch");
  xml.leaf("duration", ticks);

  if (event.tieStop) xml.empty("tie", { type: "stop" });
  if (event.tieStart) xml.empty("tie", { type: "start" });

  xml.leaf("type", event.durationType);
  for (let index = 0; index < event.dots; index += 1) xml.empty("dot");
  if (event.hasAccidental) {
    xml.leaf("accidental", ACCIDENTAL_NAMES[spelling.alter] ?? "natural");
  }
  if (event.tuplet) {
    xml.open("time-modification")
      .leaf("actual-notes", event.tuplet.actualNotes)
      .leaf("normal-notes", event.tuplet.normalNotes)
      .close("time-modification");
  }

  // <beam> sits after time-modification and before <notations> in the schema.
  for (const beam of beams) xml.leaf("beam", beam.type, { number: beam.number });

  const articulations = event.articulations
    .map((name) => ARTICULATION_NAMES[name])
    .filter((name): name is string => Boolean(name));
  const hasNotations =
    articulations.length > 0 ||
    event.tieStart || event.tieStop ||
    event.slurStart || event.slurStop ||
    event.tupletStart || event.tupletStop;

  if (hasNotations) {
    xml.open("notations");
    if (event.tieStop) xml.empty("tied", { type: "stop" });
    if (event.tieStart) xml.empty("tied", { type: "start" });
    if (event.slurStop) xml.empty("slur", { type: "stop", number: 1 });
    if (event.slurStart) xml.empty("slur", { type: "start", number: 1 });
    if (event.tupletStart) xml.empty("tuplet", { type: "start", number: 1 });
    if (event.tupletStop) xml.empty("tuplet", { type: "stop", number: 1 });
    if (articulations.length > 0) {
      xml.open("articulations");
      for (const name of articulations) xml.empty(name);
      xml.close("articulations");
    }
    xml.close("notations");
  }

  // Only the top note of a chord carries the annotations, to avoid stacking
  // three fingerings under one stem.
  if (event.chordIndex === 0) {
    if (options.showFingerings) {
      const fingering = fingeringFor(event.pitch, instrument.fundamental, valveCount);
      xml.open("lyric", { number: 1 })
        .leaf("syllabic", "single")
        .leaf("text", fingering ? fingering.valves : "?")
        .close("lyric");
    }
    if (options.showNoteNames) {
      xml.open("lyric", { number: options.showFingerings ? 2 : 1 })
        .leaf("syllabic", "single")
        .leaf("text", frenchNoteName(event.tpc + shift))
        .close("lyric");
    }
  }

  xml.close("note");
}
