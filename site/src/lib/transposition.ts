/**
 * Moving a whole part up or down, for practice.
 *
 * A learner whose range is not there yet can still work on a piece if it sits
 * a little lower. This is a property of one score, not of the player: one
 * march may be fine as written while the next needs to come down a tone.
 *
 * The shift is applied to the *sounding* part, before anything else runs, so
 * the rest of the pipeline needs no change: fingerings follow the new pitches,
 * and the reading (clef, B♭ transposition) is applied on top as usual.
 */
import type { Measure, MeasureEvent, ScorePart } from "./musescore.ts";

/** Semitones offered in the menu, highest first. */
export const PRACTICE_SHIFTS: readonly number[] = Array.from(
  { length: 25 },
  (_, index) => 12 - index,
);

const TONE_NAMES = ["", "½ ton", "1 ton", "1 ton ½", "2 tons", "2 tons ½", "3 tons",
  "3 tons ½", "4 tons", "4 tons ½", "5 tons", "5 tons ½", "1 octave"];

/** "+1 ton", "−½ ton", "Ton d'origine". */
export function describeShift(semitones: number): string {
  if (semitones === 0) return "Ton d'origine";
  const sign = semitones > 0 ? "+" : "−";
  return `${sign}${TONE_NAMES[Math.abs(semitones)] ?? `${Math.abs(semitones)} demi-tons`}`;
}

/**
 * Every interval can be spelled two ways along the circle of fifths — down a
 * semitone is either a minor second (five flats further round) or an augmented
 * unison (seven sharps). Both give the right sounds; only one gives a key
 * signature anyone wants to read.
 *
 * `readingFifths` is the shift the player's reading adds afterwards (two
 * sharps for a B♭ instrument), so the choice is made on the key the player
 * will actually see.
 */
export function fifthsFor(
  part: ScorePart,
  semitones: number,
  readingFifths: number,
): number {
  const base = (((semitones * 7) % 12) + 12) % 12;
  const candidates = [base, base - 12];

  const keys: number[] = [];
  part.measures.forEach((measure, index) => {
    if (measure.keyFifths !== null) keys.push(measure.keyFifths);
    else if (index === 0) keys.push(0);
  });

  let best = candidates[0]!;
  let bestCost = Infinity;
  for (const candidate of candidates) {
    const cost = keys.reduce(
      (total, key) => total + Math.abs(key + candidate + readingFifths),
      0,
    );
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  }
  return best;
}

/**
 * MuseScore's tonal pitch classes run from -1 (F♭♭) to 33 (B♯♯). Twelve steps
 * along the circle is the same sound, so a note pushed off the end is brought
 * back enharmonically rather than given a triple accidental.
 */
function keepSpellable(tpc: number): number {
  let value = tpc;
  while (value > 33) value -= 12;
  while (value < -1) value += 12;
  return value;
}

function shiftEvent(event: MeasureEvent, semitones: number, fifths: number): MeasureEvent {
  if (event.kind !== "note") return event;
  return {
    ...event,
    pitch: event.pitch + semitones,
    tpc: keepSpellable(event.tpc + fifths),
  };
}

/** The same part, every note moved by `semitones`. Zero returns it untouched. */
export function transposePart(
  part: ScorePart,
  semitones: number,
  readingFifths = 0,
): ScorePart {
  if (semitones === 0) return part;
  const fifths = fifthsFor(part, semitones, readingFifths);

  const measures: Measure[] = part.measures.map((measure, index) => {
    // An opening bar without a key is in C; once moved, it no longer is, so the
    // new key has to be written there explicitly.
    const key = measure.keyFifths ?? (index === 0 ? 0 : null);
    return {
      ...measure,
      keyFifths: key === null ? null : key + fifths,
      events: measure.events.map((event) => shiftEvent(event, semitones, fifths)),
    };
  });

  return {
    ...part,
    measures,
    range: part.range ? [part.range[0] + semitones, part.range[1] + semitones] : null,
  };
}
